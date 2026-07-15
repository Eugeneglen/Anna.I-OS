# Task 5-a: Routing Engine — Work Record

## Agent: full-stack-developer

## Summary
Built Phase 2A Routing Engine for Anna.I — a weighted scoring algorithm for vendor selection.

## Files Created
1. **`src/lib/routing.ts`** — Core routing engine
   - `getSuggestedVendors(taskId)` — returns ranked `VendorSuggestion[]` with scores and breakdowns
   - `autoSelectVendor(taskId)` — returns top-scored vendor for auto-dispatch
   - 7-factor scoring: category match (filter), affinity, rating, disputes, reassignments, utilisation, zone match, recent completion
   - Batch-fetches affinity data and today's booking counts for performance

2. **`src/app/api/tasks/[id]/suggest-vendors/route.ts`** — GET endpoint
   - Validates task exists and is in CREATED status
   - Returns ranked vendor list with per-factor score breakdown and human-readable reasons

## Files Modified
1. **`src/lib/types.ts`** — Added `ScoreBreakdown` and `VendorSuggestion` interfaces
2. **`src/app/api/tasks/[id]/dispatch/route.ts`** — Made `vendorId` optional in Zod schema; when omitted, calls `autoSelectVendor()` for auto-dispatch; response includes `autoSelected: boolean`

## Score Formula
- Base: 100
- Affinity: +15 if has prior bookings, +5 per additional (cap +30)
- Rating: avgRating × 3 (cap +15)
- Disputes: -20 each
- Reassignments: -5 each
- Utilisation: penalty if >50% capacity = -(todayBookings / maxTasksPerDay × 10)
- Zone match: +10 if vendor zones contain household postal code prefix (first 2 digits)
- Recent completion: +5 if last completed within 7 days

## Lint
0 errors