import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

const JWT_SECRET = process.env.HOUSEHOLD_JWT_SECRET || "anna-household-dev-secret";
const secret = new TextEncoder().encode(JWT_SECRET);

export interface HouseholdSession {
  memberId: string;
  memberName: string;
  memberEmail: string;
  memberRole: string;
  householdId: string;
  householdName: string;
}

export async function getHouseholdSession(): Promise<HouseholdSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("household_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
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
    .sign(secret);
}

export async function verifyHouseholdToken(token: string): Promise<HouseholdSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as HouseholdSession;
  } catch {
    return null;
  }
}
