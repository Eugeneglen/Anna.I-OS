# Phase 9 — Secrets & Environment Audit (Section B, Phase 10)

## Status of this document

Audit + remediation record for Phase 9 Section B (Phase 10: Secrets /
Environment). No secret VALUES are reproduced here — only variable names,
locations, and required owner actions.

## Finding P9B-SECRETS-1 (P1, pre-existing) — committed `.env` with live credentials

**Evidence:** the repository tracked a `.env` file at the repo root since
commit `d300888` (PHASE1-L4-1) containing:

| Variable | Class | Exposure |
| --- | --- | --- |
| `GOOGLE_CLIENT_SECRET` | **OAuth client secret** (GOCSPX-… value, not reproduced here) | Committed to git; **already pushed to the remote** in the branch history |
| `NEXTAUTH_SECRET` | Auth signing secret (dev-grade placeholder, not reproduced here) | Committed + pushed |
| `GOOGLE_CLIENT_ID` | Public identifier (low sensitivity) | Committed + pushed |
| `DATABASE_URL` / `NEXTAUTH_URL` / `OPS_EVENTS_URL` | Local dev configuration | Committed + pushed |

**Impact:** anyone with read access to the GitHub repository can extract the
Google OAuth client secret from history. A leaked client secret allows
token exchange impersonation for the Google OAuth app until rotated.
The NEXTAUTH secret is a known dev placeholder — still a hazard if it
survives into any external deployment.

**Remediation applied in this section (commit "P9B-…")**:
- `.env` is now **untracked** (`git rm --cached .env`); the file remains on
  disk for local development only and was already covered by the existing
  `.gitignore` rule (`.env*`).
- The file will no longer be committed by future work.

**Required owner actions (cannot be done from this sandbox):**
1. **Rotate the Google OAuth client secret** in the Google Cloud console
   (APIs & Services → Credentials). Rotation supersedes the leaked value —
   the git-history copy then becomes inert.
2. **Set a strong `NEXTAUTH_SECRET`** for any non-local deployment.
3. Optionally purge the blob from git history (git filter-repo / BFG) —
   only worth doing AFTER rotation, and coordinated across all branch
   owners (history rewrite is out of scope for this audit).

## Environment separation audit

- **Server-only secrets** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `OPS_JWT_SECRET`, CRON_SECRET,
  household/vendor JWT secrets) are imported only in `src/app/api/**` route
  modules and `src/lib/**` server libraries — never in client components.
- **Client-exposed (`NEXT_PUBLIC_*`) variables** are limited to
  `NEXT_PUBLIC_APP_URL` (public origin for CORS) and
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (designed-public publishable key) —
  no secret values.
- **Webhook signature verification** fails closed: missing
  `STRIPE_WEBHOOK_SECRET` → 500; missing/invalid `stripe-signature` → 400
  (verified in Section A, S6). In the demo environment (no Stripe keys) the
  route returns an unauthenticated 200 no-op BEFORE any processing —
  unsigned events are never processed (documented behaviour).
- **Cron endpoints** require a timing-safe `x-cron-secret`; in production
  with `CRON_SECRET` unset they are closed (401).
- **Rate-limit keying** uses the first `x-forwarded-for` header entry —
  client-suppliable; documented as defense-in-depth, not a hard per-IP
  guarantee (trusted-proxy keying queued for Phase 16 production-config
  work; see `src/lib/rate-limit.ts` and the register route comment).

## Standing rules going forward

- Never commit `.env`, `.env.*`, or any file containing a secret value.
- New secrets enter through the deployment environment only.
- Secret rotation cadence and history purge remain owner decisions.
