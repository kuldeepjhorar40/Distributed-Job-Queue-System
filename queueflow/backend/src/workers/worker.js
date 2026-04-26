'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { v4: uuidv4 } = require('uuid');
const { connectDB } = require('../config/db');
const { connectRedis, createRedisClient } = require('../config/redis');
const queueService = require('../services/queue.service');
const workerService = require('../services/worker.service');
const retryService = require('../services/retry.service');
const Job = require('../models/job.model');
const { JOB_STATUS } = require('../utils/constants');
const { WORKER_CONCURRENCY, WORKER_POLL_INTERVAL_MS } = require('../config/env');
const logger = require('../utils/logger');

const WORKER_ID = `worker-${uuidv4().slice(0, 8)}`;

class Worker {
  constructor() {
    this.id = WORKER_ID;
    this.concurrency = WORKER_CONCURRENCY;
    this.activeJobs = 0;
    this.running = false;
    this.redisClients = [];
  }

  async start() {
    logger.info(`Worker ${this.id} starting with concurrency ${this.concurrency}`);

    await connectDB();
    await connectRedis();

    this.running = true;

    // Spawn concurrent polling loops
    const loops = Array.from({ length: this.concurrency }, (_, i) => this.pollLoop(i));
    await Promise.all(loops);
  }

  async pollLoop(slotIndex) {
    const client = createRedisClient();
    await client.connect();
    this.redisClients.push(client);

    logger.info(`Worker ${this.id} slot ${slotIndex} polling...`);

    while (this.running) {
      try {
        const jobId = await queueService.blockingDequeue(client, 2);
        if (jobId) {
          await this.processJob(jobId);
        }
      } catch (err) {
        logger.error(`Worker ${this.id} slot ${slotIndex} error:`, err.message);
        await new Promise(r => setTimeout(r, WORKER_POLL_INTERVAL_MS));
      }
    }

    await client.quit();
  }

  async processJob(jobId) {
    const job = await Job.findByIdAndUpdate(
      jobId,
      { status: JOB_STATUS.PROCESSING, startedAt: new Date(), workerId: this.id },
      { new: true }
    );

    if (!job) {
      logger.warn(`Worker ${this.id}: job ${jobId} not found in DB, skipping`);
      return;
    }

    logger.info(`Worker ${this.id} processing job ${jobId} (${job.task})`);
    this.activeJobs++;

    try {
      const result = await workerService.execute(job.task, job.payload);
      await Job.findByIdAndUpdate(jobId, {
        status: JOB_STATUS.COMPLETED,
        result,
        completedAt: new Date(),
        error: null,
      });
      logger.info(`Worker ${this.id}: job ${jobId} completed ✓`);
    } catch (err) {
      logger.warn(`Worker ${this.id}: job ${jobId} failed — ${err.message}`);
      // Delegate retry/DLQ logic to retry service
      retryService.handleFailure(jobId, err.message).catch(e =>
        logger.error('RetryService error:', e.message)
      );
    } finally {
      this.activeJobs--;
    }
  }

  async stop() {
    logger.info(`Worker ${this.id} shutting down...`);
    this.running = false;
    for (const client of this.redisClients) {
      try { await client.quit(); } catch {}
    }
  }
}

// ===== MAIN =====
const worker = new Worker();

async function main() {
  try {
    // Periodic stuck job recovery
    setInterval(async () => {
      const recovered = await retryService.recoverStuckJobs();
      if (recovered > 0) logger.info(`Recovered ${recovered} stuck jobs`);
    }, 60_000);

    await worker.start();
  } catch (err) {
    logger.error('Worker startup failed:', err.message);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`${signal} received — graceful shutdown`);
  await worker.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason));

main();