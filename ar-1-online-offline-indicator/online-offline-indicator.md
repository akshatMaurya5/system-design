# Online / Offline Indicator

## Overview

Determine whether a user is currently online or offline in a distributed service.

## Use Case

- Track user presence.
- Report status as either `online` or `offline`.
- Support large-scale user populations.

## Example Representation

- `user1`: `online` | `offline`
- `user2`: `online` | `offline`

## Initial Plan

- Use a key-value model.
- Store user presence state as a timestamp or boolean.

### Candidate models

1. `user_id -> status`
   - `status`: `online` or `offline`
   - Simple, but requires frequent updates and full storage of all users.
2. `user_id -> last_seen_timestamp`
   - `last_seen_ts`: integer timestamp.
   - Derive online/offline from recency.

## Key Questions

- How often should the system check presence?
- Will the client send a heartbeat or keep-alive ping?
- After how long should a user be marked offline?
- Should TTL vary by use case or client type?

## Presence Timeout

- The offline threshold is subjective.
- Some systems require a short window (e.g. 10 seconds).
- Others can tolerate longer inactivity (e.g. 10 minutes).
- Finalize TTL based on the application requirements.

## Storage Model

- Store only active users if possible.
- Recommended format:
  - `user_id -> last_seen_ts`
  - `user_id`: 4 bytes
  - `last_seen_ts`: 4 bytes
  - Total per record: 8 bytes
- For 1 billion users, the storage estimate is about 8 GB.

## Optimization

### Online-only store

- Keep entries only for currently online users.
- Evict users after they stop refreshing before the TTL expires.
- This reduces storage when most users are inactive.

### Eviction strategy

- Use TTL-based eviction.
- Perform periodic cleanup or lazy eviction on query.

## Performance Considerations

### Throughput

- Heartbeat updates are small and frequent.
- Use a datastore optimized for fast writes and expirations.

### Network efficiency

- Avoid creating a new TCP connection for every heartbeat.
- Use connection pooling to reduce connection setup overhead.
- Connection setup can add multiple round trips.

## Scaling Considerations

- Partition user state by user ID or shard key.
- Use in-memory caches for recent online users.
- Persist state in a fast key-value store with TTL support.

## Summary

- Track presence by last-seen timestamp.
- Derive online/offline from recency.
- Store only active users when feasible.
- Use TTL-based eviction and connection pooling for high throughput.

