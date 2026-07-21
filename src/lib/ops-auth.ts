import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

const JWT_SECRET = process.env.OPS_JWT_SECRET || "anna-ops-dev-secret";
const secret = new TextEncoder().encode(JWT_SECRET);

export interface OpsSession {
  userId: string;
  email: string;
  role: string;
  name: string;
}

export async function getOpsSession(): Promise<OpsSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("ops_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as OpsSession;
  } catch {
    return null;
  }
}

export async function createOpsToken(user: {
  id: string;
  email: string;
  role: string;
  name: string;
}): Promise<string> {
  return new SignJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("8h")
    .setIssuedAt()
    .sign(secret);
}

export async function clearOpsCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("ops_token");
}

const ROLE_HIERARCHY: Record<string, number> = {
  ADMIN: 3,
  COORDINATOR: 2,
  ANALYST: 1,
};

export function hasMinRole(userRole: string, requiredRole: string): boolean {
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
}