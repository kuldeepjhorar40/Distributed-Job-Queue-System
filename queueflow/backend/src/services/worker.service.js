'use strict';

const logger = require('../utils/logger');
const { sleep } = require('../utils/backoff');

/**
 * WorkerService — contains the actual task execution logic.
 * Each task type maps to a handler function.
 * Handlers should return a result object or throw an Error on failure.
 */
const handlers = {
  async send_email(payload) {
    await sleep(50 + Math.random() * 200);
    if (!payload?.to) throw new Error('Missing email recipient');
    logger.debug(`[send_email] Sent to ${payload.to}`);
    return { sent: true, recipient: payload.to, timestamp: new Date().toISOString() };
  },

  async resize_image(payload) {
    await sleep(100 + Math.random() * 400);
    if (!payload?.url) throw new Error('Missing image URL');
    logger.debug(`[resize_image] Resized ${payload.url}`);
    return { processed: true, width: payload.width || 800, height: payload.height || 600 };
  },

  async generate_pdf(payload) {
    await sleep(200 + Math.random() * 600);
    logger.debug(`[generate_pdf] Generated PDF for ${payload?.template || 'default'}`);
    return { generated: true, pages: Math.floor(Math.random() * 10) + 1 };
  },

  async sync_crm(payload) {
    await sleep(80 + Math.random() * 300);
    logger.debug(`[sync_crm] Synced ${payload?.records || 0} records`);
    return { synced: true, count: payload?.records || 0 };
  },

  async process_payment(payload) {
    await sleep(150 + Math.random() * 300);
    if (!payload?.amount) throw new Error('Missing payment amount');
    logger.debug(`[process_payment] Processed $${payload.amount}`);
    return { processed: true, transactionId: `txn_${Date.now()}` };
  },

  async compress_video(payload) {
    await sleep(500 + Math.random() * 1000);
    logger.debug(`[compress_video] Compressed ${payload?.filename}`);
    return { compressed: true, sizeSaved: `${Math.floor(Math.random() * 60) + 20}%` };
  },

  // Default fallback
  async default_handler(payload) {
    await sleep(50 + Math.random() * 150);
    return { executed: true };
  },
};

class WorkerService {
  /**
   * Execute a job's task. Returns result or throws.
   */
  async execute(task, payload) {
    const handler = handlers[task] || handlers['default_handler'];
    const result = await handler(payload);
    return result;
  }
}

module.exports = new WorkerService();