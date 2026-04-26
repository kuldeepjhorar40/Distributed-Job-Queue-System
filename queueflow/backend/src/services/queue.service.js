'use strict';

const { redis } = require('../config/redis');
const { QUEUE_NAME, PRIORITY_QUEUE_NAME, DEAD_LETTER_QUEUE } = require('../config/env');
const logger = require('../utils/logger');

/**
 * QueueService — wraps Redis RPUSH/BLPOP/ZADD/ZPOPMAX for job queuing.
 * Uses sorted sets for priority queuing and lists for FIFO within priority.
 *
 * Priority queue: ZADD job_queue_priority <priority> <jobId>
 * Standard queue: RPUSH job_queue <jobId>
 */
class QueueService {
  /**
   * Enqueue a job with priority support.
   * High-priority jobs go into the sorted set; others into the list.
   */
  async enqueue(jobId, priority = 5) {
    try {
      if (priority >= 7) {
        // Priority queue (sorted set, score = priority + timestamp for FIFO within same priority)
        const score = priority * 1e13 + (Date.now());
        await redis.zadd(PRIORITY_QUEUE_NAME, score.toString(), jobId.toString());
        logger.debug(`Enqueued to priority queue: ${jobId} (priority ${priority})`);
      } else {
        // FIFO queue
        await redis.rpush(QUEUE_NAME, jobId.toString());
        logger.debug(`Enqueued to standard queue: ${jobId}`);
      }
    } catch (err) {
      logger.error('QueueService.enqueue failed:', err.message);
      throw err;
    }
  }

  /**
   * Dequeue next job: check priority queue first, then FIFO queue.
   * Returns jobId string or null.
   */
  async dequeue() {
    try {
      // Check priority queue first
      const priorityResult = await redis.zpopmax(PRIORITY_QUEUE_NAME);
      if (priorityResult && priorityResult.length >= 2) {
        return priorityResult[0]; // element (jobId)
      }

      // Check standard FIFO queue (non-blocking pop)
      const result = await redis.lpop(QUEUE_NAME);
      return result || null;
    } catch (err) {
      logger.error('QueueService.dequeue failed:', err.message);
      return null;
    }
  }

  /**
   * Blocking dequeue — used by workers. Waits up to `timeout` seconds.
   * Requires a dedicated Redis connection.
   */
  async blockingDequeue(redisClient, timeout = 2) {
    try {
      // Check priority queue first (non-blocking)
      const priorityResult = await redisClient.zpopmax(PRIORITY_QUEUE_NAME);
      if (priorityResult && priorityResult.length >= 2) {
        return priorityResult[0];
      }

      // Blocking pop on FIFO queue
      const result = await redisClient.blpop(QUEUE_NAME, timeout);
      return result ? result[1] : null;
    } catch (err) {
      if (err.message?.includes('closed')) return null; // graceful shutdown
      logger.error('QueueService.blockingDequeue failed:', err.message);
      return null;
    }
  }

  /**
   * Re-enqueue a job for retry (inserts back at front of standard queue).
   */
  async requeueForRetry(jobId) {
    try {
      await redis.lpush(QUEUE_NAME, jobId.toString());
      logger.debug(`Requeued for retry: ${jobId}`);
    } catch (err) {
      logger.error('QueueService.requeueForRetry failed:', err.message);
      throw err;
    }
  }

  /**
   * Move job to Dead Letter Queue.
   */
  async sendToDLQ(jobId) {
    try {
      await redis.rpush(DEAD_LETTER_QUEUE, jobId.toString());
      logger.warn(`Job ${jobId} moved to Dead Letter Queue`);
    } catch (err) {
      logger.error('QueueService.sendToDLQ failed:', err.message);
    }
  }

  /**
   * Get queue depth metrics.
   */
  async getMetrics() {
    try {
      const [stdLen, priorityLen, dlqLen] = await Promise.all([
        redis.llen(QUEUE_NAME),
        redis.zcard(PRIORITY_QUEUE_NAME),
        redis.llen(DEAD_LETTER_QUEUE),
      ]);
      return {
        standard: stdLen,
        priority: priorityLen,
        deadLetter: dlqLen,
        total: stdLen + priorityLen,
      };
    } catch (err) {
      logger.error('QueueService.getMetrics failed:', err.message);
      return { standard: 0, priority: 0, deadLetter: 0, total: 0 };
    }
  }

  /**
   * Peek at next N items in standard queue (non-destructive).
   */
  async peek(count = 10) {
    try {
      return await redis.lrange(QUEUE_NAME, 0, count - 1);
    } catch (err) {
      return [];
    }
  }
}

module.exports = new QueueService();