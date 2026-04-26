'use strict';

const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

/**
 * Request logger middleware.
 *
 * Attaches a unique request ID to every request and response,
 * logs structured metadata on completion (method, path, status, duration, ip).
 *
 * The request ID is forwarded as X-Request-Id so clients / load balancers
 * can correlate log lines with specific requests.
 */
function loggerMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || randomUUID();
  const startAt = process.hrtime.bigint();

  // Attach to req so controllers can log in context
  req.requestId = requestId;
  req.startAt = startAt;

  // Echo back to client
  res.setHeader('X-Request-Id', requestId);

  // Log on response finish (captures real status + duration)
  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - startAt;
    const durationMs = Number(durationNs / 1_000_000n);

    const level = res.statusCode >= 500 ? 'error'
      : res.statusCode >= 400 ? 'warn'
      : 'info';

    logger[level](`${req.method} ${req.path}`, {
      requestId,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
  });

  // Log abandoned requests (client disconnect before response)
  res.on('close', () => {
    if (!res.writableEnded) {
      logger.warn(`Request abandoned: ${req.method} ${req.path}`, { requestId });
    }
  });

  next();
}

module.exports = loggerMiddleware;