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
---
Task ID: 5-b
Agent: full-stack-developer
Task: Phase 2B — "Ask Anna" Read-Only LLM Chat

Work Log:
- Added `askAnnaOpen` / `setAskAnnaOpen` to Zustand AnnaStore for chat panel toggle
- Built `src/app/api/ask-anna/route.ts` POST endpoint:
  - Keyword-based intent detection across 7 intents (upcoming, spending, vendor, escrow, autonomy, summary, default)
  - 6 async data-fetching functions using Prisma: fetchUpcomingTasks, fetchMonthlySpending, fetchVendorHistory, fetchEscrowStatus, fetchAutonomyStatus, fetchHouseholdSummary
  - Structured data injected into LLM system prompt as JSON context
  - z-ai-web-dev-sdk used for chat completions (backend only, thinking disabled)
  - Response format: `{ response: string, dataUsed: string[] }`
  - All monetary values in SGD cents internally, formatted as `SGD $X.XX`
- Built `src/components/anna/ask-anna.tsx` chat UI component:
  - Floating Action Button (sage green, bottom-right, above mobile tab bar)
  - Animated chat panel: 380×520 desktop, full-width bottom sheet on mobile
  - User messages: right-aligned sage green bubbles; Anna messages: left-aligned off-white bubbles
  - 3-dot bounce typing indicator while awaiting LLM response
  - Empty state with guidance text; error state with inline message
  - Auto-scroll on new messages; Enter key + send button; input disabled during loading
  - TanStack Query `useMutation` for API calls; framer-motion for panel animations
  - Mobile backdrop overlay; close button in header
- Modified `src/components/anna/layout-shell.tsx` to import and render `<AskAnna />`
- ESLint: 0 errors; dev server compiled successfully

Stage Summary:
- 1 new API route, 1 new component, 2 files modified (store + layout-shell)
- Complete fetch-then-respond pattern: intent detection → DB query → LLM context → natural language response
- Read-only assistant that cannot create/modify/delete, only reads and explains household data
- Brand-consistent UI with Anna.I CSS variables and framer-motion animations
- z-ai-web-dev-sdk strictly in backend API route only
---
Task ID: 5-a
Agent: full-stack-developer
Task: Phase 2A — Routing Engine (weighted vendor scoring)

Work Log:
- Added `ScoreBreakdown` and `VendorSuggestion` types to `src/lib/types.ts`
- Built routing engine `src/lib/routing.ts` with `getSuggestedVendors()` and `autoSelectVendor()`
- Scoring algorithm: base 100, with weighted bonuses/penalties for affinity (+15 base +5/additional capped +30), rating (avgRating*3 capped +15), disputes (-20 each), reassignments (-5 each), utilisation (penalty if >50% capacity), zone match (+10 for postal prefix overlap), recent completion (+5 if within 7 days)
- Category match is a hard filter (not scored); only ACTIVE vendors considered
- Batch-fetched affinity data and today's booking counts for efficient scoring
- Created `GET /api/tasks/[id]/suggest-vendors` route — validates task is CREATED, returns ranked vendor list with scores and human-readable reasons
- Modified `POST /api/tasks/[id]/dispatch` — vendorId is now optional in Zod schema; when omitted, calls `autoSelectVendor()` for auto-dispatch; response includes `autoSelected` boolean
- Lint: 0 errors

Files Created:
1. src/lib/routing.ts — routing engine with weighted scoring algorithm
2. src/app/api/tasks/[id]/suggest-vendors/route.ts — GET endpoint for vendor suggestions

Files Modified:
1. src/lib/types.ts — added ScoreBreakdown + VendorSuggestion types
2. src/app/api/tasks/[id]/dispatch/route.ts — vendorId now optional, auto-selects via routing engine

Stage Summary:
- Routing engine fully operational with 7-factor weighted scoring
- Suggest-vendors API returns ranked list with per-factor breakdown
- Dispatch route supports both manual (Level 1) and auto-dispatch (Level 3+) via optional vendorId
- All amounts in SGD cents, proper error handling, Zod validation
---
Task ID: 5-c
Agent: Main
Task: Phase 2C — Integrate routing suggestions into task detail UI

Work Log:
- Modified `src/components/anna/task-detail.tsx` to replace old vendor list with routing suggestions
- When task is CREATED: shows "Routing Suggestions" section with ranked vendor cards
- Auto-Dispatch button: calls dispatch without vendorId → routing engine auto-picks top vendor
- Manual selection list: each vendor shows rank badge, name, "Best Match" badge (rank 1), reason string, score with color coding
- Filtered out old "Dispatch to Vendor" action button for CREATED status (replaced by suggestions panel)
- Fixed dispatch route: made scheduledStart optional, defaults to tomorrow 10am if omitted
- Added `cn` import for conditional class names

Stage Summary:
- Routing engine now fully integrated into the Closed-Loop UI
- User sees scored, explained vendor recommendations instead of a flat list
- Auto-dispatch uses routing engine's top pick; manual override available
- Zero lint errors; browser-verified end-to-end
---
Task ID: 5-d
Agent: Main
Task: Phase 2D — Browser verification of all Phase 2 flows

Work Log:
- Verified dashboard renders with household selector, task list, summary cards, Ask Anna FAB
- Created new cleaning task via New Task form → navigated to dashboard with new task in "AWAITING DISPATCH"
- Clicked new task → Routing Suggestions panel displayed with 3 ranked vendors:
  - SparkClean Pro: score 145 (affinity +25, rating +15, recent +5)
  - FixIt Handyman Co: score 100 (baseline)
  - GreenSweep Pte Ltd: score 100 (baseline)
- Auto-Dispatch button shows top vendor name and score
- Opened Ask Anna chat panel → sent "What's my spending this month?" → received LLM response with household spending data
- Verified mobile viewport (390×844) renders correctly
- Checked dev logs: all API calls returning 200, zero errors

Stage Summary:
- Both Phase 2 deliverables verified working end-to-end in browser
- Routing Engine: scoring, ranking, auto-dispatch all functional
- Ask Anna: intent detection → data fetch → LLM response pipeline working
- Mobile responsive layout confirmed
---
Task ID: 6-a
Agent: Main
Task: Ask Anna UX Polish — Fix cropping bug, replace subtitle, add FAB pulse, add suggestion chips

Work Log:
- Analyzed current Ask Anna implementation via VLM screenshot analysis + code review
- Provided honest UX/product assessment to user (deferred premium redesign to Phase 2, recommended 4 tactical fixes)
- Fix 1 — Mobile cropping: changed from `bottom-16 h-[70vh]` to `bottom-2 max-h-[70vh]` with `md:max-h-none` for desktop independence; added `pb-[max(0.75rem,env(safe-area-inset-bottom))]` for iOS safe area
- Fix 2 — Removed "Read-only assistant" subtitle, replaced with "Your household, understood" in sage-dark color with font-medium
- Fix 3 — Swapped FAB icon from generic `MessageCircle` to `Sparkles` (Lucide); added `anna-fab-pulse` CSS class with 3s breathing animation (scale 1→1.06, box-shadow pulse in sage rgba); hover pauses animation
- Fix 4 — Added 4 context-aware quick-suggestion chips in empty chat state: escrow balance, vendor history, autonomy progress, upcoming tasks; clicking a chip populates input and focuses
- Cleaned up unused imports (MessageCircle, ScrollArea)
- Browser-verified: desktop (1440×900) and mobile (390×844) both pass all checks
- Verified chip → input population → send → LLM response flow works end-to-end
- Zero console errors, zero lint errors, clean dev server

Files Modified:
1. src/components/anna/ask-anna.tsx — FAB icon, panel positioning, subtitle copy, suggestion chips, safe area padding
2. src/app/globals.css — anna-fab-pulse keyframe animation + hover override

Stage Summary:
- 4 tactical improvements deployed: cropping fix, subtitle, FAB pulse, suggestion chips
- Ask Anna now signals "intelligent AI" through Sparkles icon + breathing animation + context-aware chips
- "Read-only assistant" disclaimer removed — replaced with positive brand statement
- Input bar fully visible on mobile with safe-area support
- Full message flow verified: chip click → input populated → send → LLM response received
---
Task ID: 3
Agent: Main
Task: Phase 3 — Anomaly Detector

Work Log:
- Added 3 new enums to Prisma schema: AnomalyType (VENDOR_LATE, TASK_OVERDUE, VERIFICATION_MISSING, RATING_DROP, ESCROW_DISPUTED), AnomalySeverity (LOW, MEDIUM, HIGH, CRITICAL), AnomalyStatus (ACTIVE, ACKNOWLEDGED, RESOLVED, DISMISSED)
- Added Anomaly model with householdId, taskId, bookingId, vendorId, type, severity, message, metadata (JSON), status, timestamps
- Added @@index on (householdId, status), (type, status), (severity) for query performance
- Ran db:push + generate — zero migration issues
- Built anomaly detection engine (src/lib/anomaly-detector.ts) with 5 rule-based detection functions:
  1. VENDOR_LATE: booking 30+ min past scheduled start with no actualStart
  2. TASK_OVERDUE: task 4+ hours past dispatch, still not completed
  3. VERIFICATION_MISSING: task completed 24+ hours ago, no verification photo
  4. RATING_DROP: latest booking rating 1.5+ points below vendor's historical average (requires 3+ history)
  5. ESCROW_DISPUTED: event-driven detection from DISPUTED escrow ledger entries
- Duplicate prevention: checks for existing ACTIVE anomalies per (household, type, bookingId/taskId)
- Severity auto-escalation: e.g., vendor 60+ min late → HIGH, 120+ min → CRITICAL
- Added SLA constants to constants.ts: VENDOR_LATE_SLA_MINUTES=30, TASK_OVERDUE_SLA_HOURS=4, VERIFICATION_MISSING_SLA_HOURS=24, RATING_DROP_THRESHOLD=1.5
- Added ANOMALY_TYPE_LABELS and ANOMALY_SEVERITY_STYLES for UI
- Added Anomaly types to types.ts
- Built 3 API endpoints:
  - GET /api/anomalies?householdId=&status=&severity= — list with severity groupBy counts
  - POST /api/anomalies/check — runs all 5 detection rules, persists new anomalies, returns detection summary
  - PATCH /api/anomalies/[id] — acknowledge/resolve/dismiss with Zod validation
- Built anomaly-banner.tsx dashboard component:
  - Collapsed: severity-colored banner with count, preview text, Critical/High badges, chevron
  - Expanded: sorted anomaly rows with severity dot, type label, time ago, message, Acknowledge/Dismiss actions
  - Re-scan now button (triggers detection), Collapse button
  - Auto-refresh every 30 seconds via TanStack Query refetchInterval
  - Integrates into dashboard.tsx between header and summary cards
- Seeded 3 demo anomalies for Tan Family (VENDOR_LATE MEDIUM, VERIFICATION_MISSING HIGH, TASK_OVERDUE CRITICAL)
- Browser-verified: banner renders, expands on click, dismiss updates count instantly, zero errors

Files Created:
1. src/lib/anomaly-detector.ts — 5-rule detection engine
2. src/app/api/anomalies/route.ts — GET list endpoint
3. src/app/api/anomalies/check/route.ts — POST detection trigger
4. src/app/api/anomalies/[id]/route.ts — PATCH acknowledge/dismiss
5. src/components/anna/anomaly-banner.tsx — dashboard alert UI
6. prisma/seed-anomalies.ts — demo data seed script

Files Modified:
1. prisma/schema.prisma — 3 enums + Anomaly model + Household.anomalies relation
2. src/lib/types.ts — Anomaly, AnomalyType, AnomalySeverity, AnomalyStatus types
3. src/lib/constants.ts — SLA thresholds + type labels + severity styles
4. src/components/anna/dashboard.tsx — AnomalyBanner import + render

Stage Summary:
- Phase 3 Anomaly Detector fully operational
- 5 detection rules covering all spec requirements (vendor late, task overdue, verification missing, rating drop, escrow disputed)
- Dashboard shows real-time anomaly banner with expand/collapse, severity badges, acknowledge/dismiss actions
- All API endpoints returning 200, zero lint errors, zero runtime errors
- Targeting Seed metric: "human coordinator backstop invoked in <30% of tasks by Month 6" — anomaly data is now instrumented and queryable
---
Task ID: 2-3-4
Agent: full-stack-developer
Task: Phase 4A Backend — Seed job types, quote calculator, API endpoints

Work Log:
- Created `prisma/seed-job-types.ts` with 14 ServiceJobType records across 4 categories:
  - CLEANING (4): Regular Maintenance ($68 flat), Deep Cleaning ($120), Move-in/Move-out ($180), Post-Renovation ($220)
  - LAUNDRY (3): Wash & Fold ($45 base, multiplier by load size), Ironing Only ($30 flat), Dry Cleaning ($15/item)
  - AIRCON (3): Standard Service ($40/unit), Chemical Wash ($80/unit), Installation ($150/unit)
  - HANDYMAN (4): General Repair ($50, complexity multiplier), Plumbing ($80), Electrical ($80), Painting ($120/room, condition multiplier)
- All pricing rules use structured JSON: type (flat/per_unit/per_room/per_item), unitField, multiplierField, areaMultiplier with 4 tiers
- Required fields use structured JSON: number (min/max/defaultValue) and select (options with label/value)
- Add-ons use structured JSON: pricingType (flat/per_unit/per_room/per_item) with optional unitField
- Successfully ran seed: 14 records inserted, zero errors
- Created `src/lib/quote-calculator.ts` — pure function `calculateQuote()` with:
  - 4-step pricing pipeline: per-unit → multiplier → area multiplier → round
  - Add-on calculation: flat adds directly, per_unit/per_room/per_item multiply by field value
  - Returns QuoteResult with baseCents, addOnsCents, totalCents, and breakdown line items
  - Exported TypeScript interfaces: JobTypePricingRules, JobTypeRequiredField, JobTypeAddOn, QuoteLineItem, QuoteResult
- Created `src/app/api/job-types/route.ts` — GET endpoint:
  - Required query param: category (validated against ServiceCategory enum via Zod)
  - Returns active job types ordered by sortOrder, includes quotation count via _count
- Modified `src/app/api/tasks/route.ts` — POST handler:
  - Added optional jobTypeId and quotationId to createTaskSchema
  - When quotationId provided: validates quotation exists, belongs to household, is DRAFT status
  - Uses quotation.totalCents as amountCents when quotationId present
  - Creates task with jobTypeId and quotationId
  - Updates quotation status to ACCEPTED after task creation
- Created `src/app/api/quote/route.ts` — POST endpoint:
  - Zod-validated input: householdId, jobTypeId, fieldValues (Record<string, number>), selectedAddOns (string[])
  - Validates household and job type existence/active status
  - Parses JSON fields from job type and calls calculateQuote()
  - Creates Quotation record with full breakdown
  - Returns quotation with calculated breakdown
- ESLint: 0 errors, dev server running clean

Files Created:
1. prisma/seed-job-types.ts — 14 service job types seed script
2. src/lib/quote-calculator.ts — pure pricing calculation engine
3. src/app/api/job-types/route.ts — GET endpoint for category-filtered job types
4. src/app/api/quote/route.ts — POST endpoint for quotation creation

Files Modified:
1. src/app/api/tasks/route.ts — added jobTypeId/quotationId support with quotation validation and status transition

Stage Summary:
- Phase 4A backend infrastructure complete: 14 realistic Singapore-priced service job types seeded
- Quote calculator handles flat, per-unit, per-room, per-item pricing with multiplier and area tier support
- 3 new API endpoints (job-types GET, quote POST, tasks POST enhanced) enable full quotation → task creation flow
- All amounts in SGD cents, Zod validation on all inputs, proper error codes (400/404/409/500)
---
Task ID: 5-6-7
Agent: Main
Task: Phase 4A Frontend — Job type selector, quote builder, task creator integration

Work Log:
- Added ServiceJobType, Quotation, QuotationBreakdownItem interfaces to src/lib/types.ts
- Added jobType and quotation optional fields to Task interface
- Created src/components/anna/job-type-selector.tsx:
  - Fetches job types via GET /api/job-types?category= using TanStack Query
  - Renders selection cards in 1-col mobile / 2-col desktop grid
  - Shows name, description, base price, unit label per card
  - Selected card shows green border + check badge
  - Loading state with skeleton cards
- Created src/components/anna/quote-builder.tsx:
  - Dynamic fields: number type with +/- stepper buttons, select type with toggle buttons
  - Add-ons: checkbox list with per-item pricing labels (flat vs /unit vs /room)
  - Live quote card: sage-tinted card with Calculator icon, real-time total
  - Expandable breakdown: click "Details" to see line items (base, add-ons, total)
  - Custom amount fallback: "Enter custom amount" link switches to editable input
  - "Reset to quoted price" to go back to calculated amount
  - Uses calculateQuote() client-side for instant updates (pure function, no API call)
- Rewrote src/components/anna/task-creator.tsx with new flow:
  - Category → Job Type → Quote Builder → Amount → Instructions → Uploads → Schedule → Create
  - Category selection clears job type and quote state
  - Job type selection triggers QuoteBuilder appearance
  - Amount field auto-populated from live quote, with "Auto-calculated from X" hint
  - On create: POST /api/quote to persist quotation, then POST /api/tasks with jobTypeId + quotationId
  - Reset form clears all quote state
- Updated src/app/api/tasks/[id]/route.ts: include jobType and quotation in task detail response
- Updated src/components/anna/task-detail.tsx: show "Category — Job Type" in header when jobType present
- ESLint: 0 errors
- Dev server: all routes returning 200

Files Created:
1. src/components/anna/job-type-selector.tsx
2. src/components/anna/quote-builder.tsx

Files Modified:
1. src/lib/types.ts — added ServiceJobType, Quotation, QuotationBreakdownItem types; extended Task
2. src/components/anna/task-creator.tsx — complete rewrite with job type + quote flow
3. src/app/api/tasks/[id]/route.ts — include jobType + quotation in detail response
4. src/components/anna/task-detail.tsx — display job type name in header

Stage Summary:
- Phase 4A complete: structured job type selection replaces manual amount entry
- New Task flow: Category → Job Type (API-fetched cards) → Dynamic Fields → Add-on Checkboxes → Live Quote → Instructions → Create
- 14 realistic Singapore-priced job types across 4 categories
- Rule-based quote calculator runs client-side for instant feedback
- Custom amount fallback preserved via "Enter custom amount" toggle
- Task detail shows job type name when available
- Zero lint errors, all API routes serving 200
