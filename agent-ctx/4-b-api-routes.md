# Task 4-b: Anna.I Phase 1 API Routes

## Agent: API Routes Builder
## Status: Complete

## Files Created

### Library Files
- **`src/lib/constants.ts`** — Business constants: platform commission rate (10%), blended job value (6800 cents), category defaults (Cleaning $68, Laundry $45, Aircon $120, Handyman $80), category cycles-per-level, autonomy level names, max level (5), booking status transition map.
- **`src/lib/autonomy.ts`** — `checkAndPromoteAutonomy(householdId, category)` helper function that: increments cycle counters, checks if paused, looks up next level threshold, promotes if threshold met, resets cycle count, creates AUTONOMY_PROMOTED notifications for all household members.

### API Routes (13 files, 14 endpoints)

| # | Method | Route | File | Description |
|---|--------|-------|------|-------------|
| 1 | GET | `/api/households` | `src/app/api/households/route.ts` | List all households with basic info |
| 2 | GET | `/api/households/[id]` | `src/app/api/households/[id]/route.ts` | Full household detail with members, tasks (incl. bookings, photos, escrow), subscriptions, categoryAutonomy |
| 3 | GET | `/api/tasks` | `src/app/api/tasks/route.ts` | List tasks by householdId (query param), ordered by createdAt desc, with bookings/vendors, photos, escrow |
| 4 | POST | `/api/tasks` | `src/app/api/tasks/route.ts` | Create task (Zod validated). Sets status CREATED, instructionsSource "new", creates autonomy record if missing, notifies members via WHATSAPP. Returns 201. |
| 5 | GET | `/api/tasks/[id]` | `src/app/api/tasks/[id]/route.ts` | Single task detail with household, bookings/vendor, photos, escrow |
| 6 | POST | `/api/tasks/[id]/dispatch` | `src/app/api/tasks/[id]/dispatch/route.ts` | Dispatch task to vendor. Creates Booking (assigned, +2h), EscrowLedger (HELD, 10% commission), updates task to DISPATCHED, upserts VendorHouseholdAffinity. Returns task+booking+escrow. |
| 7 | PATCH | `/api/bookings/[id]` | `src/app/api/bookings/[id]/route.ts` | Update booking status with state machine validation (assigned→accepted→in_progress→completed|cancelled). Syncs parent task status/timestamps. Creates VENDOR_EN_ROUTE notification on in_progress. |
| 8 | POST | `/api/tasks/[id]/verify` | `src/app/api/tasks/[id]/verify/route.ts` | Upload verification photo (requires task COMPLETED). Creates photo (vendor upload, not verified). Creates VERIFICATION_REQUESTED notification. Returns 201. |
| 9 | PATCH | `/api/verification-photos/[id]` | `src/app/api/verification-photos/[id]/route.ts` | Approve/reject photo. On approve: marks verified, updates task to VERIFIED, calls `checkAndPromoteAutonomy()`, updates VendorHouseholdAffinity (completedCount, rating, jobOutcomes). On reject: sets rejectionReason. Creates appropriate notifications. |
| 10 | PATCH | `/api/tasks/[id]/escrow` | `src/app/api/tasks/[id]/escrow/route.ts` | Release (requires VERIFIED) or dispute (any status). Release: sets ESCROW_RELEASED, notifies + rebooking prompt. Dispute: sets DISPUTED, pauses autonomy promotion, creates DISPUTE_RAISED notification. |
| 11 | POST | `/api/tasks/[id]/rebook` | `src/app/api/tasks/[id]/rebook/route.ts` | Create new task from original (same household, category, instructions, amount). Sets instructionsSource "reused", clears recurrence. Returns 201. |
| 12 | GET | `/api/vendors` | `src/app/api/vendors/route.ts` | List ACTIVE vendors, optional `?category=xxx` filter (parses JSON categories field) |
| 13 | GET | `/api/autonomy/[householdId]` | `src/app/api/autonomy/[householdId]/route.ts` | All autonomy records with computed fields: currentLevelName, nextLevel, nextLevelName, cyclesNeeded, cyclesRemaining. Includes all thresholds. |

## Key Business Logic Implemented

### Autonomy Promotion (at verification approval)
1. `checkAndPromoteAutonomy()` called from `PATCH /api/verification-photos/[id]` on approve
2. Skips if `promotionPaused` is true
3. Increments `verifiedCyclesAtLevel` and `totalVerifiedCycles`
4. Looks up `AutonomyLevelThreshold` for `(category, currentLevel + 1)`
5. If `verifiedCyclesAtLevel >= cyclesRequired` AND `currentLevel < 5`: promotes, resets cycles, notifies

### Escrow Dispute
- Sets `HouseholdCategoryAutonomy.promotionPaused = true` — does NOT demote level

### Commission Calculation
- `commissionCents = amountCents × 10 / 100` (rounded)
- `vendorPayoutCents = amountCents - commissionCents`

### Notifications
- Every state transition creates WhatsApp notifications for all household members
- Event types: TASK_CREATED, TASK_DISPATCHED, VENDOR_EN_ROUTE, VERIFICATION_REQUESTED, VERIFICATION_APPROVED, VERIFICATION_REJECTED, ESCROW_RELEASED, DISPUTE_RAISED, REBOOKING_PROMPT, AUTONOMY_PROMOTED

## Quality Checks
- ESLint: passes with 0 errors
- TypeScript: all `src/app/api` and `src/lib` files compile cleanly
- Zod v4 validation on all POST/PATCH endpoints
- Proper HTTP status codes (200, 201, 400, 404, 409, 500)