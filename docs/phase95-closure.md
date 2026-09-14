# Phase 9.5 — Closure Gate: Test Reconciliation, Final Regression, Certification Summary

## Status of this document

Phase 9.5 final record. All suites below were re-run FRESH against the
restored pristine Item-8 demo baseline (the exact Phase 9 starting state —
see §1) with the Phase 9.5 code changes live on the dev server
(`/home/z/wt-item8` on :3000, `DATABASE_URL=file:/home/z/wt-item8/db/custom.db`).

---

## 1. Baseline restoration (reproducibility prerequisite)

The Phase 9 evidence runs had left accumulated suite fixtures in the demo DB
(including item8's own CARE-tier rows at 6800c, which fail the item8 SETUP
baseline check on re-run: "expect HOME/800 only"). The suite file-restore
mechanism cannot reliably revert writes made by the LIVE dev server
(the server's open SQLite descriptors checkpoint their WAL back over the
restored file — the "WAL resurrection" effect).

For Phase 9.5 the DB was reset to the pristine Phase 9 starting baseline
(`db/backups/phase9a-1789351814924.db`: 5 households, 5×HOME/800
subscriptions, gas $40, commission demo state) **with the dev server
restarted after the restore**, and the server re-pinned to
`DATABASE_URL=file:/home/z/wt-item8/db/custom.db` (the `.env` value points
at the main sandbox checkout — the documented shadow-DB trap; the pin is
mandatory for every server launch AND suite run).

## 2. Test-count reconciliation (Part 4) — suite → exact count → command → result

All commands: `cd /home/z/wt-item8 && DATABASE_URL=file:/home/z/wt-item8/db/custom.db bun e2e/<file>`

| Suite | File | Checks | Fresh result | Evidence |
| --- | --- | --- | --- | --- |
| Item 8 (Item-9-era fixes) | `item8-fixes.ts` | **143** | 143/143, 0 fail | report 2026-09-14T05:35:07Z |
| Authority chain | `authority-chain.ts` | **97** | 97/97, 0 fail | report 2026-09-14T05:35:19Z |
| Business run-flows | `run-flows.ts` | **303** | 303/303, 0 fail | report runId 1789364738659 |
| AI contract (L2) | `ai-contract.ts` | **123** | 123/123, 0 fail | report 2026-09-14T05:46:32Z |
| Phase 9A (security) | `phase9a-sec.ts` | **101** | 101/101, 0 findings | report 2026-09-14T05:46:58Z |
| Phase 9B (transactions) | `phase9b-sec.ts` | **27** | 27/27, 0 findings | report 2026-09-14T05:47:13Z |
| Phase 9C (AI + carry-forward) | `phase9c-sec.ts` | **15** | 15/15, 0 findings | report 2026-09-14T05:47:25Z |
| **Phase 9 subtotal** | | **809** | **809/809** | |
| **Phase 9.5 NLU replay (NEW)** | `phase95-sec.ts` | **54** | 54/54, 0 findings | report 2026-09-14T05:47:25Z |
| **VERIFIED TOTAL** | | **863** | **863/863** | |

**The Phase 9 report's "690 checks" figure is INCORRECT.** The seven Phase 9
suites sum to **809** (143+97+303+123+101+27+15); 690 is not the sum of any
subset of the suite counts (e.g. the four pre-9A suites sum to 666; +27 =
693; +15 = 681; none equal 690). No suite is double-counted above — each
count comes from that suite's own report JSON `totals` field, and the
suites are disjoint (different files, different record arrays). The
correct, reproducible totals are **809 (Phase 9) and 863 (incl. Phase
9.5)**.

Counting method note: each suite counts its own `records` array length
(one record = one named check); "totals" are computed from the same array
(`records.filter(r => !r.pass)` — the obfuscated always-0 formula was fixed
in P9C-3). The suites run sequentially against one server; DB state is
snapshot/restored per suite (with the live-server resurrection caveat
documented in §1 — it does not affect in-run counts).

## 3. Final regression (Part 6)

- **All 8 suites green on the Phase 9.5 code** (table above — the NLU fix
  is exercised by phase95 AND re-covered end-to-end by ai-contract 123/123
  and phase9a/b/c, all re-run after the change).
- **TypeScript**: `bunx tsc --noEmit` → **141 errors, identical to the
  Phase 9 baseline count; zero in the Phase 9.5 changed files** (the one
  `nlu-tools.ts` error — `recurrencePattern` Json-null typing — is
  pre-existing: the identical error exists in the base file at line 503,
  shifted to 573 by the added lines; verified by stashing the changes).
- **ESLint**: changed/added files (`nlu-tools.ts`, `ask-anna/route.ts`,
  `phase95-sec.ts`) → **0 errors, 0 warnings** (`.env.example` is ignored
  by the eslint config — expected for a non-source file).
- **Secret scan** over the full Phase 9.5 diff (all changed + new files):
  **0 actual secret values** — the only pattern hits are the deliberate
  SHA-256 *fingerprints* (first 16 hex chars) and variable NAMES in
  `docs/phase95-oauth-forensics.md`; no `GOCSPX-…` value, no live key
  material anywhere.
- **Authentication/OAuth verification**: no dedicated auth e2e suite
  exists (the AUTH-phase live smoke is DEFERRED by design — provider
  rate-limiting, documented in the AUTH-5 evidence). Phase 9.5's
  authentication verification is the live forensic reproduction in
  `docs/phase95-oauth-forensics.md` §C: provider config probe, real
  browser click-through of the "Continue with Google" button (navigates to
  Google's sign-in page), Google authorize/token-endpoint probes — all
  sanitized. **No new errors were silently ignored** in any of the above;
  the item8 baseline-drift failures encountered during reconciliation were
  root-caused (§1) and resolved by the baseline restoration, after which
  the suite is 143/143.

## 4. Open findings after Phase 9.5 (P0–P3)

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| OAUTH-SECRET-EXPOSURE | **P0 (owner action)** | Google OAuth client secret (value B) committed in Git history on 12 refs (8 remote) and **probe-verified ACTIVE at Google**; rotation required (Google Console + Railway var, same window) | Documented, advisory only — NOT rotated (owner decision); no code change possible/needed |
| NEXTAUTH-SECRET-PLACEHOLDER | **P1 (owner action)** | Dev-grade `NEXTAUTH_SECRET` in Git history + local `.env`; Railway value not determinable | Documented + impact analysis; NOT changed (owner decision) |
| LOCAL-OAUTH-LOOPBACK | P3 (configuration) | Local Google login dead-ends for preview-domain users (redirect_uri = localhost:3000) and fresh clones lack `.env` | Root-caused + documented; `.env.example` added; no credential change |
| SQLITE-CONCURRENCY | P2 (architecture, accepted) | 3+ parallel writes contend (fail-closed 500s); zero corruption; SQLite not production-ready | Confirmed + documented; production path = the existing Dockerfile Postgres conversion; graceful-failure candidates identified, NOT implemented (scope) |
| NLU-REPLAY (CF#10) | **P2 → FIXED** | Double-confirming an AI card created a second task | **FIXED in Phase 9.5** (chainId idempotency) + 54-check suite, live-verified |
| TEST-COUNT-690 | P3 (reporting) | Phase 9 report claimed "690 checks" | **CORRECTED**: 809 (Phase 9) / 863 (incl. 9.5) — reproducible from report JSONs |
| Item 9 carry-forwards (14) | P2/P3 | Classified in Phase 9C (CF#1..CF#14) | Unchanged this phase (CF#10 now fixed); remaining items stay owner-scheduled (Phase 10+) |

No new findings were introduced by the Phase 9.5 changes (police gate
verdict: see the worklog).

## 5. Commits (this phase — LOCAL ONLY, nothing pushed)

On branch `item8-report`, base `4f6ab58` (Phase 9 Section C HEAD):

1. **P95-1** — CF#10 fix: NLU confirm-pass replay idempotency (chainId as
   task idempotencyKey; pre-check + post-create reconciliation mirroring
   P9B-F01) + `e2e/phase95-sec.ts` (54 checks) + fresh report.
2. **P95-2** — Google OAuth forensic investigation record +
   `NEXTAUTH_SECRET` analysis + `.env.example` (secrets-free local-dev
   template) + gitignore negation.
3. **P95-3** — SQLite concurrency confirmation + production-readiness
   documentation.
4. **P95-4** — this closure record + fresh full-suite evidence (all report
   JSONs re-run post-fix on the restored pristine baseline).

## 6. Rules held during Phase 9.5

- Nothing pushed (no `git push` of any ref, no force, no deploy, no
  migration of any database, no Stripe/payment changes, no credential
  rotation/revocation/replacement).
- The working Railway Google login was preserved (no environment, code or
  credential affecting Railway was touched; the audited branch changes are
  local-only).
- No secret values printed in any terminal output, document, commit, or
  report (masked identifiers + fingerprints only).
- No weakening of money-authority, maker-checker, escrow, audit-logging,
  or idempotency controls (ai-contract/phase9a/b/c re-verified green
  after the change).
