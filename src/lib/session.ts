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

const SESSION_OPTIONS = {
  password: resolveSecret(
    "IRON_SESSION_PASSWORD",
    "anna-dev-session-secret-change-in-production",
    { owner: "iron-session (ops nextauth session)" }
  ),
  cookieName: "anna-ops-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24, // 24 hours
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/ops",
  },
};

export { SESSION_OPTIONS };
export { getIronSession };
