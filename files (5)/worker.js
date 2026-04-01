'use strict';

require('dotenv').config();
require('express-async-errors');

const { v4: uuidv4 } = require('uuid');
const pLimit = require('p-limit');

const { connect: dbConnect, disconnect: dbDisconnect } = require('../config/database');
const { getBlockingClient, disconnect: redisDisconnect } = require('../config/redis');
const queueService = require('../queue/QueueService');
const { Job, JOB_STATUSES } = require('../models/Job');
const { calculateBackoff } = require('../utils/backoff');
const handlers = require('./handlers');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * Worker — polls Redis queues and processes jobs concurrently.
 *
 * Lifecycle:
 *   1. Connect to MongoDB + Redis
 *   2. Recover any stuck in-flight jobs from previous crash
 *   3. Start retry scheduler (flushes due retries every 5s)
 *   4. Poll queue with BZPOPMIN (blocking, no busy-loop)
 *   5. For each job: acquire concurrency slot → process → update DB → ack Redis
 *   6. On SIGTERM/SIGINT: drain in-flight jobs then shut down
 */
class Worker {
  constructor() {
    this.id = `worker_${uuidv4().slice(0, 8)}`;
    this.isRunning = false;
    this.activeJobs = 0;
    this.blockingClient = null;
    this.retrySchedulerTimer = null;
    this.limiter = pLimit(config.worker.concurrency);

    logger.info('Worker initialised', { workerId: this.id, concurrency: config.worker.concurrency });
  }

  // ─── Startup ──────────────────────────────────────────────────────────────

  async start() {
    await dbConnect();
    this.blockingClient = getBlockingClient();

    // Give blocking client a moment to be ready
    await new Promise((r) => setTimeout(r, 500));

    // Recover jobs stuck in processing hash from previous worker crash
    await queueService.recoverStuckJobs();

    this.isRunning = true;
    this._startRetryScheduler();
    this._registerShutdownHandlers();

    logger.info('Worker started', { workerId: this.id });

    // Main polling loop
    while (this.isRunning) {
      await this._pollAndProcess();
    }
  }

  // ─── Poll loop ────────────────────────────────────────────────────────────

  async _pollAndProcess() {
    try {
      // BZPOPMIN blocks until a job is available or timeout fires
      const item = await queueService.blockingDequeue(this.blockingClient, 5);
      if (!item) return; // timeout — loop again

      const { jobId, entry, queueName } = item;

      // Fire-and-forget within concurrency limit
      this.limiter(() => this._processJob(jobId, entry, queueName)).catch((err) => {
        logger.error('Unhandled error in job slot', { error: err.message, jobId });
      });
    } catch (err) {
      if (this.isRunning) {
        logger.error('Poll loop error', { error: err.message });
        await sleep(1000); // brief back-off before retrying
      }
    }
  }

  // ─── Process a single job ─────────────────────────────────────────────────

  async _processJob(jobId, entry, queueName) {
    this.activeJobs++;
    const jobLogger = logger.child ? logger.child({ jobId, workerId: this.id }) : logger;

    let job;
    try {
      job = await Job.findById(jobId);
      if (!job) {
        logger.warn('Job not found in DB — skipping', { jobId });
        await queueService.acknowledge(jobId);
        return;
      }

      // Guard against duplicate processing (idempotency)
      if (job.status === JOB_STATUSES.COMPLETED || job.status === JOB_STATUSES.CANCELLED) {
        logger.info('Job already terminal — skipping', { jobId, status: job.status });
        await queueService.acknowledge(jobId);
        return;
      }

      // Mark as processing in DB
      await job.markProcessing(this.id);
      jobLogger.info('Processing job', { type: job.type, attempt: job.attempts, priority: job.priority });

      // Resolve handler
      const handler = handlers.resolve(job.type);
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.type}`);
      }

      // Execute with a per-job timeout (lock TTL)
      const result = await Promise.race([
        handler(job, { workerId: this.id, attempt: job.attempts, logger: jobLogger }),
        sleep(config.worker.lockTtlMs).then(() => {
          throw new Error(`Job timed out after ${config.worker.lockTtlMs}ms`);
        }),
      ]);

      // Success
      await job.markCompleted(result);
      await queueService.acknowledge(jobId);

      jobLogger.info('Job completed', { type: job.type, attempt: job.attempts });
    } catch (err) {
      await this._handleFailure(job, jobId, entry, err, jobLogger);
    } finally {
      this.activeJobs--;
    }
  }

  // ─── Failure + Retry logic ────────────────────────────────────────────────

  async _handleFailure(job, jobId, entry, err, jobLogger) {
    jobLogger.warn('Job failed', { error: err.message, attempt: job?.attempts });

    if (!job) {
      // Can't find job doc — remove from processing hash
      await queueService.acknowledge(jobId);
      return;
    }

    const exhausted = job.attempts >= job.maxAttempts;

    if (exhausted) {
      // Move to dead letter queue
      await job.markFailed(err, null);
      await queueService.sendToDeadLetter(jobId, entry, err.message);
      jobLogger.error('Job exhausted retries — moved to DLQ', {
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
      });
    } else {
      // Schedule retry with exponential backoff
      const delayMs = calculateBackoff(job.attempts);
      const nextRetryAt = new Date(Date.now() + delayMs);

      await job.markFailed(err, nextRetryAt);
      await queueService.scheduleRetry(
        jobId,
        job.priority,
        { type: job.type, priority: job.priority, maxAttempts: job.maxAttempts },
        delayMs
      );

      jobLogger.info('Job scheduled for retry', {
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        delayMs,
        nextRetryAt,
      });
    }
  }

  // ─── Retry scheduler ──────────────────────────────────────────────────────

  _startRetryScheduler() {
    const INTERVAL_MS = 5000;

    const tick = async () => {
      try {
        const count = await queueService.flushDueRetries();
        if (count > 0) logger.info('Retry scheduler flushed jobs', { count });
      } catch (err) {
        logger.error('Retry scheduler error', { error: err.message });
      }
    };

    this.retrySchedulerTimer = setInterval(tick, INTERVAL_MS);
    logger.info('Retry scheduler started', { intervalMs: INTERVAL_MS });
  }

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  _registerShutdownHandlers() {
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down worker`, { workerId: this.id });
      this.isRunning = false;

      clearInterval(this.retrySchedulerTimer);

      // Wait for in-flight jobs to finish (max 30s)
      const DRAIN_TIMEOUT = 30_000;
      const deadline = Date.now() + DRAIN_TIMEOUT;

      while (this.activeJobs > 0 && Date.now() < deadline) {
        logger.info('Draining active jobs...', { activeJobs: this.activeJobs });
        await sleep(500);
      }

      if (this.activeJobs > 0) {
        logger.warn('Drain timeout — forcing shutdown', { remaining: this.activeJobs });
      }

      if (this.blockingClient) await this.blockingClient.quit();
      await redisDisconnect();
      await dbDisconnect();

      logger.info('Worker shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception in worker', { error: err.message, stack: err.stack });
      shutdown('uncaughtException');
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Entry point ──────────────────────────────────────────────────────────

const worker = new Worker();
worker.start().catch((err) => {
  logger.error('Worker failed to start', { error: err.message, stack: err.stack });
  process.exit(1);
});
