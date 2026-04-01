'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const JOB_STATUSES = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD: 'dead',          // exceeded max retries → moved to DLQ
  CANCELLED: 'cancelled',
};

const JOB_PRIORITIES = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

const jobSchema = new mongoose.Schema(
  {
    // Use UUID strings instead of ObjectId for portability and idempotency
    _id: {
      type: String,
      default: uuidv4,
    },

    // Job type determines which handler processes it
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    // Caller-supplied payload; schema-less so any job type can carry data
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    // Job lifecycle state
    status: {
      type: String,
      enum: Object.values(JOB_STATUSES),
      default: JOB_STATUSES.PENDING,
      index: true,
    },

    priority: {
      type: String,
      enum: Object.values(JOB_PRIORITIES),
      default: JOB_PRIORITIES.MEDIUM,
      index: true,
    },

    // Idempotency: caller can provide a stable key; system deduplicates on it
    idempotencyKey: {
      type: String,
      sparse: true,  // allows null but enforces uniqueness when present
      unique: true,
      index: true,
    },

    // Retry tracking
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    maxAttempts: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
    },

    // Milliseconds delay for the next retry (set by exponential backoff)
    nextRetryAt: {
      type: Date,
      index: true,
    },

    // Timestamps for SLA tracking
    queuedAt: {
      type: Date,
      default: Date.now,
    },

    startedAt: Date,
    completedAt: Date,
    failedAt: Date,

    // Result of successful job execution
    result: mongoose.Schema.Types.Mixed,

    // Error information for failed/dead jobs
    lastError: {
      message: String,
      stack: String,
      code: String,
    },

    // Full error history across all retry attempts
    errorHistory: [
      {
        attempt: Number,
        message: String,
        code: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],

    // ID of the worker that is/was processing this job
    workerId: String,

    // Which queue this job is on (for routing and observability)
    queueName: String,

    // Optional metadata from the producer (tenant, trace-id, etc.)
    metadata: mongoose.Schema.Types.Mixed,

    // Scheduled execution time (for delayed jobs)
    scheduledFor: {
      type: Date,
      index: true,
    },

    // TTL: delete document after N seconds (optional, set per-job)
    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,             // adds createdAt, updatedAt
    versionKey: '__v',
    _id: false,                   // disable auto _id since we supply it
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Compound indexes for common query patterns ──────────────────────────────

// List jobs by status + priority (queue consumer pattern)
jobSchema.index({ status: 1, priority: 1, queuedAt: 1 });

// Retry scheduler: find jobs ready to be re-queued
jobSchema.index({ status: 1, nextRetryAt: 1 });

// Producer lookup by type
jobSchema.index({ type: 1, createdAt: -1 });

// TTL index — MongoDB automatically deletes docs after expiresAt
jobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

// ─── Virtuals ────────────────────────────────────────────────────────────────

jobSchema.virtual('id').get(function () {
  return this._id;
});

// Processing duration in milliseconds (null if not yet completed)
jobSchema.virtual('processingTimeMs').get(function () {
  if (this.startedAt && this.completedAt) {
    return this.completedAt - this.startedAt;
  }
  return null;
});

// Queue wait time in milliseconds
jobSchema.virtual('queueWaitMs').get(function () {
  if (this.queuedAt && this.startedAt) {
    return this.startedAt - this.queuedAt;
  }
  return null;
});

// ─── Instance methods ────────────────────────────────────────────────────────

jobSchema.methods.markProcessing = function (workerId) {
  this.status = JOB_STATUSES.PROCESSING;
  this.startedAt = new Date();
  this.workerId = workerId;
  this.attempts += 1;
  return this.save();
};

jobSchema.methods.markCompleted = function (result) {
  this.status = JOB_STATUSES.COMPLETED;
  this.completedAt = new Date();
  this.result = result;
  return this.save();
};

jobSchema.methods.markFailed = function (error, nextRetryAt = null) {
  this.lastError = {
    message: error.message,
    stack: error.stack,
    code: error.code,
  };

  this.errorHistory.push({
    attempt: this.attempts,
    message: error.message,
    code: error.code,
  });

  if (this.attempts >= this.maxAttempts || !nextRetryAt) {
    this.status = JOB_STATUSES.DEAD;
    this.failedAt = new Date();
  } else {
    this.status = JOB_STATUSES.FAILED;
    this.nextRetryAt = nextRetryAt;
  }

  return this.save();
};

// ─── Static methods ───────────────────────────────────────────────────────────

jobSchema.statics.findByStatus = function (status, options = {}) {
  const { page = 1, limit = 20, sort = '-createdAt' } = options;
  return this.find({ status })
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
};

jobSchema.statics.getStats = function () {
  return this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgAttempts: { $avg: '$attempts' },
      },
    },
    { $project: { status: '$_id', count: 1, avgAttempts: 1, _id: 0 } },
  ]);
};

const Job = mongoose.model('Job', jobSchema);

module.exports = { Job, JOB_STATUSES, JOB_PRIORITIES };
