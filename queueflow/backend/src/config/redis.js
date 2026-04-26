'use strict';

const Redis = require('ioredis');
const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } = require('./env');
const logger = require('../utils/logger');

const redisConfig = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD || undefined,
  retryStrategy(times) {
    const delay = Math.min(times * 500, 5000);
    logger.warn(`Redis retry attempt ${times}, delay ${delay}ms`);
    return delay;
  },
  maxRetriesPerRequest: null, // Required for blocking commands (BLPOP)
  lazyConnect: true,
};

// Primary client (commands)
const redis = new Redis(redisConfig);

// Subscriber client for blocking ops (each BLPOP needs its own connection)
function createRedisClient() {
  return new Redis(redisConfig);
}

redis.on('connect', () => logger.info(`Redis connected at ${REDIS_HOST}:${REDIS_PORT}`));
redis.on('error', (err) => logger.error('Redis error:', err.message));
redis.on('reconnecting', () => logger.warn('Redis reconnecting...'));

async function connectRedis() {
  await redis.connect();
}

module.exports = { redis, createRedisClient, connectRedis };