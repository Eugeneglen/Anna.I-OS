# Worklog — Ops Auth & Deployment Audit

## Date: 2025-07-25

## Issues Investigated

### Issue 1: Railway "Invalid credentials" on /ops/login

**Root Cause:** `prisma/seed-ops.ts` (the ONLY file that creates OpsUser records with bcrypt-hashed passwords) was **never imported by `prisma/seed.ts`**. The seed pipeline ran `seed-job-types`, `seed-demo`, and `seed-anomalies` — but never `seed-ops`.

**Why this caused the bug:**
1. `ensure-seed.ts` checks if ALL 3 tables (Household, ServiceJobType, OpsUser) are empty before running the full seed.
2. On a fresh Railway PostgreSQL database, all 3 are empty → seed runs → but OpsUser records are never created.
3. After the first deploy, Household and ServiceJobType have data but OpsUser is still empty → `allEmpty` is false → seed never runs again.
4. Login API does `db.opsUser.findUnique({ where: { email } })` → finds nothing → returns "Invalid credentials".

**Secondary finding:** `seed-ops.ts` created its own `new PrismaClient()` instead of importing the shared one from `./seed-db`, which would exhaust PostgreSQL connection limits when imported by `seed.ts`.

**Fix:**
- Added `seed-ops` import as step [0/4] in `prisma/seed.ts` (before job types, since ops users have no dependencies).
- Changed `seed-ops.ts` to import `db` from `./seed-db` instead of creating a separate PrismaClient.

### Issue 2: Local preview shows /ops/vendors loading spinner instead of login page

**Root Cause:** The middleware matcher pattern `/ops/:path((?!login).*)` requires at least one path segment after `/ops/`. The bare path `/ops` (no sub-segment) does NOT match, so middleware never runs for it. The server component at `/(dashboard)/page.tsx` then does `redirect("/ops/vendors")`, and if the user has no valid session, the dashboard layout's loading spinner renders before the client-side session check can redirect.

**Fix:** Added `"/ops"` to the middleware matcher array: `["/ops", "/ops/:path((?!login).*)"]`.

## Files Changed
- `prisma/seed.ts` — Added seed-ops import as step 0/4
- `prisma/seed-ops.ts` — Switched to shared db from seed-db, removed duplicate PrismaClient
- `src/middleware.ts` — Added "/ops" to matcher array

## Verification (agent-browser)
1. ✅ Cleared cookies → visited /ops → redirected to /ops/login
2. ✅ Filled email (eugene@annai.sg) and password (anna1234) → clicked Sign In → redirected to /ops/vendors
3. ✅ Dashboard loaded with 5 vendors in table
4. ✅ /ops/autonomy page loaded — shows 3 households with autonomy levels
5. ✅ /ops/notifications page loaded — shows 6 notifications with filters
6. ✅ /ops/anomalies page loaded — shows anomaly table with filters
7. ✅ Cleared cookies → visited /ops → correctly redirected to /ops/login
