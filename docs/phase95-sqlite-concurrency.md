# Phase 9.5 — SQLite Concurrency Limitation (Part 5)

## Status of this document

Confirmation + safety analysis of the Phase 9 Section B finding ("3+ parallel
writes can contend under SQLite"). **No database migration was undertaken**
(per the Phase 9.5 scope rules). Evidence was captured with a live probe
against the running dev server; the probe file was deleted after evidence
capture (not committed).

---

## 1. Finding CONFIRMED (reproduced 2026-09-14)

Probe: N independent `POST /api/tasks` requests issued in TRUE parallelism
(`Promise.all`), with **distinct idempotency keys** — isolating pure
write-contention from any duplicate/idempotency logic.

| Scenario | Requests | Outcomes |
| --- | --- | --- |
| A | 4 parallel task creations | `500, 201, 201, 500` — 2 succeeded, 2 failed |
| B | 6 parallel task creations (second household) | `500, 500, 500, 201, 201, 201` — 3 succeeded, 3 failed |

Server-side error signatures (dev.log):

- `PrismaClientKnownRequestError: Socket timeout (the database failed to
  respond to a query within the configured timeout)`
- `Transaction API error: Transaction already closed … The timeout for this
  transaction was 5000 ms` (interactive `$transaction` 5s default)

Mechanism: SQLite allows exactly ONE writer at a time. Prisma's interactive
transactions contend for the write lock; the 5-second interactive-transaction
timeout and query socket timeout expire while queued behind the other
writer → the transaction aborts → the route's fail-closed error path
responds `500 {"error":"Failed to create task"}`.

## 2. The application fails SAFELY (verified)

For every contended request:

- **Failed requests created NOTHING**: per-request task-row counts were
  `0 or 1` — never 2, never a partial row (task creation is a single
  `$transaction` with `jobNo` allocation; an aborted transaction leaves no
  row).
- **No duplicate rows**: each successful 2xx maps to exactly one complete
  task row with its own jobNo (the `jobNo @unique` constraint plus P2002
  retry additionally serialize numbering).
- **No financial/business corruption**: after the contention runs, the
  money-path invariants were re-checked across the whole escrow ledger —
  every row satisfies the designed identities
  (`commission + payout = originalAmount` and
  `originalAmount − discount = amount` for platform-funded discount rows;
  refunds accumulate per-row). One row initially flagged by a naive
  `amount = commission + payout` probe formula turned out to be a
  run-flows F6 **platform-funded discount** row (household pays 4000,
  vendor is made whole against the 5000 original: commission 500 + payout
  4500 = 5000) — correct by design, not corruption.
- Retrying a failed request succeeds once the write lock is free
  (key-independent, police-verified in Phase 9 Section B).

**Verdict: contention degrades availability (fail-closed 5xx), never
consistency.**

## 3. SQLite concurrency is NOT production-ready

For external/production deployment, the local single-file SQLite database
is unsuitable:

- One writer at a time; interactive transactions time out under concurrent
  write load (demonstrated above at 3+ parallel writers).
- A multi-replica deployment cannot share the file safely at all (no
  network file locking); the documented idempotency reconciliations
  (POST /api/tasks, NLU confirm-pass) rely on post-create reads that a
  DB-level unique constraint would make bulletproof.
- No statement-level concurrency guarantees beyond WAL readers.

## 4. Production database architecture REQUIRED before external deployment

The Railway production deployment ALREADY implements the required
direction (this is not new Phase 9.5 work):

- The repo `Dockerfile` ("Production Dockerfile for Railway (v2)")
  **auto-converts `provider = "sqlite"` → `"postgresql"` at build time**
  and `entrypoint.sh` refuses to start without a `DATABASE_URL` pointing
  at PostgreSQL (Railway injects it from a managed Postgres service).

To be production-complete, the PostgreSQL deployment additionally needs
(owner actions, tracked for Phase 10/16):

1. Managed PostgreSQL (e.g. Railway's Postgres) with automated
   backups/point-in-time recovery.
2. DB-level uniqueness for idempotency keys (unique index on
   `(householdId, idempotencyKey)` — today's reconciliation is
   application-level, valid for the single-process deployment).
3. Connection pooling appropriate to replica count.
4. Load/stress testing at realistic concurrency (the e2e suites exercise
   correctness, not throughput).

## 5. Small, low-risk graceful-failure improvements (IDENTIFIED, deliberately NOT implemented in Phase 9.5)

Per the Phase 9.5 instruction to identify (not expand scope), candidates
for a future approved change:

1. **Map SQLite contention errors to 503 + `Retry-After`** instead of 500
   on write routes (Prisma `P2024`/transaction-timeout classification) —
   a small central error-mapping change; makes "retry later" explicit to
   clients and monitoring.
2. **Raise the interactive-transaction timeout for money-critical
   transactions only** (`db.$transaction(fn, { timeout })`, default 5000ms
   → e.g. 15000ms for escrow/refund paths) — trades latency for
   completion under moderate contention; zero schema change.
3. **Idempotent client retry hint** in the `500` body
   (e.g. `{"error":"…","retryable":true}`) — enables the UI to auto-retry
   safely on routes already protected by idempotency keys.

None of these change the database architecture; none were applied in this
phase.
