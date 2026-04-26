'use strict';

const Job = require('../models/job.model');
const queueService = require('./queue.service');
const { computeBackoff, sleep } = require('../utils/backoff');
const { JOB_STATUS } = require('../utils/constants');
const { MAX_RETRIES } = require('../config/env');
const logger = require('../utils/logger');

class RetryService {
  /**
   * Handle a failed job: increment retries, compute backoff, requeue or DLQ.
   */
  async handleFailure(jobId, errorMessage) {
    const job = await Job.findById(jobId);
    if (!job) {
      logger.error(`RetryService: job ${jobId} not found`);
      return null;
    }

    job.retries += 1;
    job.error = errorMessage;

    const maxRetries = job.maxRetries || MAX_RETRIES;

    if (job.retries >= maxRetries) {
      // Exhausted retries → Dead Letter Queue
      job.status = JOB_STATUS.DEAD;
      await job.save();
      await queueService.sendToDLQ(jobId);
      logger.warn(`Job ${jobId} exhausted ${maxRetries} retries → DLQ`);
      return job;
    }

    // Schedule retry with exponential backoff
    const delayMs = computeBackoff(job.retries - 1); // 0-indexed
    job.status = JOB_STATUS.RETRYING;
    job.nextRetryAt = new Date(Date.now() + delayMs);
    await job.save();

    logger.info(`Job ${jobId} retry ${job.retries}/${maxRetries} in ${delayMs}ms`);

    // Wait and requeue
    await sleep(delayMs);
    job.status = JOB_STATUS.QUEUED;
    job.nextRetryAt = null;
    await job.save();
    await queueService.requeueForRetry(jobId);

    return job;
  }

  /**
   * Scan for stuck "processing" jobs (e.g. worker crashed) and requeue them.
   * Should be run periodically (e.g. every 60s).
   */
  async recoverStuckJobs(timeoutMs = 5 * 60 * 1000) {
    const cutoff = new Date(Date.now() - timeoutMs);
    const stuckJobs = await Job.find({
      status: JOB_STATUS.PROCESSING,
      startedAt: { $lt: cutoff },
    });

    if (stuckJobs.length > 0) {
      logger.warn(`Recovering ${stuckJobs.length} stuck jobs`);
    }

    for (const job of stuckJobs) {
      await this.handleFailure(job._id.toString(), 'Worker timeout — job recovered');
    }

    return stuckJobs.length;
  }
}

module.exports = new RetryService();