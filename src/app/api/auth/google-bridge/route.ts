import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtDecrypt } from "jose";
import hkdf from "@panva/hkdf";
import { db } from "@/lib/db";
import { createHouseholdToken } from "@/lib/household-auth";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Get the public-facing origin URL for redirects.
 * On Railway, request.url resolves to http://0.0.0.0:8080 which is unreachable by the browser.
 * We use NEXTAUTH_URL or forwarded headers to get the correct public origin.
 */
function getPublicOrigin(request: Request): string {
  // 1. Explicit env var (most reliable for Railway/production)
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }
  // 2. Proxy-forwarded headers (Railway sets these)
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${forwardedHost}`;
  }
  // 3. Direct host header (local dev)
  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") || "http";
    return `${proto}://${host}`;
  }
  // 4. Last resort — same behavior as before
  return new URL(request.url).origin;
}

/**
 * Read and decrypt the NextAuth session token directly.
 *
 * Why not use getServerSession()? NextAuth v4's getServerSession() relies on
 * internal `AuthHandler` logic that can break in Next.js 16 App Router route
 * handlers (CJS require of next/headers, mismatched cookie handling, etc.).
 *
 * Instead we replicate exactly what next-auth/jwt does internally:
 *  1. Read the session cookie (name depends on HTTPS / VERCEL env)
 *  2. Derive an AES-256-GCM encryption key via HKDF-SHA256
 *  3. Decrypt the JWE token with jose's jwtDecrypt
 */
async function getNextAuthSession(): Promise<{
  email: string;
  name: string | null;
  picture: string | null;
  _debug?: { availableCookies: string[]; nextauthUrl: string };
} | null> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not configured");
  }

  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  const cookieNames = allCookies.map((c) => c.name);

  // NextAuth uses different cookie names depending on env:
  //   - HTTPS + NEXTAUTH_URL  → __Secure-next-auth.session-token
  //   - HTTP / local dev     → next-auth.session-token
  // Try all candidates to avoid name mismatches on Railway's SSL termination.
  const CANDIDATES = [
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
    "next-auth.session-token.0",   // large token split variant
    "__Secure-next-auth.session-token.0",
  ];

  let token: string | undefined;
  let usedName: string | undefined;
  for (const name of CANDIDATES) {
    token = allCookies.find((c) => c.name === name)?.value;
    if (token) {
      usedName = name;
      break;
    }
  }

  if (!token) {
    console.error(
      `[google-bridge] No NextAuth session cookie found. Available cookies:`,
      cookieNames,
      `NEXTAUTH_URL=${process.env.NEXTAUTH_URL ?? "<not set>"}`
    );
    // Return diagnostic info in the response for debugging
    return {
      email: "",
      name: null,
      picture: null,
      _debug: {
        availableCookies: cookieNames,
        nextauthUrl: process.env.NEXTAUTH_URL ?? "<not set>",
      },
    };
  }

  console.log(`[google-bridge] Found session cookie: ${usedName}`);

  // Derive encryption key the same way next-auth/jwt encode() does
  const encryptionKey = await hkdf(
    "sha256",
    secret,
    "", // salt (empty string = default)
    "NextAuth.js Generated Encryption Key",
    32
  );

  const { payload } = await jwtDecrypt(token, encryptionKey, {
    clockTolerance: 15,
  });

  return {
    email: (payload.email as string) || (payload.sub as string) || "",
    name: (payload.name as string) || null,
    picture: (payload.picture as string) || null,
  };
}

async function bridgeLogic(request: Request) {
  try {
    // Step 1: Decrypt the NextAuth session token
    const session = await getNextAuthSession();
    if (!session?.email) {
      // Include debug info if available (cookie name mismatch diagnostics)
      const debug = (session as any)?._debug;
      return NextResponse.json(
        { error: "No Google session found", debug: debug ?? undefined },
        { status: 401 }
      );
    }

    const googleEmail = session.email;
    const googleName = session.name || googleEmail.split("@")[0];

    // Step 2: Look up existing member by email
    let member = await db.familyMember.findUnique({
      where: { email: googleEmail },
      include: { household: true },
    });

    // Step 3: If no member exists, create Household + Member + Subscription
    if (!member) {
      const householdName = `${googleName.split(" ")[0]}'s Home`;

      const result = await db.$transaction(async (tx) => {
        const household = await tx.household.create({
          data: {
            name: householdName,
            fullName: googleName,
            email: googleEmail,
            address: "",
            activeCategories: "[]",
            preferences: {},
          },
        });

        await tx.subscription.create({
          data: {
            householdId: household.id,
            tier: "HOME",
            status: "ACTIVE",
            priceCents: 800,
            billingCycleStart: new Date(),
            nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });

        const newMember = await tx.familyMember.create({
          data: {
            householdId: household.id,
            name: googleName,
            email: googleEmail,
            role: "OWNER",
            avatarUrl: session.picture || null,
          },
        });

        return { household, member: newMember };
      });

      member = result.member as typeof member & {
        household: typeof result.household;
      };

      if (!member.household.fullName) {
        await db.household.update({
          where: { id: member.householdId },
          data: { fullName: googleName },
        });
      }
    } else {
      // Update avatar if it changed
      if (session.picture && session.picture !== member.avatarUrl) {
        await db.familyMember.update({
          where: { id: member.id },
          data: { avatarUrl: session.picture },
        });
      }
    }

    // Step 4: Create our custom JWT cookie
    const token = await createHouseholdToken({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      householdId: member.householdId,
      householdName: member.household.name,
    });

    const res = NextResponse.json({
      success: true,
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        householdId: member.householdId,
        householdName: member.household.name,
        onboardingStep: member.household.onboardingStep,
      },
      isNewUser: !member.passwordHash,
    });

    res.cookies.set("household_token", token, {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 3600,
    });

    // Step 5: Sign out of NextAuth session (we use our custom JWT going forward)
    const publicOrigin = getPublicOrigin(request);
    const signOutUrl = new URL("/api/auth/signout", publicOrigin);
    signOutUrl.searchParams.set("callbackUrl", "/");
    res.headers.set("Location", signOutUrl.toString());

    return new NextResponse(null, {
      status: 302,
      headers: res.headers,
    });
  } catch (error) {
    console.error("[google-bridge] Error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Google sign-in failed", debug: msg },
      { status: 500 }
    );
  }
}

// GET: Google OAuth redirects browser here via callbackUrl (browser redirect = GET)
export async function GET(request: Request) {
  return bridgeLogic(request);
}

export async function POST(request: Request) {
  return bridgeLogic(request);
}
