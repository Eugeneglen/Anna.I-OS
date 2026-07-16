CLAUDE.md — Anna.I
> This file gives Claude persistent context for the Anna.I project.
> Read this at the start of every session. Ask clarifying questions before starting any complex task.
---
What is Anna.I?
Anna.I is a subscription-based AI operating system for modern households, starting in Singapore. It eliminates household fragmentation by consolidating services, vendors, coordination, and accountability into one closed-loop AI system.
It is not a booking app. It is an OS layer — the intelligent system between a household and the services it depends on.
Current stage: Pre-launch. Raising SGD $1.5M Seed to run a 300-household pilot and prove the three core AI mechanisms before Series A.
---
The Three Core Mechanisms
These are the product's intellectual foundation. Reference them precisely — don't paraphrase loosely.
#	Mechanism	Internal Name	What It Does
1	Closed-Loop	The Trust Engine	Task → dispatch → photo verification → escrow release → rebooking. Builds trust.
2	Memory	The Household Graph	Learns preferences, vendor history, routines. Eliminates decision fatigue over time.
3	Predictive	The AI Layer	Anticipates needs, pre-books services, automates coordination. Shifts user from Manager → Approver.
These mechanisms are sequentially dependent — Closed-Loop feeds clean data into Memory, which enables Predictive. Never frame them as independent features.
---
The AI Autonomy Ladder
This is the user-facing expression of Memory + Predictive working. Where the Three Core Mechanisms describe what the AI does internally, the Autonomy Ladder is how a household experiences and earns the shift from Manager to Approver — visibly, gradually, and per service category (not household-wide).
Five levels, per category:
Level	Name	Behaviour
1	Manual	Household creates every task manually. System dispatches via basic assignment logic, but household confirms vendor + time. No suggestions surfaced.
2	Guided Suggestions	System suggests vendor + time slot (using affinity data from the Household Graph); household taps to confirm each booking. Rebooking prompts appear.
3	Auto-Dispatch	System auto-selects and dispatches the vendor without a confirmation tap — household is notified after the fact, not asked before. Scheduling/timing is still household-initiated.
4	Predictive Pre-Booking	System pre-books recurring services on learned cycles (the Predictive mechanism), with a visible cancel/edit window (e.g. 24–48hrs) before it locks in. Household can override anytime.
5	Full Autonomous	System manages the full cycle proactively for that category — booking, dispatch, scheduling. Household reviews/approves after the fact rather than before. This is the ceiling: the fullest expression of "Approver, not Manager."
Promotion rule: deterministic, not AI-judged. 2–3 verified, undisputed bookings at a household's current level in a category promotes them to the next level. This is a rule-engine calculation by design — auditable and explainable, consistent with keeping Routing, Anomaly Detection, and Predictive Scheduling rule-based/statistical rather than AI-judged through the pilot. It also means autonomy-level data cleanly supports the Series A cohort-comparison narrative (Month 4 cohort vs. Month 1 cohort) without a black-box decision muddying attribution.
Proposed default thresholds (not locked — confirm before treating as canonical):
Cleaning / Laundry: 2 cycles per level (higher frequency, faster signal)
Aircon / Handyman: 3 cycles per level (lower frequency, ad hoc — needs more signal per cycle to trust it)
These thresholds are not part of the Assumptions Engine Base Case and should not be treated as locked financial-model numbers — they're a product/UX default, tunable per category without a redeploy, and should be confirmed or adjusted before being treated as final.
What does not change with level: photo verification and escrow release. That protection is constant across all five levels — it is the core Closed-Loop brand promise and does not soften as a household earns more autonomy. What increases with level is how much the household is asked before Anna books or dispatches, not the financial trust check itself.
Safeguard (default, not yet confirmed as final): a dispute or failed verification pauses further promotion in that category until resolved. Default assumption is pause, not automatic demotion to a lower level — worth a deliberate decision rather than a silent default if the team wants harsher consequences for repeat failures.
Product framing: a visible per-category autonomy indicator (e.g. a 5-segment progress bar: "Cleaning: Level 3 of 5 — 2 more verified bookings to unlock Auto-Dispatch") is both a retention/engagement mechanic and an investor-demo asset — an aggregate view (% of pilot households at each level, per category) is a literal, visual rendering of the Household Graph maturing over the pilot, not just a backend metric buried in a report.
---
Key Numbers (Seed Stage — Base Case)
These are locked financial model assumptions (source of truth: `AnnaI_Financial_Model_Master_LPHV`, Assumptions Engine, Scenario 2). Use them consistently across all documents.
Parameter	Value
Seed raise	SGD $1.5M
Pre-money valuation	SGD $5.0M
Post-money valuation	SGD $6.5M
Seed lead equity	23.1% (Class B Preference)
Founder equity (combined)	66.9% (Class A Ordinary)
ESOP pool	10.0% (reserved pre-money)
Series A target	SGD $8M at Month 20
Pilot households	300
Pilot vendors	10 at Seed Day 1 → +5 vendors/month in Year 1
Service categories	4 (Cleaning, Laundry, Aircon, Handyman)
Pilot duration	90-day minimum cohort / 6-month sprint
Home subscription	SGD $8/month
Care subscription	SGD $68/month (full GTM from Month 30)
Platform commission	10%
Blended job value	SGD $68
Jobs/HH ramp	1.5 (M1) → 2.5 (M24) → 3.5 (M60)
Off-platform leakage	15%
Home churn	8%/month (M1–6) → 5%/month (M7+)
Annual plan discount	10% at 15% household adoption rate
Founder aggregate salary	SGD $15,000/month (base, pre-CPF)
Employer CPF rate	17% (locked)
S&M activation	30% of revenue from Month 20
Stripe processing	2.9%
Escrow processing	0.5%
Vendor SaaS price	SGD $20/month (Base)
Vendor SaaS attach rate	35%
Referral rate	1.0%/month of base at M6 → 1.5%/month at M24
Cost per validated HH	SGD $380
Seed proof targets:
>92% vendor dispatch success rate (within 4 hours)
>95% photo verification compliance
<3% escrow dispute rate
>65% 30-day rebooking rate ← the core Seed metric
<5% monthly churn (pilot target)
>75% vendor utilisation rate
>70% tasks auto-coordinated (Memory graph, Month 6)
>65% predictive suggestion acceptance (Month 4+)
CSAT >4.4 / 5.0
---
Pilot Design Rationale
10 vendors is a deliberate design choice, not a constraint.
300 HH × 4 tasks/month (proof density) = 1,200 tasks ÷ 10 vendors = ~120 tasks/vendor/month ≈ 6/day
This density is required to demonstrate batching, utilisation gains, and Memory graph learning
30 vendors would yield ~2 tasks/vendor/day — too sparse to prove anything
Base financial case uses a more conservative jobs/HH ramp (1.5 at M1 → 2.5 by M24) for revenue; the 4 tasks/month figure is the proof-density target for signal and utilisation maths
Primary proof categories: Cleaning + Laundry — highest weekly frequency, richest Memory training data per household per month.
Founding cohort design (Month 3 — 50 households):
HDB multi-generational (15): highest service frequency, richest laundry + cleaning data
Dual-income condo (15): time-sensitive scheduling, high predictive value
Expat household (10): cold-start vendor routing test
Single professional (10): tests minimum viable Memory graph
---
Build Sequence
Non-negotiable. Do not reorder.
Household Graph (data schema — most consequential technical decision; changing it mid-pilot breaks baseline integrity)
Routing Engine
Anomaly Detector
Predictive Scheduler
NLU Interface
Note: the Build Sequence describes system readiness (does the mechanism exist yet). The AI Autonomy Ladder (above) is a separate, per-household, per-category axis layered on top — a household cannot reach a given autonomy level until the corresponding mechanism in this sequence has shipped, but the two are not the same gate. Do not conflate them.
---
Business Model
Four revenue streams:
Stream	Mechanism	Base Case
Subscriptions	Monthly household membership	Home SGD $8/mo; Care SGD $68/mo
Job commission	10% on verified bookings via escrow	SGD ~$7/job at blended value
Anna.I Care packages	Eldercare companion bundles	Full GTM from Month 30
Vendor SaaS	Premium analytics + routing priority	SGD $20/mo per vendor; 35% attach
Moat: Proprietary household data — preferences, routines, vendor relationships, spend patterns. Not replicable from supply alone. Value compounds with every interaction. Switching cost rises continuously.
Coordinator cost reduction is the margin engine: Declining from ~SGD $38/HH to ~SGD $8/HH as AI automation matures. Gross margin trajectory: ~25% at Seed → ~68% by Year 5.
---
Competitive Landscape
Competitor	Why They Fall Short
Helpling	Marketplace, no memory, no coordination intelligence
Sendhelper	Shut down Feb 2025 — transactional model failed at unit economics
Urban Company	USD $2B, 59 cities, stateless — transaction scale without household memory
Kaodim / Carousell	Supply aggregators, no closed-loop accountability
Anna.I's thesis: transaction scale without memory is brittle. Memory changes the economics.
---
Target Market
Primary ICP: Dual-income households with 1–2 children (HDB and private condo), age 30–45, household income SGD $10,000–$14,000/month. 52% of Singapore households are dual-income (SG Dept of Statistics, Feb 2026). ~180,000 addressable HH.
Secondary ICP: Affluent DINKs / Power Singles — age 26–40, premium outsourcers, low CAC. ~120,000 addressable HH.
Tertiary ICP: Sandwich Generation Caregivers — age 36–56, managing two households, highest emotional urgency, highest LTV. ~90,000 addressable HH.
Expansion: SEA post-Series A (Malaysia, Thailand — same fragmentation problem in every SEA city).
The real competitor: WhatsApp + mental notes + 5–8 disconnected apps per household. That is what Anna.I replaces.
---
Care Tier
SGD $68/month subscription (Base case, Assumptions Engine Scenario 2)
Full Anna.I Care GTM packaging launches at Month 30 in the model
Highest-LTV vertical
Serves the eldercare gap: daily life support for elderly parents (companionship, errands, welfare checks, light assistance) — sits unserved between clinical care and cleaning
Requires MAS/MOH regulatory clarity and clinical partner agreements — deferred to maintain Seed simplicity
Series A adds this vertical onto a proven platform
---
Capital Deployment — SGD $1.5M
Category	Budget	%
Founding Team (3 founders + 3 hires, 18 months)	SGD $630,650	42.0%
Platform Build (MVP + Memory foundation)	SGD $395,000	26.3%
Contingency / Proof Buffer	SGD $195,350	13.0%
Operations & Compliance	SGD $165,000	11.0%
Pilot Acquisition & Validation (300 HH × $380)	SGD $114,000	7.6%
Founder compensation: SGD $5,000/month each (base) + 17% CPF = SGD $5,850/month all-in. Step-up to SGD $10,000/month pre-agreed at Series A close, documented in SHA.
Cost per validated household: SGD $380 (calculated from first principles — acquisition $100 + vendor onboarding $27 + white-glove ops $160 + infrastructure $73 + exit interviews $20).
---
Cap Table (Seed Close)
Stakeholder	Equity	Instrument
Founders (combined, 3 × 22.3%)	66.9%	Class A Ordinary (4-yr vest, 12-mo cliff)
Seed Lead	23.1%	Class B Preference (1× non-participating liquidation preference, BWAA anti-dilution, VIMA-aligned)
ESOP Pool	10.0%	Reserved Ordinary (pre-money, unallocated)
Post-money: SGD $6.5M · Raise SGD $1.5M · Pre-money SGD $5.0M
Board: 2 founder directors + 1 lead investor director. Founder majority preserved through proof phase.
---
Series A Narrative
The compounding thesis: older cohorts become more valuable over time through AI memory compounding, switching cost accumulation, and multi-category adoption. This is the central Series A argument — show the learning curve, not just the revenue curve.
Series A funds:
Care module (full eldercare — highest-LTV vertical)
Scale acquisition (programmatic digital + B2B2C corporate benefits — 119,000 users addressable)
Vendor SaaS platform (density requires 5,000+ HH / 50+ vendors)
Full predictive engine (NLP, smart inventory, proactive scheduling)
SEA expansion (Malaysia, Thailand)
S&M activation at Month 20 (30% of revenue) — moved earlier to address cash runway in LP/HV model.
---
Brand Guidelines
Apply to all Anna.I deliverables — decks, UI, documents, marketing assets.
Element	Spec
Primary colour	Sage green `#A8BBAE` (per `BrandID.md` — canonical)
Background	White or sage-light
Charcoal	`#2C2C2C`
Typography	Calibri-inspired clean sans-serif
Iconography	Thin line-art — brain, shield, network nodes, eye, fingerprint, calendar, radar, hand
Aesthetic	"Morgan Stanley meets Linear" — clean, intelligent, AI-forward
Voice	Precise, confident, substantive — no hype, no filler
---
Claude's Role on This Project
Domain	What Claude Does
Market research	Competitive analysis, market sizing, regulatory context (MAS, CASE SG), benchmarks
Financial modelling	Scenario analysis, unit economics, LTV/CAC, cohort projections
Investor materials	Pitch deck copy, data room documents, investor memos, FAQs
Product strategy	Feature specs, user flows, mechanism design, roadmap documents
UI/UX	User-facing interface design and prototyping (React/HTML/CSS)
Vendor backend	Backend system logic, vendor onboarding flows, admin dashboards
Code	Full-stack development — app features, data pipelines, APIs
Writing	Long-form documents, strategy papers, internal comms
---
Working Rules
Ask before building. On any complex task, clarify scope, format, and constraints before starting. Don't assume.
Use canonical numbers. Always use the financial model assumptions in this file. Flag if a number you're asked to use conflicts with them.
Approve before execute. Show the proposed approach first. Wait for confirmation before full implementation.
Targeted edits only. When modifying documents, limit changes strictly to the stated scope. No unintended side effects.
Be precise about mechanisms. Don't say "AI features" — use the correct mechanism names (Closed-Loop, Memory, Predictive). Don't conflate them.
Brand consistency. Apply Anna.I brand guidelines (sage green, Calibri, thin line-art) to all visual deliverables.
Cross-document consistency. Anna.I operates across multiple live documents simultaneously. Internal consistency (data, styling, structure) is a hard requirement.
Assumptions Engine Base Case (Scenario 2) is the authoritative source of truth. Flag any discrepancy before using a different number.
No fluff. Anna.I's voice is substantive and confident. Strip filler phrases, avoid hype language, write tight.
Flag conflicts. If a request contradicts something in this file, flag it before proceeding.
Say so if unsure. Don't guess at market data, regulatory facts, or technical specs. Flag uncertainty explicitly.
Confidentiality framing. All investor-facing documents should carry: "CONFIDENTIAL — The concepts, frameworks, and operating models presented herein are proprietary to the company and/or founder and may not be copied, shared, reproduced, or distributed without prior written consent."
---
Key Files & Documents
File	Contents
`AnnaI_Financial_Model_Master_LPHV.xlsx`	Master financial model — source of truth for all projections
`Anna_I_OS_Modern_Household_V2_RD.pdf`	Seed investor pitch deck
`Seed_Edition_Proving_the_Mechanism_V3.html`	Detailed mechanism proof document for investors
`Product_Strategy_AI_Systems_Architecture_V3.html`	Full product strategy and AI systems architecture
`anna-i-growth-strategy.html`	12-section B2C digital growth strategy
`AnnaI_Dev_Kickoff_Prompt.md`	Development kickoff prompt for the build agent (Z.ai/ZCode) — implements the Build Sequence and AI Autonomy Ladder defined in this file
---
Terminology
Term	Meaning
Household Graph	The proprietary memory layer — stores preferences, vendor history, routines, spend patterns
Closed-Loop	The full task lifecycle: create → dispatch → verify → escrow release → rebook
Trust Engine	Closed-Loop mechanism in brand language
Memory	The AI's accumulation of household-specific coordination intelligence
Predictive	The AI layer that anticipates and pre-books based on learned patterns
Approver (not Manager)	The user's evolved role once Memory takes over coordination
AI Autonomy Ladder	The 5-level, per-category framework by which a household earns increasing booking autonomy (Level 1 Manual → Level 5 Full Autonomous), gated by verified/undisputed booking cycles, not by AI judgment
Autonomy Level	A household's current position (1–5) on the Autonomy Ladder for a specific service category
HH	Household
M1, M3, M6 etc.	Month 1, Month 3, Month 6 of pilot
Base (2)	Assumptions Engine Base Case, Scenario 2 — the canonical financial scenario
LP/HV	Low Price / High Volume — the current financial model variant
HP/LV	High Price / Low Volume — the alternative model compared in the PPTX deck
PMF	Product-market fit
GTM	Go-to-market
LOI	Letter of Intent (vendor agreements)
HDB	Housing Development Board (public housing, Singapore)
VIMA	Venture Investment Model Agreement — Singapore standard venture document framework
BWAA	Broad-based weighted average anti-dilution (Class B protection)
MAS	Monetary Authority of Singapore
AIC	Agency for Integrated Care (Singapore eldercare)
CASE	Consumers Association of Singapore
