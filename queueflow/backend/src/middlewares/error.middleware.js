'use strict';

const logger = require('../utils/logger');

/**
 * Global error handler — must be registered last in Express middleware chain.
 */
function errorMiddleware(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    status = 400;
    const errors = Object.values(err.errors).map(e => e.message);
    message = errors.join(', ');
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }

  // Duplicate key
  if (err.code === 11000) {
    status = 409;
    message = 'Duplicate key error';
  }

  logger.error(`${req.method} ${req.path} → ${status}: ${message}`, {
    stack: err.stack?.split('\n')[1]?.trim(),
  });

  res.status(status).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = errorMiddleware;