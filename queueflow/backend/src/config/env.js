'use strict';

require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/queueflow',

  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT) || 6379,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,

  QUEUE_NAME: process.env.QUEUE_NAME || 'job_queue',
  PRIORITY_QUEUE_NAME: process.env.PRIORITY_QUEUE_NAME || 'job_queue_priority',
  DEAD_LETTER_QUEUE: process.env.DEAD_LETTER_QUEUE || 'dlq',

  MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 5,
  RETRY_BASE_DELAY_MS: parseInt(process.env.RETRY_BASE_DELAY_MS) || 2000,
  WORKER_CONCURRENCY: parseInt(process.env.WORKER_CONCURRENCY) || 3,
  WORKER_POLL_INTERVAL_MS: parseInt(process.env.WORKER_POLL_INTERVAL_MS) || 500,

  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};