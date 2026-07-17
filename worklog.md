---
Task ID: 1
Agent: Main
Task: Fix Railway seed failure — 3 bugs (wrong command, duplicate execution, dependency error)

Work Log:
- Read all 4 seed files (seed.ts, seed-job-types.ts, seed-demo.ts, seed-anomalies.ts) and package.json
- Identified root cause of duplicate execution: `require.main === module` guard in sub-seed files fires inconsistently under tsx ESM, causing `_main()` to run both on import and when explicitly called
- Identified root cause of "Tan Family not found": race condition from duplicate execution — second instance of seed-demo cleans up data while first is still creating it
- Identified wrong command: `prisma db deploy` doesn't exist in Prisma 6.x, correct is `prisma migrate deploy`

Fixes applied:
1. **seed-job-types.ts**: Removed `if (typeof require !== 'undefined' && require.main === module)` guard. Now only exports `main()`.
2. **seed-demo.ts**: Same — removed auto-execution guard. Now only exports `main()`.
3. **seed-anomalies.ts**: Same — removed auto-execution guard. Now only exports `main()`.
4. **seed.ts**: Updated Railway comment from `npx prisma db push && npx prisma db seed` to `npx prisma migrate deploy && npx prisma db seed`
5. **package.json**: Updated `"seed"` script from running 3 sub-seeds individually (now broken since they don't auto-execute) to `npx tsx prisma/seed.ts` (unified entry point)

Stage Summary:
- All 3 Railway seed bugs fixed in a single commit
- Lint passes clean
- Ready to push to GitHub on user's instruction
- Railway command: `npx prisma migrate deploy && npx prisma db seed`