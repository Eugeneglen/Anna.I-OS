# Anna.I — Worklog

---
Task ID: 1
Agent: Main
Task: Phase 1 — Household Graph Schema Design + Migration + Seed

Work Log:
- Read all 3 project documents (Dev_Kickoff_Prompt.md, Anna_I.md/CLAUDE.md, BrandID.md)
- Proposed full 13-table schema (11 from spec + Notification table per user request)
- User signed off on schema proposal
- Wrote Prisma schema with Postgres-compatible types (Json for JSONB, String for arrays — SQLite limitations)
- Fixed Notification model: polymorphic recipientId → separate memberId/vendorId + householdId
- Fixed Booking model: added back-relations for VerificationPhoto[] and EscrowLedger[]
- Ran db:push successfully (SQLite at db/custom.db)
- Seeded 20 autonomy level thresholds (4 categories × 5 levels: Cleaning/Laundry=2 cycles, Aircon/Handyman=3 cycles)
- Seeded 3 demo households, 4 family members, 5 vendors, 3 subscriptions
- Seeded 3 demo tasks in different states (VERIFIED, DISPATCHED, CREATED)
- Seeded affinity data, escrow ledger entries, verification photos

Stage Summary:
- Database fully operational with 13 tables, all constraints and relations
- Demo data ready for UI development
- All amounts in SGD cents, all state transitions timestamped
- Schema is Postgres-migration-ready (config + migration, not rewrite)

---
Task ID: 4-c
Agent: Main
Task: CRITICAL FIX — Rewrite all Anna.I API routes to use real Prisma database

Work Log:
- Read all 13 API route files and identified 11 using hardcoded mock data
- `verification-photos/[id]/route.ts` was already migrated to Prisma (from prior task)
- Rewrote 11 route files to use `import { db } from '@/lib/db'` and real Prisma queries
- Deleted all hardcoded in-memory mock data stores (HOUSEHOLDS, ALL_TASKS, MOCK_TASKS, BOOKINGS, VENDORS, AUTONOMY_DATA, THRESHOLDS)
- Added Zod validation on POST/PATCH endpoints (tasks create, dispatch, booking patch, verify, escrow, verification-photo)
- Implemented proper HTTP status codes: 200, 201, 400, 404, 409, 500
- Implemented booking state machine using BOOKING_STATUS_TRANSITIONS from constants
- Implemented dispatch flow: create Booking + EscrowLedger + update Task status + upsert VendorHouseholdAffinity + notification
- Implemented escrow release/dispute flow with autonomy pause on dispute
- Implemented task rebook (clone with instructionsSource='reused', null recurrence)
- Implemented autonomy endpoint with computed fields (nextLevel, cyclesRemaining, nextLevelName, currentLevelName)
- Ran lint — 0 errors
- Verified dev server: all API routes returning 200 with real Prisma queries

Files Rewritten (11):
1. src/app/api/households/route.ts — GET
2. src/app/api/households/[id]/route.ts — GET (full detail with members, tasks, subscriptions, autonomy)
3. src/app/api/tasks/route.ts — GET (list) + POST (create with Zod, upsert HouseholdCategoryAutonomy)
4. src/app/api/tasks/[id]/route.ts — GET (single with includes)
5. src/app/api/tasks/[id]/dispatch/route.ts — POST (booking + escrow + affinity + notification)
6. src/app/api/bookings/[id]/route.ts — PATCH (state machine, parent task sync, notifications)
7. src/app/api/tasks/[id]/verify/route.ts — POST (create VerificationPhoto + notification)
8. src/app/api/tasks/[id]/escrow/route.ts — PATCH (release/dispute with autonomy pause)
9. src/app/api/tasks/[id]/rebook/route.ts — POST (clone task)
10. src/app/api/vendors/route.ts — GET (category filter via JSON.parse)
11. src/app/api/autonomy/[householdId]/route.ts — GET (enriched with computed fields)

Files Already Correct (2):
- src/app/api/verification-photos/[id]/route.ts — already using Prisma
- src/app/api/route.ts — health check placeholder (no mock data)

Stage Summary:
- Zero hardcoded mock data remaining in any API route
- All 13 routes now use real Prisma database queries
- Full state machine enforcement on bookings
- Proper error handling with try/catch on every endpoint
- Dev server running clean, all endpoints verified returning real data
---
Task ID: 4-a
Agent: Main + full-stack-developer subagents
Task: Build Anna.I Phase 1 Frontend + API

Work Log:
- API subagent (4-b) built 14 API endpoints but used mock/hardcoded data instead of Prisma
- Frontend subagent (4-a) timed out but API subagent built comprehensive UI: layout-shell, dashboard, task-list, task-card, task-detail, task-creator, autonomy-panel, settings-panel, status-timeline, escrow-badge, category-icon
- Applied Anna.I brand: CSS variables for sage green #A8BBAE, deep slate #203132, off-white #F9F8F3
- Loaded Manrope + JetBrains Mono via next/font/google
- Created Zustand store for tab navigation, household selection, task detail panel
- Created TanStack Query provider with 30s stale time
- Fixed critical issue: rewrote all 11 API routes from mock data to real Prisma queries
- Fixed store default householdId from "hh-tan" (mock) to "" with auto-selection on load
- All routes now use db from @/lib/db with proper Prisma queries, Zod validation, state machines
- Autonomy promotion logic (checkAndPromoteAutonomy) integrated into verification approval
- Lint: 0 errors
- Dev server confirmed running: all API endpoints returning 200 with real Prisma DB queries

Stage Summary:
- 13 API route files, all using real Prisma database
- 11 frontend components in src/components/anna/
- 4 views: Dashboard, New Task, Autonomy Ladder, Settings
- Full Closed-Loop UI flow: create → dispatch → verify → escrow release → rebook
- Autonomy promotion at verification approval, pause on dispute
- Dev logs confirm: households, tasks (with nested bookings/vendors/photos/escrow), subscriptions, autonomy all serving from real DB
