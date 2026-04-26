'use strict';

const Job = require('../models/job.model');
const queueService = require('../services/queue.service');
const { JOB_STATUS } = require('../utils/constants');
const logger = require('../utils/logger');

class JobController {
  /**
   * POST /job — create and enqueue a new job
   */
  async createJob(req, res, next) {
    try {
      const { task, priority = 5, payload = {}, maxRetries } = req.body;

      if (!task || typeof task !== 'string') {
        return res.status(400).json({ success: false, error: 'task is required (string)' });
      }

      const job = await Job.create({
        task: task.trim(),
        priority: Math.min(10, Math.max(1, parseInt(priority) || 5)),
        payload,
        maxRetries: maxRetries || 5,
        status: JOB_STATUS.QUEUED,
      });

      await queueService.enqueue(job._id.toString(), job.priority);

      logger.info(`Job created: ${job._id} (${job.task}, priority ${job.priority})`);
      return res.status(201).json({ success: true, job });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /job/:id — get a single job by ID
   */
  async getJob(req, res, next) {
    try {
      const job = await Job.findById(req.params.id);
      if (!job) {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }
      return res.json({ success: true, job });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /jobs — paginated job listing with filters
   */
  async getJobs(req, res, next) {
    try {
      const {
        status,
        priority,
        task,
        limit = 20,
        page = 1,
        sortBy = 'createdAt',
        order = 'desc',
      } = req.query;

      const filter = {};
      if (status) filter.status = status;
      if (priority) filter.priority = parseInt(priority);
      if (task) filter.task = { $regex: task, $options: 'i' };

      const limitN = Math.min(100, Math.max(1, parseInt(limit)));
      const pageN = Math.max(1, parseInt(page));
      const skip = (pageN - 1) * limitN;
      const sortOrder = order === 'asc' ? 1 : -1;

      const [jobs, total] = await Promise.all([
        Job.find(filter)
          .sort({ [sortBy]: sortOrder })
          .skip(skip)
          .limit(limitN)
          .lean(),
        Job.countDocuments(filter),
      ]);

      return res.json({
        success: true,
        jobs,
        pagination: {
          total,
          page: pageN,
          limit: limitN,
          pages: Math.ceil(total / limitN),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /metrics — queue + job stats
   */
  async getMetrics(req, res, next) {
    try {
      const [queueMetrics, statusCounts] = await Promise.all([
        queueService.getMetrics(),
        Job.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]),
      ]);

      const statusMap = {};
      statusCounts.forEach(({ _id, count }) => { statusMap[_id] = count; });

      const total = Object.values(statusMap).reduce((a, b) => a + b, 0);
      const completed = statusMap.completed || 0;
      const failed = statusMap.failed || 0;
      const successRate = total > 0 ? ((completed / (completed + failed)) * 100).toFixed(2) : null;

      return res.json({
        success: true,
        queue: queueMetrics,
        jobs: statusMap,
        stats: { total, successRate },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /job/:id — cancel a queued job
   */
  async cancelJob(req, res, next) {
    try {
      const job = await Job.findById(req.params.id);
      if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
      if (job.status === JOB_STATUS.PROCESSING) {
        return res.status(409).json({ success: false, error: 'Cannot cancel a processing job' });
      }
      await Job.findByIdAndDelete(req.params.id);
      return res.json({ success: true, message: 'Job cancelled' });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new JobController();