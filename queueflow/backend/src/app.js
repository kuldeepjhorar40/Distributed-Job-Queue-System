'use strict';

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { NODE_ENV } = require('./config/env');
const loggerMiddleware = require('./middlewares/logger.middleware');
const errorMiddleware = require('./middlewares/error.middleware');
const jobRoutes = require('./routes/job.routes');
const logger = require('./utils/logger');

const app = express();

// ── Trust proxy (for accurate IPs behind load balancers / Docker) ──────────
app.set('trust proxy', 1);

// ── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'];

app.use(cors({
  origin(origin, cb) {
    // Allow requests with no origin (curl, Postman, mobile apps)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ── Body parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// ── HTTP request logging ───────────────────────────────────────────────────
if (NODE_ENV !== 'test') {
  app.use(NODE_ENV === 'production'
    ? morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } })
    : morgan('dev')
  );
}

// ── Structured request logger (adds req-id, timing) ───────────────────────
app.use(loggerMiddleware);

// ── Health check (no auth, no rate-limit — used by Docker/k8s probes) ─────
app.get('/health', async (req, res) => {
  const { redis } = require('./config/redis');
  const mongoose = require('mongoose');

  let redisStatus = 'ok';
  try {
    await redis.ping();
  } catch {
    redisStatus = 'error';
  }

  const mongoStatus = mongoose.connection.readyState === 1 ? 'ok' : 'error';
  const healthy = redisStatus === 'ok' && mongoStatus === 'ok';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    services: { redis: redisStatus, mongo: mongoStatus },
    version: process.env.npm_package_version || '1.0.0',
  });
});

// ── Rate limiting ──────────────────────────────────────────────────────────
// Inline implementation — avoids adding express-rate-limit as a hard dep.
// Swap with express-rate-limit in production for Redis-backed distributed limits.
const rateLimitStore = new Map();

function rateLimit({ windowMs = 60_000, max = 100, message = 'Too many requests' } = {}) {
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count++;
    rateLimitStore.set(key, entry);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      return res.status(429).json({ success: false, error: message });
    }
    next();
  };
}

// Job creation: 60 req / min per IP
app.use('/job', rateLimit({ windowMs: 60_000, max: 60, message: 'Job submission rate limit exceeded' }));

// General API: 200 req / min per IP
app.use('/jobs', rateLimit({ windowMs: 60_000, max: 200 }));
app.use('/metrics', rateLimit({ windowMs: 60_000, max: 200 }));

// ── API routes ─────────────────────────────────────────────────────────────
app.use('/', jobRoutes);

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler (must be last) ───────────────────────────────────
app.use(errorMiddleware);

module.exports = app;