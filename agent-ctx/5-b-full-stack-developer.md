# Task 5-b — Agent: full-stack-developer
## Phase 2B: "Ask Anna" Read-Only LLM Chat

### Work Summary
Built the complete "Ask Anna" read-only AI chat feature for Anna.I, consisting of an API route with intent detection + data fetching + LLM integration, a polished chat UI component with FAB + chat panel, and layout integration.

### Files Created
1. **`src/app/api/ask-anna/route.ts`** — POST endpoint with:
   - Simple keyword-based intent detection (upcoming, spending, vendor, escrow, autonomy, summary, default)
   - 6 data-fetching functions: `fetchUpcomingTasks`, `fetchMonthlySpending`, `fetchVendorHistory`, `fetchEscrowStatus`, `fetchAutonomyStatus`, `fetchHouseholdSummary`
   - Structured context injection into LLM system prompt
   - z-ai-web-dev-sdk for LLM completions (backend only)
   - Response format: `{ response, dataUsed }`

2. **`src/components/anna/ask-anna.tsx`** — Chat UI with:
   - Floating Action Button (sage green) in bottom-right, above mobile tab bar
   - Animated chat panel (380×520 desktop, full-width bottom sheet on mobile)
   - User messages: right-aligned, sage green bubbles, white text
   - Anna messages: left-aligned, off-white bubbles, dark text
   - Typing indicator (3-dot bounce animation)
   - Auto-scroll, Enter key to send, input disabled during loading
   - TanStack Query `useMutation` for API calls
   - Mobile backdrop overlay, empty state with guidance text
   - Framer Motion animations for panel open/close

### Files Modified
3. **`src/lib/store.ts`** — Added `askAnnaOpen: boolean` and `setAskAnnaOpen` to AnnaStore
4. **`src/components/anna/layout-shell.tsx`** — Imported and rendered `<AskAnna />` component

### Verification
- ESLint: 0 errors
- Dev server compiled successfully with new files
- All monetary values formatted as SGD from cents internally
- z-ai-web-dev-sdk used only in API route (backend), never in client components
- Brand CSS variables used consistently throughout