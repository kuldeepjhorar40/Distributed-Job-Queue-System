'use strict';

module.exports = {
  JOB_STATUS: {
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    RETRYING: 'retrying',
    DEAD: 'dead',
  },
  PRIORITY: {
    LOW: 1,
    NORMAL: 5,
    HIGH: 8,
    CRITICAL: 10,
  },
  QUEUE_EVENTS: {
    JOB_ADDED: 'job:added',
    JOB_PROCESSING: 'job:processing',
    JOB_COMPLETED: 'job:completed',
    JOB_FAILED: 'job:failed',
    JOB_RETRYING: 'job:retrying',
    JOB_DEAD: 'job:dead',
  },
};