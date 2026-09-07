import { getIronSession } from "iron-session";
import { resolveSecret } from "@/lib/secrets";

export interface SessionData {
  userId: string;
  email: string;
  name: string;
  role: "ADMIN" | "COORDINATOR" | "ANALYST";
  isLoggedIn: boolean;
}

declare module "iron-session" {
  interface SessionData {
    userId: string;
    email: string;
    name: string;
    role: "ADMIN" | "COORDINATOR" | "ANALYST";
    isLoggedIn: boolean;
  }
}

// Lazy session options. The IRON_SESSION_PASSWORD secret is resolved on
// first USE (not at module import) so that `next build` — which evaluates
// route modules during page-data collection without deployment secrets —
// can import this module safely. Production still fails fast on the first
// request that actually needs the secret.
interface SessionOptions {
  password: string;
  cookieName: string;
  cookieOptions: {
    secure: boolean;
    maxAge: number;
    httpOnly: boolean;
    sameSite: "lax";
    path: string;
  };
}

const SESSION_OPTIONS: SessionOptions = {
  // Getter defers secret resolution to first property access (iron-session
  // reads `password` when a session is created/loaded, i.e. at request time).
  get password() {
    return resolveSecret(
      "IRON_SESSION_PASSWORD",
      "anna-dev-session-secret-change-in-production",
      { owner: "iron-session (ops nextauth session)" }
    );
  },
  cookieName: "anna-ops-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24, // 24 hours
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/ops",
  },
};

export function getSessionOptions(): SessionOptions {
  return SESSION_OPTIONS;
}

export { SESSION_OPTIONS };
export { getIronSession };
