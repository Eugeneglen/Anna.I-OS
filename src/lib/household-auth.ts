import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { resolveSecret } from "@/lib/secrets";

// Lazy, memoized secret resolution. The secret is resolved on first USE
// (not at module import) so that `next build` — which evaluates route
// modules during page-data collection without deployment secrets — can
// import this module safely. Production still fails fast on the first
// request that actually needs the secret.
let _secretKey: Uint8Array | null = null;
function secretKey(): Uint8Array {
  if (!_secretKey) {
    _secretKey = new TextEncoder().encode(
      resolveSecret("HOUSEHOLD_JWT_SECRET", "anna-household-dev-secret", {
        owner: "household-auth",
      })
    );
  }
  return _secretKey;
}

export interface HouseholdSession {
  memberId: string;
  memberName: string;
  memberEmail: string;
  memberRole: string;
  householdId: string;
  householdName: string;
}

export async function getHouseholdSession(): Promise<HouseholdSession | null> {
  const key = secretKey(); // resolve BEFORE try — missing prod secret must fail loud, not silently return null
  const cookieStore = await cookies();
  const token = cookieStore.get("household_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    return payload as unknown as HouseholdSession;
  } catch {
    return null;
  }
}

export async function createHouseholdToken(member: {
  id: string;
  name: string;
  email: string;
  role: string;
  householdId: string;
  householdName: string;
}): Promise<string> {
  return new SignJWT({
    memberId: member.id,
    memberName: member.name,
    memberEmail: member.email,
    memberRole: member.role,
    householdId: member.householdId,
    householdName: member.householdName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(secretKey());
}

export async function verifyHouseholdToken(token: string): Promise<HouseholdSession | null> {
  const key = secretKey(); // resolve BEFORE try — missing prod secret must fail loud
  try {
    const { payload } = await jwtVerify(token, key);
    return payload as unknown as HouseholdSession;
  } catch {
    return null;
  }
}
