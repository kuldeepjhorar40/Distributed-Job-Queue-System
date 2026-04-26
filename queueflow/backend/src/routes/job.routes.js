'use strict';

const { Router } = require('express');
const jobController = require('../controllers/job.controller');

const router = Router();

// =======================
// Job CRUD
// =======================

// ✅ POST /job
router.post('/', jobController.createJob.bind(jobController));

// ✅ GET /job/:id
router.get('/:id', jobController.getJob.bind(jobController));

// ✅ GET /job/jobs (list all jobs)
router.get('/jobs', jobController.getJobs.bind(jobController));

// ✅ DELETE /job/:id
router.delete('/:id', jobController.cancelJob.bind(jobController));

// =======================
// Metrics
// =======================

// ✅ GET /job/metrics
router.get('/metrics', jobController.getMetrics.bind(jobController));

module.exports = router;