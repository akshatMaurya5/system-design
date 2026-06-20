# Scheduled HTTP Ping System

## Table of Contents
- [Overview](#overview)
- [Use Case](#use-case)
- [Example Representation](#example-representation)
- [Architecture](#architecture)
- [Initial Plan](#initial-plan)
  - [Candidate models](#candidate-models)
- [Key Questions](#key-questions)
- [Scheduling Precision](#scheduling-precision)
- [Storage Model](#storage-model)
  - [Job record example](#job-record-example)
- [Querying for Due Jobs](#querying-for-due-jobs)
- [Optimization](#optimization)
  - [Due-jobs-only dispatch](#due-jobs-only-dispatch)
  - [Dedup and idempotency](#dedup-and-idempotency)
- [Performance Considerations](#performance-considerations)
  - [Throughput](#throughput)
  - [Network efficiency](#network-efficiency)
- [Scaling Considerations](#scaling-considerations)
- [Summary](#summary)

## Overview
Fire HTTP requests against configured URLs on a recurring schedule (cron-like), reliably and at scale, without double-firing or silently dropping jobs.

## Use Case
- Let users register jobs with a target URL, method, and a schedule (cron expression or interval).
- Execute each job at its scheduled time and record the outcome.
- Support a large number of jobs with independent, possibly overlapping schedules.

## Example Representation
- `job1`: `https://api.example.com/health` every `5m`
- `job2`: `https://example.com/webhook` at `0 * * * *` (hourly)

## Architecture
```mermaid
flowchart TD
    Client[Client] --> API[Scheduling API]
    API --> JobStore[(Job store)]
    Scheduler[Scheduler cluster] --> JobStore
    JobStore --> Queue[[Task queue]]
    Queue --> Workers[Worker pool]
    Workers --> Target((Target URLs))
    Workers --> Results[(Results store)]
    Results --> Alert[Alerting]
```
- **Scheduling API**: client-facing CRUD for jobs.
- **Job store**: source of truth, indexed by `next_run_time`.
- **Scheduler cluster**: leader-elected or sharded; polls due jobs and enqueues them.
- **Task queue**: decouples "what's due" from "actually calling it."
- **Worker pool**: makes the HTTP call, retries on failure, writes results.
- **Results store + alerting**: execution log and failure notifications.

## Initial Plan
- Use a key-value / relational model for job definitions.
- Derive "due now" from a stored next-run timestamp rather than re-evaluating the cron expression on every tick.

### Candidate models
1. `job_id -> cron_expression`
   - Recompute "is this due" on every scheduler tick by evaluating the cron expression.
   - Simple, but expensive at scale — every tick re-parses every job's schedule.
2. `job_id -> next_run_time`
   - Precompute the next run time once, store it, and index it.
   - Scheduler query becomes a cheap range scan: `WHERE next_run_time <= now`.

## Key Questions
- How precise does "scheduled time" need to be (second-level vs minute-level)?
- Polling vs an in-memory timing wheel — does the use case tolerate poll latency?
- What happens when a target URL is slow, down, or returns an error?
- How many scheduler replicas run concurrently, and how do they avoid double-firing the same job?

## Scheduling Precision
- The acceptable drift between scheduled time and actual fire time is subjective.
- Minute-grained cron jobs tolerate a poll interval of 10–60 seconds.
- Sub-second precision needs an in-memory timing wheel instead of DB polling.
- Finalize the poll interval (or wheel granularity) based on the application's tolerance for drift.

## Storage Model
- Store one row per job:
  - `job_id`: identifier
  - `url`, `method`, `headers`, `body`: request definition
  - `schedule`: cron expression or interval
  - `next_run_time`: indexed, drives the scheduler query
  - `timeout`, `retry_policy`: execution behavior
- For millions of jobs, the dominant cost is the `next_run_time` index, not the row payload itself — keep it narrow and indexed.

### Job record example
```json
{
  "job_id": "job_8f3a1c2e",
  "owner_id": "user_4471",
  "url": "https://api.example.com/health",
  "method": "GET",
  "headers": { "Authorization": "Bearer ***" },
  "body": null,
  "schedule": "*/5 * * * *",
  "timezone": "UTC",
  "next_run_time": 1750425300,
  "last_run_time": 1750425000,
  "last_status": "success",
  "timeout_ms": 5000,
  "retry_policy": { "max_attempts": 3, "backoff": "exponential" },
  "status": "active",
  "created_at": 1748000000,
  "updated_at": 1750425000
}
```
- `next_run_time` is the only field the scheduler queries on — it's the indexed column, recomputed from `schedule` plus jitter after every dispatch.
- `status` (`active` / `paused` / `disabled`) lets the scheduler's query exclude paused jobs cheaply.
- `last_status` / `last_run_time` are denormalized onto the row for fast health checks without joining into the results store.

## Querying for Due Jobs
The scheduler's core loop is a claim-and-advance transaction, run every poll interval (e.g. every 10–30 seconds) by each scheduler shard:

```sql
-- Step 1: claim a batch of due, unclaimed jobs for this shard
SELECT job_id, url, method, headers, body, schedule, retry_policy
FROM jobs
WHERE status = 'active'
  AND next_run_time <= :now
  AND shard_id = :this_shard
ORDER BY next_run_time
LIMIT 500
FOR UPDATE SKIP LOCKED;

-- Step 2: for each claimed job, advance next_run_time before dispatching
UPDATE jobs
SET next_run_time = :computed_next_run_time,  -- schedule's next occurrence + jitter
    updated_at = :now
WHERE job_id = :job_id;
```

- `FOR UPDATE SKIP LOCKED` lets multiple scheduler replicas run this same query concurrently without blocking on each other — each row is claimed by exactly one shard's transaction, and any row another transaction already has locked is silently skipped rather than waited on.
- `LIMIT 500` caps batch size so a single poll doesn't try to claim millions of rows at once; tune this against your queue's ingest rate.
- `shard_id = :this_shard` is only needed if you're sharding the table by hash range — otherwise every replica can poll the same query and rely purely on `SKIP LOCKED` for coordination.
- `next_run_time` is advanced *before* the job is handed to the queue, not after execution — so a slow or failed HTTP call downstream never blocks the next scheduled occurrence from being claimed on time.
- Both statements run in a single transaction per batch, committed together, so a crash mid-batch never leaves a job claimed-but-not-rescheduled.

## Optimization

### Due-jobs-only dispatch
- The scheduler never scans the whole job table — only the `next_run_time` index range that's due.
- After dispatch, `next_run_time` is atomically advanced (see query above) so the job isn't picked up again before its next occurrence.

### Dedup and idempotency
- Tag each dispatched task with a `(job_id, scheduled_time)` key.
- If a queue message is redelivered (at-least-once delivery), the worker can detect and skip a duplicate execution for the same key.

## Performance Considerations

### Throughput
- The claim query above is the scheduler's main DB load — batch it, and jitter `next_run_time` across jobs sharing the same schedule so claims don't spike in lockstep every interval.
- Worker pool should be stateless and horizontally scalable, since HTTP call latency to external targets is the main bottleneck, not local compute.

### Network efficiency
- Reuse HTTP connections / connection pools per target host instead of opening a new TCP (and TLS) connection per ping.
- Apply a circuit breaker per target URL so a single dead endpoint doesn't tie up the whole worker pool.
- Connection setup (TCP + TLS handshake) can add multiple round trips per request if not pooled.

## Scaling Considerations
| Concern | What happens at scale | Mitigation |
|---|---|---|
| Hot index range | Many jobs sharing a schedule cluster their `next_run_time` into the same instant, causing a spike every interval | Jitter `next_run_time` by a few seconds per job |
| Row contention | Multiple scheduler shards racing to claim overlapping rows | `FOR UPDATE SKIP LOCKED` so contending shards skip instead of blocking |
| Write amplification | Every dispatch requires an UPDATE to advance `next_run_time` — at high job counts this becomes the dominant DB write load | Batch the claim + advance into one transaction per poll, not one per job |
| Queue throughput | 10M jobs at a 5-minute average interval is ≈33k dispatches/sec sustained | Size queue and workers for the sustained rate plus burst headroom |
| Target-side limits | Many jobs pinging one popular host can look like a DDoS | Per-target-host rate limiting / circuit breaker in the worker pool |
| Single DB ceiling | One Postgres/MySQL instance tops out in the low tens of thousands of writes/sec | Partition the job table by hash range across multiple DB instances |

- Shard the job table or the scheduler's claim range by `job_id` hash to spread load across scheduler replicas.
- Use a message queue (Kafka, SQS, Redis streams) to absorb bursts of due jobs without blocking the scheduler.
- Persist execution results in a write-optimized store, since result volume scales with execution frequency, not job count.

## Final design
<img width="573" height="620" alt="image" src="https://github.com/user-attachments/assets/ebc99305-2f90-4a91-a7a0-0a05ce0abf0a" />


## Summary
- Drive scheduling off a stored, indexed `next_run_time` rather than re-evaluating cron expressions on every tick.
- Claim due jobs with a batched `FOR UPDATE SKIP LOCKED` query, advancing `next_run_time` in the same transaction before dispatch.
- Decouple "deciding what's due" (scheduler) from "doing the work" (worker pool) via a task queue.
- Use leader election or sharding to avoid duplicate dispatch across scheduler replicas, plus a dedup key to avoid duplicate execution.
- Use connection pooling, per-target circuit breakers, and `next_run_time` jitter to keep throughput high and avoid hot spots as job count grows.
