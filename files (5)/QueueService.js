'use strict';

const { getClient } = require('../config/redis');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * QueueService — Redis-backed FIFO + priority queue engine.
 *
 * Design decisions:
 * - Each priority level is a Redis Sorted Set (ZSET) keyed by queue name.
 * - Score = priority_base + timestamp_fraction, giving FIFO within same priority.
 * - BZPOPMIN on all three queues in a single blocking call provides atomic dequeue.
 * - A "processing" hash stores in-flight jobs for recovery after worker crash.
 * - Dead Letter Queue is a separate ZSET storing permanently failed jobs.
 */
class QueueService {
  constructor() {
    this.redis = getClient();
    this.queues = config.queues;
    this.priorityScores = config.queues.priorityScores;
  }

  // ─── Enqueue ──────────────────────────────────────────────────────────────

  /**
   * Enqueue a job into the appropriate priority ZSET.
   * Score = priorityBase + (Date.now() / 1e13) — ensures FIFO within priority tier.
   *
   * @param {string} jobId
   * @param {string} priority — 'high' | 'medium' | 'low'
   * @param {Object} jobData — serialisable job context (type, payload, attempts…)
   * @returns {Promise<void>}
   */
  async enqueue(jobId, priority = 'medium', jobData = {}) {
    const queueKey = this._queueKey(priority);
    const baseScore = this.priorityScores[priority] ?? 5;
    // Fractional timestamp ensures FIFO within priority tier
    const score = baseScore + Date.now() / 1e13;

    const entry = JSON.stringify({ jobId, ...jobData });

    await this.redis.zadd(queueKey, score, entry);

    logger.debug('Job enqueued', { jobId, priority, queue: queueKey, score });
  }

  // ─── Dequeue ──────────────────────────────────────────────────────────────

  /**
   * Atomically pop the highest-priority job across all queues.
   * Uses Lua script for atomicity — prevents race conditions with concurrent workers.
   *
   * @returns {Promise<{jobId:string, entry:Object, queueName:string}|null>}
   */
  async dequeue() {
    const script = `
      local queues = {KEYS[1], KEYS[2], KEYS[3]}
      for _, queue in ipairs(queues) do
        local result = redis.call('ZPOPMIN', queue, 1)
        if #result > 0 then
          return {queue, result[1], result[2]}
        end
      end
      return nil
    `;

    const result = await this.redis.eval(
      script,
      3,
      this.queues.high,
      this.queues.medium,
      this.queues.low
    );

    if (!result) return null;

    const [queueName, entryStr] = result;
    const entry = JSON.parse(entryStr);
    const { jobId, ...rest } = entry;

    // Mark job as in-flight in the processing hash (crash recovery)
    await this.redis.hset(
      this.queues.processing,
      jobId,
      JSON.stringify({ ...rest, dequeuedAt: Date.now() })
    );

    return { jobId, entry: rest, queueName };
  }

  // ─── Blocking Dequeue (for workers) ──────────────────────────────────────

  /**
   * Blocking dequeue with BZPOPMIN — efficient for workers (no busy polling).
   * Times out after `timeoutSecs` seconds and returns null.
   * NOTE: Must use a dedicated blocking Redis client.
   *
   * @param {Redis} blockingClient — dedicated ioredis client for blocking ops
   * @param {number} timeoutSecs
   * @returns {Promise<{jobId:string, entry:Object, queueName:string}|null>}
   */
  async blockingDequeue(blockingClient, timeoutSecs = 5) {
    // BZPOPMIN checks queues in order — highest priority first
    const result = await blockingClient.bzpopmin(
      this.queues.high,
      this.queues.medium,
      this.queues.low,
      timeoutSecs
    );

    if (!result) return null;

    const [queueName, entryStr] = result;
    const entry = JSON.parse(entryStr);
    const { jobId, ...rest } = entry;

    await this.redis.hset(
      this.queues.processing,
      jobId,
      JSON.stringify({ ...rest, dequeuedAt: Date.now() })
    );

    return { jobId, entry: rest, queueName };
  }

  // ─── Acknowledge / Complete ───────────────────────────────────────────────

  /**
   * Remove a job from the processing hash once it completes successfully.
   */
  async acknowledge(jobId) {
    await this.redis.hdel(this.queues.processing, jobId);
    logger.debug('Job acknowledged', { jobId });
  }

  // ─── Retry ────────────────────────────────────────────────────────────────

  /**
   * Schedule a job for retry using a sorted set with the retry timestamp as score.
   * A scheduler process (or the worker itself) polls this set and re-enqueues eligible jobs.
   *
   * @param {string} jobId
   * @param {string} priority
   * @param {Object} jobData
   * @param {number} delayMs — delay before retry
   */
  async scheduleRetry(jobId, priority, jobData, delayMs) {
    const retryAt = Date.now() + delayMs;
    const entry = JSON.stringify({ jobId, priority, ...jobData });

    await this.redis.zadd('jobs:retry', retryAt, entry);
    await this.redis.hdel(this.queues.processing, jobId);

    logger.info('Job scheduled for retry', { jobId, delayMs, retryAt: new Date(retryAt) });
  }

  /**
   * Flush all jobs from the retry ZSET that are due (score <= now).
   * Called periodically by the worker's retry scheduler loop.
   *
   * @returns {Promise<number>} number of jobs re-enqueued
   */
  async flushDueRetries() {
    const now = Date.now();
    const script = `
      local jobs = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
      if #jobs == 0 then return 0 end
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
      return jobs
    `;

    const jobs = await this.redis.eval(script, 1, 'jobs:retry', now);
    if (!jobs || jobs.length === 0) return 0;

    let count = 0;
    for (const entryStr of jobs) {
      const { jobId, priority, ...rest } = JSON.parse(entryStr);
      await this.enqueue(jobId, priority, rest);
      count++;
    }

    if (count > 0) logger.info('Retries flushed to queue', { count });
    return count;
  }

  // ─── Dead Letter Queue ────────────────────────────────────────────────────

  /**
   * Move a permanently failed job to the dead letter queue.
   *
   * @param {string} jobId
   * @param {Object} jobData
   * @param {string} reason
   */
  async sendToDeadLetter(jobId, jobData, reason) {
    const entry = JSON.stringify({
      jobId,
      ...jobData,
      deadReason: reason,
      deadAt: Date.now(),
    });

    await this.redis.zadd(this.queues.deadLetter, Date.now(), entry);
    await this.redis.hdel(this.queues.processing, jobId);

    logger.warn('Job moved to dead letter queue', { jobId, reason });
  }

  // ─── Queue Stats ──────────────────────────────────────────────────────────

  async getStats() {
    const [high, medium, low, processing, retryCount, dlqCount] = await Promise.all([
      this.redis.zcard(this.queues.high),
      this.redis.zcard(this.queues.medium),
      this.redis.zcard(this.queues.low),
      this.redis.hlen(this.queues.processing),
      this.redis.zcard('jobs:retry'),
      this.redis.zcard(this.queues.deadLetter),
    ]);

    return {
      queues: { high, medium, low },
      processing,
      retryScheduled: retryCount,
      deadLetter: dlqCount,
      total: high + medium + low + processing,
    };
  }

  // ─── Recovery: stuck jobs ─────────────────────────────────────────────────

  /**
   * Find jobs stuck in "processing" for longer than the lock TTL and re-enqueue them.
   * Should be called on worker startup and periodically.
   */
  async recoverStuckJobs() {
    const processing = await this.redis.hgetall(this.queues.processing);
    if (!processing) return 0;

    const lockTtl = config.worker.lockTtlMs;
    const now = Date.now();
    let recovered = 0;

    for (const [jobId, dataStr] of Object.entries(processing)) {
      const data = JSON.parse(dataStr);
      if (now - data.dequeuedAt > lockTtl) {
        logger.warn('Recovering stuck job', { jobId, age: now - data.dequeuedAt });
        await this.enqueue(jobId, data.priority || 'medium', data);
        await this.redis.hdel(this.queues.processing, jobId);
        recovered++;
      }
    }

    if (recovered > 0) logger.info('Recovered stuck jobs', { count: recovered });
    return recovered;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _queueKey(priority) {
    const key = this.queues[priority];
    if (!key) throw new Error(`Unknown priority: ${priority}`);
    return key;
  }
}

// Export singleton
module.exports = new QueueService();
