'use strict';

const { Router } = require('express');
const jobController = require('../controllers/job.controller');

const router = Router();

// Job CRUD
router.post('/job', jobController.createJob.bind(jobController));
router.get('/job/:id', jobController.getJob.bind(jobController));
router.get('/jobs', jobController.getJobs.bind(jobController));
router.delete('/job/:id', jobController.cancelJob.bind(jobController));

// Metrics
router.get('/metrics', jobController.getMetrics.bind(jobController));

module.exports = router;