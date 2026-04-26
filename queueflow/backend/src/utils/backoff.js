'use strict';

const { RETRY_BASE_DELAY_MS } = require('../config/env');

/**
 * Compute exponential backoff delay with optional jitter.
 * delay = base * 2^attempt + jitter(0..base)
 * Capped at 5 minutes.
 */
function computeBackoff(attempt, baseMs = RETRY_BASE_DELAY_MS, jitter = true) {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitterAmount = jitter ? Math.random() * baseMs : 0;
  const delay = Math.min(exponential + jitterAmount, 5 * 60 * 1000);
  return Math.floor(delay);
}

/**
 * Sleep for given milliseconds (Promise-based).
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { computeBackoff, sleep };