# FB Live Comments System Design

## Table of Contents

- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Core Entities](#core-entities)
- [APIs](#apis)
- [High-Level Design](#high-level-design)
  - [Pagination](#pagination)
- [Deep Dive: WS vs SSE](#deep-dive-ws-vs-sse)
- [Scaling to Millions of Users](#scaling-to-millions-of-users)
- [Coordination](#coordination)
  - [Naive Pub/Sub](#naive-pubsub)
  - [Partitioned Pub/Sub](#partitioned-pubsub)
  - [Real-Time Dispatcher / Comment Service](#real-time-dispatcher-comment-service)
- [Zookeeper in This Design](#zookeeper-in-this-design)
- [Final System Design Summary](#final-system-design-summary)

## Functional Requirements
- Viewers can post comments on a live video.
- Viewers can see live comments in real time.
- Viewers can see past comments that were posted before they joined.

## Non-Functional Requirements
- Scale to 1M concurrent users.
- Broadcast comments with near real-time latency.
- Favor availability over strict consistency (CAP: availability > consistency).
- Keep latency under 200ms.

## Core Entities
- User: viewer or broadcaster
- Live Video
- Comment

## APIs

- `POST /comment/:liveVideoId`
  - Body:
    - `msg`: string
  - Header:
    - `Authorization`: JWT/session token
  - Response: `201 Created`
  - Purpose: create a new comment.

- `GET /comments/:liveVideoId?cursor={last_comment_id}&pageSize=10&sort=DESC`
  - Purpose: fetch comments for a live video with cursor-based pagination.

## High-Level Design

1. Viewers post comments on a live video.
   - The client sends a request to the comment service.
   - The service writes the comment to the database.
   - The service publishes the comment to the real-time delivery layer.

2. Viewers receive new comments while watching live video.
   - One option is polling with a `since` parameter.
   - Better option is a streaming connection, such as WebSockets or SSE.

3. Viewers can load past comments.
   - Users scroll up to fetch older comments.
   - Use cursor-based pagination instead of offset pagination.

### Pagination
- Offset pagination is inefficient at scale.
- Cursor pagination uses the last seen comment ID or timestamp as the starting point.
- The client updates the cursor as it scrolls.

## Deep Dive: WS vs SSE

- WebSockets (WS)
  - Full-duplex connection.
  - Good when read and write traffic are balanced.
- Server-Sent Events (SSE)
  - One-way streaming over HTTP.
  - Better when the system mostly pushes updates to clients.
  - Simpler for live comment broadcast-heavy scenarios.

## Scaling to Millions of Users

- Horizontal scaling is required.
- Two main problems:
  1. Coordination: how servers share comments for the same video across nodes.
  2. Viral traffic: some live streams may suddenly become extremely popular.

## Coordination

### Naive Pub/Sub
- Keep a mapping from `videoId` to connected clients.
- Example:
  ```json
  {
    "vdo1": ["conn1", "conn2"],
    "vdo2": ["conn6", "conn9"]
  }
  ```
- This does not scale because a single server cannot manage all connections.

### Partitioned Pub/Sub
- Partition the comment stream into channels keyed by `videoId`.
- Each real-time service node subscribes to relevant partitions.
- This allows horizontal scaling of both connections and comment delivery.

### Real-Time Dispatcher / Comment Service
- Separate the comment ingestion path from the delivery path.
- The comment service writes to DB and publishes to pub/sub.
- The real-time dispatcher consumes pub/sub events and sends them to clients.

## Zookeeper in This Design

- Zookeeper can be used as a coordination service to assign video IDs to specific servers.
- It is an optional component, not mandatory.
- If you need explicit assignment of `videoId` ownership for routing, Zookeeper can help.
- If your design uses pub/sub with dynamic subscriptions, Zookeeper is not required.

## Final System Design Summary

- `Comment Management Service`
  - Handles comment creation and history queries.
  - Persists comments to a database.
  - Publishes new comments to a messaging layer.
- `Real-Time Delivery Service`
  - Maintains WS/SSE connections to clients.
  - Subscribes to comment topics/partitions.
  - Broadcasts comments to connected viewers.
- `Pub/Sub / Messaging`
  - Decouples writes from delivery.
  - Supports horizontal fan-out by video ID partitioning.
- `Database`
  - Stores comments persistently.
  - Supports cursor-based pagination for history retrieval.
