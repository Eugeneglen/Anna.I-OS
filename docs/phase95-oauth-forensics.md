# Phase 9.5 — Google OAuth Forensic Investigation (Part 1) + NextAuth Secret (Part 2)

## Status of this document

Investigation record for the Phase 9.5 closure gate. **No secret values are
reproduced anywhere in this document** — only variable names, commit SHAs,
masked identifiers, and SHA-256 fingerprints (first 16 hex chars) of whole
config lines, used to prove value identity without ever exposing the values.
No credential was rotated, revoked, or modified during this investigation.

---

## Executive conclusion (answers Part 1E directly)

**BOTH conditions are true, and they are independent of each other:**

1. **Genuine credential exposure (P1, requires owner rotation):** the Google
   OAuth **client secret is committed in Git history and still VALID/ACTIVE
   at Google today** (probe-verified — see §C.4). Anyone with read access to
   the GitHub repository can extract a live credential. Rotation is justified
   — but it is an **owner action** (Google Cloud Console + Railway variable
   update), deliberately NOT performed from this sandbox per the Phase 9.5
   rules.
2. **The local Google-login failure is a CONFIGURATION issue, NOT a
   credential problem:** the local OAuth layer is fully functional
   (provider configured, Google accepts the localhost redirect URI, the
   client secret is valid, and the button navigates to Google — verified in
   a live browser). The local failure is the **post-login loopback
   redirect**: `NEXTAUTH_URL` (and therefore the OAuth `redirect_uri`) is
   `http://localhost:3000`, which only completes when the user's browser is
   on the same machine as the dev server. A user accessing the app through
   the sandbox preview domain is sent to their own machine's port 3000
   after the Google consent screen → dead end. Railway works because its
   deployment environment carries the Railway public origin.

**The working Railway Google login was preserved** (nothing was changed
anywhere — no code, no credential, no environment, no push).

---

## A. Historical Git exposure (Part 1A)

All facts below were derived with `git log/show/branch --contains`, printing
variable NAMES only; value identity is proven via SHA-256 fingerprints of
the whole `VAR=value` line (e.g. `843b7de3d246d9a9`), never the values.

### A.1 When did the secret enter Git?

The Phase 9 report's "pre-existing since d300888" was **imprecise**. The full
history of the tracked `.env` (two independent root lineages in this repo —
the 405-commit audit lineage, and the 24-commit platform `main` lineage
rooted at a Sep-3 re-init that never tracked any Google credential):

| Commit | Date | `.env` contents (names) | Event |
| --- | --- | --- | --- |
| `cdbd9d9` | 2026-07-15 | `DATABASE_URL` | audit-lineage root |
| `0e1c8ec` | 2026-07-15 | `DATABASE_URL` | — |
| **`2d08ae9`** | **2026-08-11** | + `GOOGLE_CLIENT_ID`, **`GOOGLE_CLIENT_SECRET`**, `NEXTAUTH_SECRET` | **first commit of a Google OAuth secret — value A** (fp `2ffae9422d7c16f5`) |
| `67a7712` | 2026-08-11 | `DATABASE_URL` | secret removed |
| **`9828696`** | **2026-08-16** | + Google vars again | **secret changed to value B** (fp `843b7de3d246d9a9`) — the value still in use today |
| `d300888` | 2026-09-08 | + `NEXTAUTH_URL`, `OPS_EVENTS_URL` (6 vars) | Phase 9 report's reference point — value B re-extended |
| `9424ec7`, `1db115f` | 2026-09-09 | `DATABASE_URL` (+`OPS_EVENTS_URL`) | Google vars removed — **on the platform `main` lineage only** |
| `87aca2d` | 2026-09-14 | (untracked) | P9B-2: `.env` untracked from the audit lineage |

**First introduction of a Google OAuth secret: `2d08ae9` (2026-08-11), file
`.env`, variables `GOOGLE_CLIENT_SECRET` (value A) + `NEXTAUTH_SECRET`.**
The current value B has been in history since `9828696` (2026-08-16).

### A.2 Is the file still tracked?

- **`item8-report` HEAD (the audited branch): NO** — untracked by P9B-2
  (`87aca2d`); the file remains on disk untracked, covered by the `.env*`
  gitignore rule.
- **Still tracked WITH the secret in the tree at 8 remote branches:**
  `origin/feature/API-FIX2..6`, `origin/feature/Audit-FIX7`,
  `origin/feature/Audit-AI-FIX8`, `origin/feature/Audit-ConfigSecur-FIX9`
  (the pushed FIX9 branch, "Aduit" spelling), plus local `auth-impl`,
  `ai-fix8-port`, `ai-fix8-port2` — all with the same value B
  (fp `843b7de3d246d9a9`).
- **`main` (local + `origin/main` + `origin/railway/code-change-WeaO-V`):**
  `.env` tracked but contains **only `DATABASE_URL`** — no Google
  credential in tree, and **none anywhere in their history** (they do not
  contain `2d08ae9`/`9828696`/`d300888`).

### A.3 Does the secret remain in Git history? Which refs?

Yes — the value-B blob is reachable in the **history** of every ref that
contains `9828696` or `d300888`: the 4 local audit branches + 8 remote
branches (`API-FIX2..6`, `Audit-FIX7`, `Audit-AI-FIX8`,
`Audit-ConfigSecur-FIX9`). Value A (superseded) additionally remains in
`origin/Vendor-API-FIX` history. **The current audited branch
(`item8-report`) contains the historical secret** (reachable via its
ancestry) even though its tree no longer tracks the file.

### A.4 Other credentials in Git history?

A pattern scan across all refs (`sk_live`, `whsec_`, `rk_live`, private-key
headers, `AKIA`, `ghp_`, `xoxb-`, `sk-ant`, `sk-proj`, `GOCSPX`) found:

- `sk_live_xxx` / `whsec_...` → `src/lib/payments/README.md` + a comment in
  `src/lib/stripe.ts` — **documentation placeholders, not credentials**.
- `AKIA`-like strings → unrelated base64 noise in `skills/design/` HTML
  templates — false positives.
- `ghp_` → `worklog.md` (platform sandbox lineage, local-only, unpushed):
  the **truncated prefix of the already-revoked ephemeral push PAT** from a
  prior session — not a usable token.
- `GOCSPX` (the Google secret prefix) → only the `.env` blobs described
  above + the Phase 9 docs that *name* the pattern without values.

**Net: the ONLY genuine secret ever committed to this repository is the
Google OAuth client secret (values A and B) plus the dev-grade
`NEXTAUTH_SECRET` alongside it.** No Stripe keys, no private keys, no
provider API keys in history.

---

## B. Railway configuration (Part 1B)

What the application actually reads (same code in the audit lineage and the
pushed auth branches — `src/lib/nextauth.ts`, `src/app/api/auth/[...nextauth]`,
`src/app/api/auth/google-bridge`, `src/app/login/page.tsx`):

| Concern | Read from | Notes |
| --- | --- | --- |
| Google provider | `process.env.GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | NextAuth v4.24.11 `GoogleProvider` |
| Session/JWT | `process.env.NEXTAUTH_SECRET` | JWE cookie via HKDF → AES-256-GCM; also decrypted by the google-bridge |
| Base/callback URL | `process.env.NEXTAUTH_URL` | v4 requires it in production; bridge falls back to `x-forwarded-host` |
| Session → app session | `/api/auth/google-bridge` | decrypts the NextAuth cookie, maps/creates the household + HOME subscription + OWNER member, mints the household JWT |

**How Railway gets its configuration (evidence):**

1. The Railway deployment builds via the repo `Dockerfile` ("Production
   Dockerfile for Railway (v2)"; the `origin/railway/code-change-WeaO-V`
   branch — created by the Railway workflow — carries the Docker
   sqlite→postgresql conversion commits and is contained in `origin/main`'s
   history, i.e. the Railway service is bound to this repository).
2. The Dockerfile's **runtime stage copies NO `.env`** (only `node_modules`,
   `prisma`, `scripts`, `entrypoint.sh`, `.next/standalone`,
   `package.json`). The repo `.env` therefore does not reach the production
   image through the Dockerfile.
3. NextAuth v4 **requires `NEXTAUTH_URL` in production** and the Google
   provider requires `GOOGLE_CLIENT_ID`/`SECRET` at runtime. Since the
   Railway login demonstrably works, the effective Railway values come from
   the **Railway service environment** (dashboard variables injected at
   runtime, which always override any file-based env). The bridge's own
   code documents the Railway origin handling (`NEXTAUTH_URL` or
   `x-forwarded-host`).
4. Whether Railway's `GOOGLE_CLIENT_SECRET` equals value B **cannot be
   determined from this sandbox** (no Railway access). Both possibilities
   are handled in the conclusion (§E).

**The deployed branch** cannot be read from the repository alone (Railway
service setting), but the working Google login requires a branch that
contains the September auth code — i.e. one of the feature branches (the
`origin/main` tip of 2026-07-22 predates the login page entirely:
`src/lib/nextauth.ts` does not exist there).

---

## C. Local configuration + failure reproduction (Part 1C)

### C.1 Local environment facts (sanitized)

- `/home/z/wt-item8/.env` (untracked, on disk): `DATABASE_URL`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`,
  `NEXTAUTH_URL`, `OPS_EVENTS_URL` — **identical values to the last
  committed version** (line fingerprints match `d300888`'s exactly,
  including the secret fp `843b7de3d246d9a9`).
- `NEXTAUTH_URL` = `http://localhost:3000` (localhost — correct for
  same-machine browsing).
- The dev server on :3000 loads these values via Next.js env loading
  (verified: `/api/auth/providers` returns the `google` provider with
  `callbackUrl` = `http://localhost:3000/api/auth/callback/google`).

### C.2 Reproduction 1 — the real button flow works locally

The exact browser flow (`POST /api/auth/signin/google` with CSRF, as
`next-auth/react`'s `signIn()` performs it) was reproduced with curl and
then in a **live headless browser**:

- `POST /api/auth/signin/google` (with CSRF) → **HTTP 200** with
  `{"url":"https://accounts.google.com/o/oauth2/v2/auth?client_id=<MASKED>.apps.googleusercontent.com&...&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fcallback%2Fgoogle&..."}`
  — the provider is fully configured locally and NextAuth builds the
  Google authorization request.
- Clicking **"Continue with Google"** on `/login` in the browser navigates
  to **Google's account-identifier sign-in page** (`accounts.google.com/v3/signin/identifier?...`)
  — the button is NOT broken. (An earlier hypothesis that
  `redirect: false` suppresses navigation was disproven by this live test:
  next-auth v4 always navigates for OAuth providers because
  `isSupportingReturn` is false for them.)
- (A bare `GET /api/auth/signin/google` — not the browser flow — is
  redirected by NextAuth v4 to the custom login page with an error
  parameter; this is framework fallback behaviour, not the app's failure
  mode.)

### C.3 Reproduction 2 — the actual local failure mode

After a successful Google consent, Google redirects the browser to the
`redirect_uri`, which is pinned by `NEXTAUTH_URL` to
`http://localhost:3000/api/auth/callback/google`. This completes **only
when the user's browser runs on the same machine as the dev server**. A
user accessing the app through the sandbox **preview domain** is sent to
*their own machine's* port 3000 → connection dead end → **"Google login
does not work correctly in local development."** This is a redirect-target
configuration property of local dev, not a credential or code failure.

Additionally: **a fresh clone of the current branch cannot run Google login
at all** — since P9B-2 untracked `.env`, a new checkout has no
`GOOGLE_CLIENT_ID`/`SECRET`, and the login page's own error path shows
"Google sign-in is not available in this environment" (its comment
anticipates exactly this). Phase 9.5 adds `.env.example` (secrets-free) so
fresh clones know the required variables.

### C.4 Credential validity probes (no secrets printed, no real codes used)

Two passive probes were performed from the sandbox with the local `.env`
values read into shell variables (never echoed):

1. **Google authorize endpoint** with the local client_id and
   `redirect_uri=http://localhost:3000/api/auth/callback/google` →
   **HTTP 302 to Google's sign-in page** (not a `redirect_uri_mismatch`
   400): the **client_id is valid AND the localhost redirect URI is an
   authorized redirect URI** of the Google OAuth app.
2. **Google token endpoint** with client_id + client_secret + grant_type=
   authorization_code + a deliberately bogus code → response
   `{"error":"invalid_grant"}` (NOT `invalid_client`). Google
   authenticates the client (id + secret) **before** validating the code,
   so: **the committed/local client secret (value B) is VALID and ACTIVE at
   Google right now.**

### C.5 Sanitized error catalogue

| Probe | Result |
| --- | --- |
| `GET /api/auth/providers` (local :3000) | `{"google":{...,"callbackUrl":"http://localhost:3000/api/auth/callback/google"}}` — provider configured |
| `POST /api/auth/signin/google` (CSRF) | 200 + Google authorize URL — initiation OK |
| Browser click on "Continue with Google" | navigates to `accounts.google.com/v3/signin/identifier?...` — UI flow OK |
| Google authorize (localhost redirect_uri) | 302 → sign-in page — redirect URI authorized |
| Google token endpoint (bogus code) | `invalid_grant` — **client secret VALID** |
| Full login via preview domain | dead-ends at `http://localhost:3000/api/auth/callback/google` on the *user's* machine — the local failure |

---

## D. Environment comparison (Part 1D)

| Configuration | Local (sandbox :3000) | Railway (deployed) | Expected |
| --- | --- | --- | --- |
| Google Client ID | set (value B's ID, from untracked `.env`) | set (Railway service env; same or newer — not determinable from here) | per-environment, public identifier |
| Google Client Secret configured | **yes — value B, VALID at Google (probe)** | yes (Railway service env; equality with B not determinable) | strong secret, never in Git |
| Callback URL | `http://localhost:3000/api/auth/callback/google` | `https://<railway-origin>/api/auth/callback/google` (from Railway env) | each origin registered in the Google app |
| Base URL (`NEXTAUTH_URL`) | `http://localhost:3000` (`.env`) | Railway origin (service env — required by NextAuth v4 in prod; login working proves it) | per-environment |
| Authorised origin (Google app) | localhost:3000 **is** authorized (authorize probe 302) | Railway origin authorized (login works) | both registered |
| NextAuth/Auth.js secret | **dev-grade placeholder** (26 chars, common-placeholder pattern, 13 unique chars — same value as committed since 2026-08-16) | set (Railway service env; value not determinable) | strong unique value per environment |
| Provider configuration | `GoogleProvider` via env; complete | same code, Railway env | identical code, env-separated values |

---

## E. Security conclusion (Part 1E)

**Is the Google OAuth credential exposed/compromised, or is this a
local-vs-Railway configuration discrepancy? — BOTH, independently:**

1. **Exposure (real, active):** a valid, Google-active OAuth client secret
   (value B) is committed in the history of 12 refs, 8 of them on the
   remote, and 8 remote trees still carry it in a tracked `.env`. It grants
   token-exchange capability for the Google OAuth app to anyone with repo
   read access. This is true regardless of what Railway uses.
2. **Local-vs-Railway discrepancy (real, unrelated to #1):** local failure
   = loopback redirect target for off-host browsers (+ fresh clones lacking
   `.env`); Railway success = its service-env origin/credentials.

### Is rotation required? Yes — as an OWNER action (not done here)

- **Why:** the leaked value B is probe-verified ACTIVE. Exposure of an
  active client secret is a P1 regardless of whether Railway happens to use
  the same value.
- **Which credential:** the Google OAuth **client secret** (rotate in
  Google Cloud Console → APIs & Services → Credentials → the OAuth client
  → "Add new secret"; the old secret can be deleted after cutover), plus
  the **`NEXTAUTH_SECRET` placeholder** (set a strong value — see Part 2).
- **Railway impact & how to preserve the working login:** update the
  Railway service variables (`GOOGLE_CLIENT_SECRET`, and `NEXTAUTH_SECRET`
  if changed) in the same maintenance window, then redeploy. Railway login
  breaks **only** if the secret is rotated without updating the Railway
  variable — doing both together preserves it. If Railway's dashboard
  currently holds value B, rotation + variable update is a seamless swap.
  Local `.env` files are updated out-of-band (never committed).
- **Recommended order:** (1) set/verify Railway variables for the NEW
  secret, (2) rotate at Google, (3) delete the old secret at Google, (4)
  update local `.env`s from the docs, (5) optionally purge the blob from
  Git history (git filter-repo/BFG) — only after rotation, coordinated
  across branch owners (history rewrite remains out of scope).
- **Not rotated now, per the Phase 9.5 rules:** nothing was changed; the
  residual risk until the owner rotates is: anyone with repository read
  access can exchange authorization codes for tokens as this OAuth client
  (requires a valid authorization code, which itself requires user
  consent — the secret alone does not grant account access, but it
  removes the client-authentication barrier and enables impersonation of
  the client in token exchanges).

---

## Part 2 — NEXTAUTH_SECRET

- **Locally:** exists (untracked `.env`), but is a **dev-grade placeholder**
  — 26 characters, matching a common-placeholder naming pattern, 13 unique
  characters. Identical value has been committed alongside the Google
  secret since 2026-08-16 (`9828696`-era) and is therefore ALSO in Git
  history on the same refs (P2 exposure: its predictability undermines
  session-token confidentiality for anyone who can guess/derive it).
- **On Railway:** not inspectable from this sandbox. The app REQUIRES it at
  runtime (NextAuth v4 throws in production without it; the google-bridge
  explicitly errors when absent), and login works — so a value IS present
  in the Railway service env (either the same placeholder via any bundled
  `.env`, or a real secret set in the dashboard — not determinable here).
- **Does the app rely on it?** Yes, three ways: (1) NextAuth JWT session
  cookie signing/encryption (JWE via HKDF-SHA256 → AES-256-GCM), (2) the
  `/api/auth/google-bridge` decrypts that cookie with the same secret to
  mint the household session, (3) CSRF token hashing.
- **Impact of changing it:** all existing NextAuth session cookies become
  undecryptable → Google-login sessions are invalidated **once** (users
  re-authenticate through Google on next click; the household JWT sessions
  use a separate secret and are unaffected; no data is lost). In-flight
  OAuth state tokens are likewise invalidated.
- **Safest implementation approach (owner):** generate
  `openssl rand -base64 32`, set it as the Railway service variable
  `NEXTAUTH_SECRET` during a low-traffic window, redeploy, and update local
  `.env` files out-of-band. Accept the one-time logout. Do NOT reuse the
  placeholder, and never commit the value. **No blind change was made
  during Phase 9.5.**

---

## Provenance of this investigation

- All git facts: `git log/show/ls-tree/branch --contains` on the repo at
  `/home/z/wt-item8` (branch `item8-report` @ the Phase 9.5 base).
- All live probes: the running dev server on :3000 (worktree code) and
  Google's public OAuth endpoints; secret values were held in shell
  variables and never echoed; no authorization code was ever exchanged; no
  credential was modified.
- Browser verification: headless Chromium (agent-browser) — the "Continue
  with Google" button click navigated to Google's sign-in page (URL
  client_id masked in all captured output).
