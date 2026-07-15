# Anna.I — Development Kickoff Prompt (for Z.ai / ZCode)

**How to use this:** Paste this as the first message to your Z.ai coding agent (ZCode, running GLM-5.2 — or Claude Code/Cursor pointed at Z.ai's Anthropic-compatible endpoint, if that's your setup) in the project root, alongside `CLAUDE.md` (Anna_i.md) and `BrandID.md` already in the repo. This prompt is the build charter — treat `CLAUDE.md` as canonical for all numbers, terminology, and rules; this document tells you *what to build, in what order, and how*.

**Note on model choice:** this prompt is written to be agent-agnostic — everything below (schema, phases, acceptance criteria) applies whether the underlying model is GLM (via Z.ai) or Claude. The one place model choice actually matters is Section 4a/7 ("Ask Anna" / NLU) — that's a separate decision about which LLM *Anna.I itself* calls in-product, independent of which agent builds it. Flagged there rather than assumed.

---

## 0. Your Mission

Build **Anna.I** — a subscription-based AI operating system for Singapore households, currently pre-launch and pre-seed-proof. You are building the platform that must prove three sequentially-dependent AI mechanisms across a 300-household pilot with 10 vendors across 4 service categories:

1. **Closed-Loop** (Trust Engine) — task → dispatch → photo verification → escrow release → rebooking
2. **Memory** (Household Graph) — learns preferences, vendor history, routines
3. **Predictive** (AI Layer) — anticipates needs, pre-books, shifts user from Manager → Approver

This is not a marketplace app. It is an OS layer. Every architectural decision should optimize for **clean, learnable data from day one** — the Household Graph schema is the single most consequential decision in this build, because it cannot be reworked mid-pilot without breaking baseline integrity.

Read `CLAUDE.md` in full before writing any code. It contains the canonical financial model numbers, mechanism definitions, and working rules (ask before building, targeted edits only, confirm before executing). Those rules apply to you as the coding agent, not just to conversational Claude — **do not skip ahead of the current phase, do not silently make architecture decisions outside what's specified below, and flag anything that conflicts with `CLAUDE.md` before proceeding.**

---

## 1. Non-Negotiable Build Sequence

Build in this exact order. Do not reorder, do not parallelize across phases (sub-tasks within a phase can parallelize).

| Phase | Deliverable | Why it's gated |
|---|---|---|
| **1** | Household Graph schema + Closed-Loop core loop | Schema decisions here are irreversible mid-pilot. Closed-Loop must exist first because it's the only source of clean data Memory can learn from. |
| **2** | Routing Engine **+ "Ask Anna" read-only LLM layer** | Needs real dispatch data flowing from Phase 1 to route against. The read-only layer needs real data to talk about, and gives the product an "AI OS" feel early without touching the transactional core (see Section 5a). |
| **3** | Anomaly Detector | Needs a working routing baseline to detect deviations from. |
| **4** | Predictive Scheduler | Needs 60-90 days of Anomaly-Detector-clean data to predict against. |
| **5** | NLU Interface (write-capable) | Sits on top of everything else — natural language *writing* to the system (creating bookings, reassigning vendors) is a UX layer over a proven, working system, not a starting point. |

**A note on "AI-powered OS" vs. "LLM in the loop":** these are not the same requirement. Routing (Phase 2), Anomaly Detection (Phase 3), and Predictive Scheduling (Phase 4) are the mechanisms that make Anna.I an AI OS — they're rule-based/statistical, not LLM calls, and that's intentional (see Section 5a for why). Claude API enters the transactional path only at Phase 5, once the graph has months of clean data behind it.

**Pilot scope constraints (do not over-build past these):**
- 300 households, 10 vendors at launch (+5/month Year 1), 4 categories: Cleaning, Laundry, Aircon, Handyman
- Cleaning + Laundry are the primary Memory-training categories (weekly/fortnightly frequency)
- Home tier: SGD $8/month · Care tier: SGD $68/month (Care GTM deferred to Month 30 — build the subscription tier now, do not build eldercare features yet)
- Platform commission: 10% · Blended job value: SGD $68
- Seed proof targets to instrument for from day one: >65% 30-day rebooking, >92% dispatch success (4hr), >95% photo verification compliance, <3% escrow dispute rate, >75% vendor utilisation, >70% auto-coordinated tasks (Month 6), >65% predictive acceptance (Month 4+)

---

## 1a. The AI Autonomy Ladder (cross-cutting — read before Phase 1 schema)

**This is a product decision, not a build-phase gate.** The 5-phase build sequence above is about *system readiness* — does the Routing Engine exist yet, does the Predictive Scheduler exist yet. The Autonomy Ladder is a separate, per-household, per-category axis: how much booking autonomy has *this household* earned for *this category*, based on its own track record. The two interact (a household can't reach Level 4 autonomy in a category until the Predictive Scheduler is actually built) but they are not the same gate — do not conflate them.

**Five levels, per service category (not household-wide):**

| Level | Name | Behaviour | Needs (build phase) |
|---|---|---|---|
| **1** | Manual | Household creates every task manually. System dispatches via basic assignment logic, but household confirms vendor + time. No suggestions surfaced. | Phase 1 |
| **2** | Guided Suggestions | System suggests vendor + time slot (using affinity data); household taps to confirm each booking. Rebooking prompts appear. | Phase 1–2 |
| **3** | Auto-Dispatch | System auto-selects and dispatches the vendor without a confirmation tap — household is notified after the fact, not asked before. Scheduling/timing is still household-initiated. | Phase 2 (Routing Engine has to be trustworthy enough to dispatch unprompted) |
| **4** | Predictive Pre-Booking | System pre-books recurring services on learned cycles, with a visible cancel/edit window (e.g. 24–48hrs) before it locks in. Household can override anytime. | Phase 4 (Predictive Scheduler) |
| **5** | Full Autonomous | System manages the full cycle proactively for that category — booking, dispatch, scheduling. Household reviews/approves after the fact rather than before. NLU write-actions (Phase 5) available here if household opts in. | Phase 4 + 5 |

**Promotion rule (deterministic, not LLM-judged):** 2–3 verified, undisputed bookings at the household's current level in a category → auto-promote to the next level. This stays a rule-engine calculation, same reasoning as keeping Routing/Anomaly/Predictive rule-based through the pilot — auditable, explainable, doesn't contaminate the "Month 4 cohort vs Month 1 cohort" proof story with a black-box decision.

**What does NOT change with level:** photo verification and escrow release. That protection is the constant brand promise — it does not get skipped or softened as a household earns more autonomy. What increases with level is *how much the household is asked before* Anna books/dispatches, not the financial trust check itself.

**Safeguard (flagging as a default, confirm before building):** a dispute or failed verification pauses further promotion in that category until resolved. Default assumption is *pause*, not automatic demotion to a lower level — demotion behaviour is a call worth making deliberately rather than defaulting silently; flag it back if you want auto-demotion on repeat failures.

**Schema implication for Phase 1 (add now, not later):**
- `autonomy_level_thresholds` — (category, level, cycles_required) — a config table, not hardcoded constants, so thresholds can be tuned mid-pilot without a redeploy. Seed defaults to propose: Cleaning/Laundry = 2 cycles/level (high frequency, faster signal), Aircon/Handyman = 3 cycles/level (lower frequency, ad hoc — need more signal per cycle to trust it). Confirm before locking these in.
- `household_category_autonomy` — (household_id, category, current_level, verified_cycles_at_level, total_verified_cycles, promotion_paused boolean, last_promoted_at)

**UI:** a visible per-category autonomy indicator (5-segment progress bar or equivalent) — "Cleaning: Level 3 of 5 — 2 more verified bookings to unlock Auto-Dispatch." This is also a strong investor-demo asset later: aggregate view in the Ops Control Center (% of pilot households at each level, per category) is a literal, visual rendering of the Household Graph maturing — not just a backend metric.

---

## 1b. Platform Sequencing — Web First, Native Later (locked decision)

**Decision:** the 300-household pilot runs on a **PWA (installable, mobile-responsive web app)** — not React Native / native iOS+Android. Native comes post-pilot, as a Series A / scale-phase track, once the three mechanisms are proven.

**Why, briefly:** native app-store distribution (Apple Developer account, Xcode/macOS build requirement, App Store review cycles, native push/camera integration) is pure distribution overhead — it doesn't touch Closed-Loop, Memory, or Predictive, the three things this raise exists to prove. A 3-founder + 1 AI/ML-hire team fighting Xcode and App Store review during the pilot is time not spent proving the mechanism. This isn't a compromise — it's the same "prove the mechanism before funding distribution" logic already used elsewhere in the Seed thesis.

**What "PWA" means concretely, build this now, it's close to free given the stack:**
- `manifest.json` + service worker so households can add Anna.I to their home screen with an icon, like a real app
- Web push notifications (iOS 16.4+ Safari supports this for home-screen-added PWAs) — covers the "feels native" gap for reminders, dispatch notifications, verification prompts
- Camera access via the browser's `<input type="file" capture>` or `getUserMedia` for photo verification uploads — no native camera SDK needed

**Hard requirement that makes the later native migration cheap instead of a rewrite:** keep the backend (Prisma schema, business logic, escrow ledger, Routing/Anomaly/Predictive logic, Autonomy Ladder state) **cleanly separated from the Next.js UI layer.** Route Handlers/Server Actions should function as a real API contract — not business logic tangled directly into React Server Components. If this separation holds, a native rebuild later is "new frontend on an already-proven brain," not a rewrite of the mechanism itself. This is a non-negotiable architectural constraint for Phase 1 onward, not a nice-to-have.

**When native gets built:** post-pilot, funded by Series A or a dedicated pre-Series-A sprint, in a properly configured mobile dev environment (macOS + Xcode + Android SDK + Apple Developer account) — not in this sandbox, which cannot compile or sign a mobile binary regardless of agent capability. Realistic estimate against an already-working backend: 4–8 weeks build + 1–2 weeks App Store review buffer.

---

## 2. Proposed Tech Stack

Sized for a lean team (3 founders + 1 AI/ML hire + 1 product designer + 1 ops hire), optimized for shipping the Closed-Loop MVP fast without boxing out Memory/Predictive later.

| Layer | Choice | Why |
|---|---|---|
| **Monorepo** | Turborepo + pnpm workspaces (production) / single Next.js app (current sandbox) | Sandbox constraint — see note below |
| **Client platform** (household + vendor) | **PWA — installable, mobile-responsive web app** (Next.js). React Native/native iOS+Android deferred to post-pilot — see Section 1b, this is a locked decision, not open for re-litigation mid-build. | Distribution overhead (App Store review, Xcode/signing) doesn't advance the mechanism proof this raise funds |
| **Admin / Ops Control Center + Vendor SaaS Portal** | Next.js (App Router, TypeScript) | Server-rendered dashboards, shares component library via Tailwind tokens from `BrandID.md` |
| **API layer** | Next.js Route Handlers / Server Actions, treated as a real API contract | Sandbox reality — no separate NestJS service here. **Non-negotiable constraint: keep this cleanly separated from UI components** (Section 1b) so the eventual native rebuild is a new frontend, not a rewrite |
| **Primary database** | **Sandbox: SQLite via Prisma (prototype-only). Production/pilot: PostgreSQL, AWS RDS `ap-southeast-1`.** Prisma schema authored Postgres-compatible from day one so this is a config + migration, not a rewrite. **Hard gate: no real household, vendor, or escrow data goes live on SQLite** — single-writer file locking will not hold under concurrent WhatsApp webhook + photo-verification traffic even at 300 HH. | Household Graph modeled relationally (households, vendors, tasks, bookings, preferences, vendor-household affinity) with JSONB for flexible preference attributes. Do not introduce a separate graph DB (Neo4j etc.) at this scale — revisit only post-Series A at 5,000+ HH. |
| **ML / routing / predictive service** | Python (FastAPI) microservice, or a rule-based module inside the Next.js API if that's simpler for the sandbox — this is a Phase 2+ decision, not urgent now | AI/ML hire will work in Python; keep model logic isolated from product API churn once it exists |
| **Auth** | Supabase Auth or Clerk | Don't build auth from scratch |
| **File/photo storage** (verification photos) | Sandbox: local/temp storage acceptable for prototyping. Production: AWS S3, `ap-southeast-1`, direct upload with signed URLs, browser-native camera capture (no native SDK needed per Section 1b) | |
| **Escrow / payments** | Stripe Connect (destination charges) + custom internal ledger table — real integration, not mocked, once the sandbox is wired to make real outbound API calls | Stripe does not natively support milestone escrow-on-verification — build an `escrow_ledger` table that tracks hold → release state. This is core Closed-Loop infrastructure — the trust mechanism, build carefully. |
| **Notifications** | WhatsApp Business API (Twilio or 360dialog) + Web Push (PWA, per Section 1b) + Resend (email) | WhatsApp is the dominant SG household channel per brand strategy — first-class channel, not an afterthought |
| **Analytics** | Mixpanel (product events) + GA4 (web) | Matches existing growth-strategy doc; wire up event tracking from day one so Seed proof metrics are measurable without a retrofit |
| **Infra / hosting** | Vercel (Next.js app) + RDS once migrated off SQLite | Skip Terraform/Kubernetes at this scale — managed hosting is the right call for a 300-HH pilot. Revisit at Series A scale. |
| **Conversational / NLU** | Claude API (Anthropic) **or** GLM via Z.ai's API — **decision needed, see Section 4a** | Introduced at Phase 2 as **read-only** ("Ask Anna" — see Section 4a); upgraded to **write-capable** at Phase 5 once the transactional core is proven. Do not give it write access to bookings, dispatch, or escrow before Phase 5. This is a separate decision from which agent builds the platform — pick based on cost, tool-calling reliability for your specific flows, and whether you want a single vendor (Z.ai) across build + product, or Anthropic for the product layer specifically. |

**Explicitly out of scope for this build:** Anna.I Care / eldercare features, multi-market/SEA localization, vendor SaaS billing beyond a flat SGD $20/mo flag, enterprise/estate white-label. These are Series A or later.

---

## 3. Phase 1 — Household Graph Schema + Closed-Loop Core Loop

**Objective:** Design the data schema that everything else depends on, and build the minimum transactional loop needed to start generating real household/vendor interaction data.

**Core entities to model (Postgres):**
- `households` — profile, service categories active, address (estate-level for batching), preferences (JSONB), created_at
- `family_members` — multi-user access per household, role
- `vendors` — category, verification status, background check data, capacity/availability
- `vendor_household_affinity` — the core Memory table: per (household, vendor, category) — booking count, avg rating, re-assignment history, last N job outcomes (not just an average — store the history so "last 20 jobs" scoring per the trust strategy doc is possible)
- `tasks` — category, status (created → dispatched → completed → verified → escrow_released → disputed), recurrence pattern
- `bookings` — task instance, vendor assigned, scheduled time, actual completion time
- `verification_photos` — S3 reference, task_id, timestamp
- `escrow_ledger` — task_id, amount, state (held/released/disputed/refunded), state transition timestamps
- `household_instructions` — logged per task, so "instructions re-entered" rate (a named Seed metric) is directly queryable, not inferred
- `subscriptions` — tier (Home/Care), status, billing cycle
- `autonomy_level_thresholds` — (category, level, cycles_required) — config table backing the AI Autonomy Ladder (Section 1a), not hardcoded constants
- `household_category_autonomy` — (household_id, category, current_level, verified_cycles_at_level, total_verified_cycles, promotion_paused, last_promoted_at) — per-household, per-category autonomy state (Section 1a)

**Closed-Loop functionality to build:**
1. Task creation (manual, in-app) across all 4 categories
2. Vendor dispatch (can be simple rule-based assignment for Phase 1 — the *real* routing intelligence is Phase 2; Phase 1 just needs dispatch to work end-to-end)
3. Photo verification upload + household sign-off
4. Escrow release on verification (or dispute flow if rejected)
5. Rebooking prompt/flow
6. Autonomy cycle counter: on each verified, undisputed booking, increment `verified_cycles_at_level` for that (household, category); auto-promote per `autonomy_level_thresholds` (Section 1a). At Phase 1, only Levels 1–2 have distinct behaviour available — the schema/counter exists now so no rework is needed when Phases 2–5 unlock Levels 3–5.

**Acceptance criteria before moving to Phase 2:**
- A household can create a task, get dispatched to a vendor, verify photo completion, and trigger escrow release — end to end, for all 4 categories
- Every event in the loop is timestamped and queryable for the Seed proof metrics table in `CLAUDE.md`
- Schema has been reviewed against the "most consequential decision" framing — confirm with the team before writing migrations, not after

---

## 4. Phase 2 — Routing Engine

**Objective:** Replace Phase 1's simple dispatch with vendor-household affinity-aware routing.

- Score vendors for a given task by: category match, past household affinity (from `vendor_household_affinity`), current vendor utilisation/capacity, geographic batching potential (same estate/zone)
- Target: >92% dispatch acceptance within 4 hours, vendor utilisation trending toward 75%+ (won't hit that in Phase 2 alone — this is a multi-phase climb)
- Rule-based + simple weighted scoring is sufficient here — do not reach for ML models yet. Per `CLAUDE.md`, the Seed-stage routing engine is explicitly "rule-based + early graph learning," not a trained model.
- This phase is what makes **Autonomy Level 3** (Auto-Dispatch, Section 1a) possible — routing has to be trustworthy enough to dispatch without a confirmation tap. Households remain capped at Level 2 until this ships and has enough verified cycles behind it.

### 4a. "Ask Anna" — Read-Only LLM Layer (build alongside Phase 2)

**Objective:** Give households and the ops team a conversational surface early, without putting an LLM anywhere near dispatch, routing, or money movement.

**Model choice — flagging, not deciding:** either Claude API (Anthropic) or GLM via Z.ai's API works here with tool-calling into the existing API. This is independent of which agent builds the platform. Practical considerations if you want a recommendation: Z.ai/GLM keeps you on one vendor and one bill across build + product; Claude API may be worth it specifically for this layer if tool-calling reliability on your exact flows turns out to differ in testing — worth a small side-by-side test with real household queries before committing, not a guess.

- Read-only tool calls into the existing API: `get_household_status`, `get_upcoming_tasks`, `get_vendor_history`, `get_escrow_status`, etc.
- Answers questions and explains state: *"What's scheduled this week?" "Why was my cleaner changed?" "How much have I spent on services this month?"*
- **Hard constraint: no write access.** This layer cannot create a task, dispatch a vendor, release escrow, or reassign anyone. If a household asks it to *do* something, it should point them to the relevant in-app action, not attempt to perform it via tool call.
- Why now, not Phase 1: it needs real data to be useful. Why not full NLU yet: full NLU (Phase 5) *writes* to the system — creating bookings, triggering dispatch — and that shouldn't happen until the transactional core (Phases 1–4) is proven and stable. This layer is explicitly scoped to read/explain only.
- This also protects the Seed proof narrative: because Routing, Anomaly Detection, and Predictive Scheduling stay rule-based/statistical and auditable through the pilot, "Month 4 cohort outperforms Month 1 cohort" can be attributed cleanly to the Household Graph — not muddied by an LLM making judgment calls somewhere in the transactional path.

---

## 5. Phase 3 — Anomaly Detector

**Objective:** Flag deviations automatically instead of relying on manual coordinator review.

- Detect: vendor running late (vs scheduled window), task overdue, verification photo missing past SLA, rating drop vs vendor's rolling average, escrow dispute raised
- Escalation: push notification to household + flag in Ops Control Center for human coordinator backstop
- This directly targets the "human coordinator backstop invoked in <30% of tasks by Month 6" Seed metric — instrument the backstop invocation rate from day one so this is measurable.

---

## 6. Phase 4 — Predictive Scheduler

**Objective:** Move households from Manager → Approver.

- Detect recurring patterns (weekly cleaning day, quarterly aircon cycle) from Phase 1-3 data
- Generate pre-booking suggestions ("Your aircon is due — book Tuesday 10am with your usual vendor?")
- Track suggestion acceptance rate — target >65% by Month 4 of pilot, per `CLAUDE.md`
- This phase should *not* start until there's at least 60-90 days of clean Closed-Loop + Routing data — building predictive logic on thin data will produce bad suggestions and erode trust in the mechanism.
- This is what unlocks **Autonomy Level 4** (Predictive Pre-Booking, Section 1a) — households can't reach Level 4 in a category until this ships, regardless of how many verified cycles they've accumulated at Level 3.

---

## 7. Phase 5 — NLU Interface (Write-Capable)

**This phase upgrades "Ask Anna" (Section 4a) from read-only to write-capable** — same conversational surface, but now permitted to trigger bookings, reassignments, and other actions via tool calls, once the underlying transactional core has months of proven, stable behaviour behind it.

**Objective:** Natural language command layer over the existing system.

- e.g., "Book a deep clean before Chinese New Year and remind my husband to take down the curtains first"
- Use Claude API with tool-calling into the existing booking/task API — do not rebuild booking logic inside the NLU layer, it should call the same endpoints a human would trigger via the app UI
- This is additive UX, not a new data path — the Household Graph, Routing, and Anomaly systems underneath are unchanged by this phase
- This is what unlocks **Autonomy Level 5** (Full Autonomous, Section 1a) — the ceiling level, available only in categories where a household has already earned Level 4 and this phase has shipped.

---

## 8. Cross-Cutting Requirements (apply across all phases)

- **Brand:** Apply `BrandID.md` design tokens (sage green `#A8BBAE`, slate `#203132`, Manrope/JetBrains Mono) to every user-facing surface — mobile app, vendor portal, ops dashboard
- **PDPA compliance:** Singapore Personal Data Protection Act applies to all household and vendor data. Flag any data handling decision that needs legal review rather than guessing.
- **Security:** This handles payment/escrow data — standard practice (encrypted at rest, least-privilege access, no PII in logs) is not optional here
- **WhatsApp-first notifications:** Build the WhatsApp Business API integration early (Phase 1 or 2) — it's the dominant channel per the household's actual behaviour, not an add-on
- **Testing:** Every Closed-Loop state transition (task → dispatch → verify → escrow) needs test coverage — this is the trust mechanism, it cannot silently break
- **Metrics instrumentation:** Every Seed proof metric in `CLAUDE.md` should be queryable from the database without a data-engineering afterthought. Build the events/metrics layer alongside the feature, not after.

---

## 9. Working Rules for You (the Agent)

1. **Confirm before schema changes.** Once Phase 1 schema is approved and in use, any structural change needs explicit sign-off — this mirrors the human working rules in `CLAUDE.md`.
2. **Targeted work only.** Don't build Phase 3 features while working on Phase 1. Don't add eldercare, SEA localization, or enterprise features — they're explicitly out of scope.
3. **Use canonical numbers.** Every hardcoded constant (commission %, subscription price, SLA windows) should come from `CLAUDE.md` — flag if a number seems to conflict.
4. **Ask before big calls.** Framework choices within a phase (e.g., "which charting library") — just decide. Anything affecting the data model, payment flow, or cross-phase architecture — surface it and wait.
5. **Say what changed.** After each phase, summarize what was built, what's tested, and what's explicitly deferred to the next phase.

---

## 10. First Task

Start with Phase 1: **Household Graph schema design.** Before writing any migration:
1. Propose the full Postgres schema (tables, key fields, relationships) based on Section 3 above — **including the `autonomy_level_thresholds` and `household_category_autonomy` tables from Section 1a.** These are part of the same "most consequential, don't rework mid-pilot" schema decision, not a later add-on.
2. Explain any deviations from what's outlined here
3. Wait for sign-off before running migrations

Do not scaffold Phase 2+ features yet.
