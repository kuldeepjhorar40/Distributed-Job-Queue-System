'use strict';

const { Schema, model } = require('mongoose');
const { JOB_STATUS } = require('../utils/constants');

const jobSchema = new Schema(
  {
    task: {
      type: String,
      required: [true, 'Task name is required'],
      trim: true,
      maxlength: [200, 'Task name must be <= 200 characters'],
    },
    status: {
      type: String,
      enum: Object.values(JOB_STATUS),
      default: JOB_STATUS.QUEUED,
      index: true,
    },
    priority: {
      type: Number,
      min: [1, 'Priority min is 1'],
      max: [10, 'Priority max is 10'],
      default: 5,
      index: true,
    },
    retries: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxRetries: {
      type: Number,
      default: 5,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    result: {
      type: Schema.Types.Mixed,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
    workerId: {
      type: String,
      default: null,
    },
    nextRetryAt: {
      type: Date,
      default: null,
      index: true,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // adds createdAt, updatedAt
    versionKey: false,
  }
);

// Compound index for common query patterns
jobSchema.index({ status: 1, priority: -1, createdAt: 1 });
jobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 }); // TTL: 7 days

// Virtual: duration in ms
jobSchema.virtual('durationMs').get(function () {
  if (this.startedAt && this.completedAt) {
    return this.completedAt - this.startedAt;
  }
  return null;
});

// Transform output
jobSchema.set('toJSON', {
  virtuals: true,
  transform(doc, ret) {
    ret.id = ret._id;
    return ret;
  },
});

module.exports = model('Job', jobSchema);