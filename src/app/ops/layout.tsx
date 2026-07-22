import { ReactNode } from "react";

/**
 * Ops root layout — minimal passthrough.
 * Auth is handled by:
 *   - Middleware (redirects unauthenticated users to /ops/login)
 *   - (dashboard)/layout.tsx (fetches /api/ops/session, redirects on 401)
 */
export default function OpsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
