cd backend
npm install
1.terminal 1:-
    wsl -d Ubuntu
    redis-server
2.terminal 2:- 
    mongod --dbpath C:\data\db
3.terminal 3:-
    npx nodemen src/workers/worker.js
4.terminal 4:-
    node src/server.js
5.powershell command:-
    Invoke-RestMethod -Uri "http://localhost:3000/job" `
    -Method POST `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body '{"task":"email","payload":{"to":"test@gmail.com"}}'



















# QueueFlow

A production-grade distributed job queue system inspired by Kafka and RabbitMQ. Built on Node.js, Redis, and MongoDB — with a real-time dashboard and interactive simulator.

---

## Table of contents

- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Running workers](#running-workers)
- [Docker](#docker)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
- [Contributing](#contributing)

---

## Architecture

```
Producers (REST API / cron / webhooks)
        │
        ▼
  ┌─────────────────────────┐
  │  Redis Queue Layer       │
  │  • Priority queue (ZADD) │  ← priority ≥ 7
  │  • FIFO queue (RPUSH)    │  ← priority < 7
  └─────────────┬───────────┘
                │  BLPOP / ZPOPMAX
                ▼
  ┌─────────────────────────┐
  │  Worker Pool             │
  │  • Configurable slots    │
  │  • Exponential backoff   │
  │  • Dead Letter Queue     │
  └─────────────┬───────────┘
                │  Write results
                ▼
         MongoDB (persistent job store)
```

Jobs with priority ≥ 7 enter a Redis sorted set and are always dequeued before lower-priority jobs. Within the same priority tier, jobs are processed in FIFO order. Failed jobs are retried with exponential backoff (2s → 4s → 8s → 16s → 32s + jitter). After exhausting all retries, jobs move to the Dead Letter Queue for manual inspection.

---

## Tech stack

| Layer | Technology |
|---|---|
| API server | Node.js 18+, Express 4 |
| Queue | Redis 7 (ioredis) |
| Database | MongoDB 7 (Mongoose) |
| Worker | Native Node.js child process |
| Logging | Winston |
| Frontend | Vanilla HTML / CSS / JS |
| Container | Docker + docker-compose |

---

## Quick start

### Prerequisites

- Node.js 18+
- Redis 7 running on `localhost:6379`
- MongoDB 7 running on `localhost:27017`

```bash
# 1. Clone
git clone https://github.com/yourname/queueflow.git
cd queueflow/backend

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env as needed

# 4. Start the API server
npm run dev

# 5. Start a worker (separate terminal)
npm run worker
```

Open `frontend/index.html` in a browser (or serve it with `npx serve ../frontend`).

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | API server port |
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `MONGO_URI` | `mongodb://localhost:27017/queueflow` | MongoDB connection string |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | _(empty)_ | Redis password (if AUTH enabled) |
| `QUEUE_NAME` | `job_queue` | Standard FIFO queue key |
| `PRIORITY_QUEUE_NAME` | `job_queue_priority` | Priority sorted-set key |
| `DEAD_LETTER_QUEUE` | `dlq` | Dead letter queue key |
| `MAX_RETRIES` | `5` | Max retry attempts per job |
| `RETRY_BASE_DELAY_MS` | `2000` | Base backoff delay in ms |
| `WORKER_CONCURRENCY` | `3` | Parallel job slots per worker process |
| `WORKER_POLL_INTERVAL_MS` | `500` | Worker poll interval (non-blocking path) |
| `LOG_LEVEL` | `info` | Winston log level |

---

## API reference

### `POST /job`

Create and enqueue a new job.

**Request body**

```json
{
  "task": "send_email",
  "priority": 8,
  "payload": {
    "to": "user@example.com",
    "template": "welcome"
  },
  "maxRetries": 5
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `task` | string | Yes | Task handler name |
| `priority` | number 1–10 | No | Default `5`. ≥ 7 enters priority queue |
| `payload` | object | No | Arbitrary data passed to handler |
| `maxRetries` | number | No | Default `5` |

**Response `201 Created`**

```json
{
  "success": true,
  "job": {
    "_id": "64f3a1b2c9e8d70012345678",
    "task": "send_email",
    "status": "queued",
    "priority": 8,
    "retries": 0,
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

### `GET /job/:id`

Retrieve a single job by MongoDB ID.

**Response `200 OK`**

```json
{
  "success": true,
  "job": {
    "_id": "64f3a1b2c9e8d70012345678",
    "task": "send_email",
    "status": "completed",
    "priority": 8,
    "retries": 0,
    "result": { "sent": true },
    "durationMs": 142,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "completedAt": "2024-01-15T10:30:02.000Z"
  }
}
```

---

### `GET /jobs`

Paginated job listing with optional filters.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `status` | string | Filter by status: `queued`, `processing`, `completed`, `failed`, `retrying`, `dead` |
| `priority` | number | Filter by exact priority |
| `task` | string | Case-insensitive partial match on task name |
| `limit` | number | Page size (default `20`, max `100`) |
| `page` | number | Page number (default `1`) |
| `sortBy` | string | Field to sort by (default `createdAt`) |
| `order` | string | `asc` or `desc` (default `desc`) |

**Response `200 OK`**

```json
{
  "success": true,
  "jobs": [ /* array of job objects */ ],
  "pagination": {
    "total": 1284,
    "page": 1,
    "limit": 20,
    "pages": 65
  }
}
```

---

### `DELETE /job/:id`

Cancel a queued job. Returns `409` if the job is currently processing.

---

### `GET /metrics`

Queue and job statistics.

```json
{
  "success": true,
  "queue": {
    "standard": 14,
    "priority": 3,
    "deadLetter": 2,
    "total": 17
  },
  "jobs": {
    "queued": 17,
    "processing": 3,
    "completed": 1241,
    "failed": 23
  },
  "stats": {
    "total": 1284,
    "successRate": "98.18"
  }
}
```

---

### `GET /health`

Readiness probe — returns `200` when both Redis and MongoDB are reachable, `503` otherwise.

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "services": {
    "redis": "ok",
    "mongo": "ok"
  },
  "version": "1.0.0"
}
```

---

## Running workers

Each worker process opens `WORKER_CONCURRENCY` parallel blocking connections to Redis.

```bash
# Single worker (3 concurrent slots by default)
npm run worker

# Three separate worker processes
npm run worker:multi

# Scale manually
WORKER_CONCURRENCY=10 node src/workers/worker.js
```

Workers auto-recover stuck jobs (processing status for > 5 minutes) on a 60-second interval. This handles crashed worker processes without manual intervention.

---

## Docker

```bash
# Build and start all services
docker-compose up --build

# Run in background
docker-compose up -d

# Scale workers
docker-compose up -d --scale worker=5

# Tear down (keeps MongoDB data volume)
docker-compose down

# Full reset including data
docker-compose down -v
```

Services defined in `docker-compose.yml`:

| Service | Port | Notes |
|---|---|---|
| `api` | `3000` | Express API server |
| `worker` | — | Job worker (no exposed port) |
| `redis` | `6379` | Redis 7 Alpine |
| `mongo` | `27017` | MongoDB 7 |

---

## Project structure

```
queueflow/
├── frontend/                   # Vanilla HTML/CSS/JS dashboard
│   ├── index.html
│   ├── styles/
│   │   ├── main.css            # Design system + layout
│   │   ├── components.css      # Component overrides
│   │   └── animations.css      # Keyframes + transitions
│   └── scripts/
│       ├── main.js             # Theme, navbar, hero animation
│       ├── api.js              # API client module
│       ├── dashboard.js        # Live metrics + charts
│       └── simulation.js       # Interactive queue simulator
│
├── backend/
│   ├── src/
│   │   ├── server.js           # Entry point — DB/Redis boot + listen
│   │   ├── app.js              # Express app — middleware + routes
│   │   ├── config/
│   │   │   ├── env.js          # Environment variable config
│   │   │   ├── db.js           # MongoDB connection
│   │   │   └── redis.js        # Redis connection + client factory
│   │   ├── models/
│   │   │   └── job.model.js    # Mongoose Job schema
│   │   ├── routes/
│   │   │   └── job.routes.js   # Express router
│   │   ├── controllers/
│   │   │   └── job.controller.js
│   │   ├── services/
│   │   │   ├── queue.service.js  # Redis RPUSH/BLPOP/ZADD operations
│   │   │   ├── worker.service.js # Task handler registry
│   │   │   └── retry.service.js  # Exponential backoff + DLQ
│   │   ├── workers/
│   │   │   └── worker.js       # Worker process entry point
│   │   ├── middlewares/
│   │   │   ├── logger.middleware.js  # Request ID + timing
│   │   │   └── error.middleware.js   # Global error handler
│   │   └── utils/
│   │       ├── backoff.js      # computeBackoff + sleep
│   │       ├── constants.js    # JOB_STATUS, PRIORITY enums
│   │       └── logger.js       # Winston logger
│   ├── package.json
│   └── .env
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
└── README.md
```

---

## How it works

### Job lifecycle

```
POST /job → [queued] → Redis queue → Worker dequeues → [processing]
                                                              │
                              ┌───────────────────────────────┤
                              │                               │
                         success                           failure
                              │                               │
                        [completed]              retries < maxRetries?
                                                    │           │
                                                   yes          no
                                                    │           │
                                             [retrying]      [dead]
                                             + backoff      → DLQ
                                                    │
                                             back to queue
```

### Priority queue

Jobs with `priority >= 7` are stored in a Redis sorted set (`ZADD`) with a composite score of `priority * 10^13 + timestamp`. This ensures:

1. Higher priority jobs are always dequeued first (`ZPOPMAX`).
2. Within the same priority level, FIFO ordering is preserved via the timestamp.

Standard jobs (`priority < 7`) use a Redis list (`RPUSH` / `BLPOP`) for pure FIFO throughput.

### Exponential backoff

Retry delay is computed as: `delay = baseMs × 2^attempt + jitter(0..baseMs)`, capped at 5 minutes.

| Attempt | Base delay | With jitter (example) |
|---|---|---|
| 1 | 2s | 2.8s |
| 2 | 4s | 5.4s |
| 3 | 8s | 9.1s |
| 4 | 16s | 17.6s |
| 5 | 32s | 33.9s |

---

## Adding a custom task handler

Open `src/services/worker.service.js` and add a handler to the `handlers` object:

```js
async my_custom_task(payload) {
  // Your async logic here
  await callExternalService(payload.url);
  return { processed: true };
}
```

That's it. The worker will automatically route jobs with `task: "my_custom_task"` to your handler.

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit: `git commit -m 'feat: add my feature'`
4. Push: `git push origin feat/my-feature`
5. Open a pull request

Please follow the existing code style (single quotes, `'use strict'`, explicit error handling).

---

## License

MIT — see [LICENSE](LICENSE) for details.