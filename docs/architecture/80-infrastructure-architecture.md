# Infrastructure Architecture

## Goals

- production-ready deployment
- horizontal API scaling
- reliable background processing
- isolated environments
- observable services
- safe database operations
- offline-friendly POS support
- secure external integrations

## Initial topology

```text
Internet
  ↓
CDN / Edge
  ↓
WAF / Reverse Proxy / Load Balancer
  ↓
API Application Instances
  ↓
PostgreSQL
  ↓
Redis
  ↓
Object Storage
  ↓
Background Workers
```

External systems:

```text
Payment Providers
Delivery Providers
Email/SMS Providers
```

## Recommended deployment style

Start with a modular monolith deployed as:

```text
api
worker
scheduler
```

from the same codebase/artifact family.

Do not split into microservices before load/team/operational boundaries justify it.

## Stateful services

Keep application instances stateless.

State belongs in:

```text
PostgreSQL
Redis
Object Storage
Message/Job infrastructure
```

POS local state remains on POS device and syncs to server.

## Edge responsibilities

- TLS termination
- request size limits
- rate limiting
- bot/DDoS controls
- routing
- compression
- static asset caching

## Object storage

Use for:

- product images
- proof-of-delivery photos
- return inspection evidence
- invoice PDFs if generated
- exports
- backups/artifacts where appropriate

Do not store large binary files inside core transactional tables.
