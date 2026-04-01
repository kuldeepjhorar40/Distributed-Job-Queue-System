# API Documentation — Distributed Job Queue System

Base URL: `http://localhost:3000/api/v1`

All responses use the envelope format:
```json
{ "success": true|false, "data": {}, "error": {} }
```

---

## Authentication

Not implemented in this scaffold. In production, add JWT/API-key middleware in `src/middleware/`.

---

## Endpoints

### Health Check

**GET** `/health`

Liveness probe — no auth required.

**Response 200**
```json
{ "status": "ok", "timestamp": "2024-01-15T10:30:00.000Z" }
```

---

### Create Job

**POST** `/api/v1/jobs`

Enqueues a new job. Supply `idempotencyKey` to prevent duplicate submission.

**Headers**
```
Content-Type: application/json
```

**Request Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | ✅ | Handler type, e.g. `email.send`, `report.generate` |
| `payload` | any | ✅ | Job-specific data passed to the handler |
| `priority` | `high` \| `medium` \| `low` | ❌ | Default: `medium` |
| `idempotencyKey` | string | ❌ | Caller-supplied dedup key (max 255 chars) |
| `maxAttempts` | number | ❌ | Max retries (1–10). Default: 3 |
| `metadata` | object | ❌ | Arbitrary metadata (tenant ID, trace ID, etc.) |
| `scheduledFor` | ISO 8601 date | ❌ | Delay execution until this timestamp |

**Example Request**
```json
{
  "type": "email.send",
  "payload": {
    "to": "user@example.com",
    "subject": "Welcome!",
    "template": "welcome"
  },
  "priority": "high",
  "idempotencyKey": "welcome-email-user-42",
  "maxAttempts": 5,
  "metadata": { "tenantId": "acme-corp" }
}
```

**Response 201** — Job created
```json
{
  "success": true,
  "created": true,
  "data": {
    "_id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "email.send",
    "status": "pending",
    "priority": "high",
    "attempts": 0,
    "maxAttempts": 5,
    "payload": { "to": "user@example.com", "subject": "Welcome!", "template": "welcome" },
    "metadata": { "tenantId": "acme-corp" },
    "idempotencyKey": "welcome-email-user-42",
    "queuedAt": "2024-01-15T10:30:00.000Z",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Response 200** — Idempotent (key already seen, returning existing job)
```json
{
  "success": true,
  "created": false,
  "data": { ... }
}
```

**Response 422** — Validation error
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "type", "message": "type is required" }
    ]
  }
}
```

**Response 429** — Rate limited
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Job creation rate limit exceeded. Max 30 jobs/minute.",
    "retryAfter": 60
  }
}
```

---

### Get Job

**GET** `/api/v1/jobs/:id`

**Response 200**
```json
{
  "success": true,
  "data": {
    "_id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "email.send",
    "status": "completed",
    "priority": "high",
    "attempts": 1,
    "result": { "sent": true, "messageId": "msg_1705312200000" },
    "startedAt": "2024-01-15T10:30:01.000Z",
    "completedAt": "2024-01-15T10:30:01.150Z",
    "processingTimeMs": 150,
    "queueWaitMs": 1000,
    "workerId": "worker_a1b2c3d4"
  }
}
```

**Response 404** — Job not found

---

### List Jobs

**GET** `/api/v1/jobs`

**Query Parameters**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter: `pending`, `processing`, `completed`, `failed`, `dead`, `cancelled` |
| `priority` | string | Filter: `high`, `medium`, `low` |
| `type` | string | Filter by job type |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (1–100, default: 20) |
| `sort` | string | `createdAt`, `-createdAt`, `priority`, `queuedAt`, `-queuedAt` |
| `from` | ISO date | Filter by `createdAt >= from` |
| `to` | ISO date | Filter by `createdAt <= to` |

**Example**
```
GET /api/v1/jobs?status=failed&priority=high&page=1&limit=10&sort=-createdAt
```

**Response 200**
```json
{
  "success": true,
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 42,
    "pages": 5
  },
  "data": [
    { "_id": "...", "type": "email.send", "status": "failed", ... }
  ]
}
```

---

### Cancel Job

**DELETE** `/api/v1/jobs/:id`

Cancels a `pending` or `failed` job. Has no effect on `processing` or `completed` jobs.

**Response 200**
```json
{
  "success": true,
  "data": { "_id": "...", "status": "cancelled", ... }
}
```

**Response 400** — Cannot cancel (wrong status)
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Cannot cancel job in status: processing"
  }
}
```

---

### Retry Job

**POST** `/api/v1/jobs/:id/retry`

Manually re-queues a `failed` or `dead` job, resetting the attempt counter.

**Response 200**
```json
{
  "success": true,
  "data": { "_id": "...", "status": "pending", ... }
}
```

---

### Queue Statistics

**GET** `/api/v1/jobs/stats`

**Response 200**
```json
{
  "success": true,
  "data": {
    "database": {
      "pending":    { "count": 12, "avgAttempts": 0 },
      "processing": { "count": 5,  "avgAttempts": 1 },
      "completed":  { "count": 9841, "avgAttempts": 1.1 },
      "failed":     { "count": 23, "avgAttempts": 2.8 },
      "dead":       { "count": 4,  "avgAttempts": 3 }
    },
    "queue": {
      "queues": { "high": 2, "medium": 8, "low": 2 },
      "processing": 5,
      "retryScheduled": 3,
      "deadLetter": 4,
      "total": 12
    }
  }
}
```

---

## Job Statuses

| Status | Description |
|--------|-------------|
| `pending` | Queued, waiting for a worker |
| `processing` | Claimed by a worker, executing now |
| `completed` | Finished successfully |
| `failed` | Failed, scheduled for retry |
| `dead` | Exhausted max retries, in dead letter queue |
| `cancelled` | Cancelled by caller before processing |

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 422 | Request body/query failed schema validation |
| `NOT_FOUND` | 404 | Job ID does not exist |
| `CONFLICT` | 409 | Duplicate unique field (e.g. idempotencyKey race) |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| All endpoints | 100 requests / 60 seconds / IP |
| `POST /api/v1/jobs` | 30 requests / 60 seconds / IP |

Rate limit status is returned in response headers:
```
RateLimit-Limit: 100
RateLimit-Remaining: 87
RateLimit-Reset: 1705312260
```
