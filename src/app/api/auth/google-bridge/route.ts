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
    const url = process.env.NEXTAUTH_URL;
    if (!url.startsWith("http")) {
      return `https://${url}`;
    }
    return url;
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
  // 4. Last resort
  return new URL(request.url).origin;
}

/**
 * Determine the session cookie name exactly how NextAuth v4 does it.
 *
 * CRITICAL: NextAuth internally calls parseUrl() (next-auth/src/utils/parse-url.ts)
 * which auto-prepends https:// if the URL does NOT start with http:
 *
 *   if (url && !url.startsWith("http")) {
 *     url = `https://${url}`
 *   }
 *
 * Then in init.ts, useSecureCookies is determined by:
 *   authOptions.useSecureCookies ?? url.base.startsWith("https://")
 *
 * So when NEXTAUTH_URL is a bare domain like "annai-os-production.up.railway.app",
 * parseUrl rewrites it to "https://annai-os-production.up.railway.app", making
 * useSecureCookies = true, and the cookie name becomes
 * "__Secure-next-auth.session-token".
 *
 * The old code checked NEXTAUTH_URL?.startsWith("https://") directly,
 * which returned false for a bare domain — causing it to look for the wrong
 * cookie name ("next-auth.session-token" instead of
 * "__Secure-next-auth.session-token").
 */
function getNextAuthCookieName(): string {
  const rawUrl = process.env.NEXTAUTH_URL;
  let effectiveUrl = rawUrl;

  // Replicate parseUrl: if URL doesn't start with "http", prepend "https://"
  if (effectiveUrl && !effectiveUrl.startsWith("http")) {
    effectiveUrl = `https://${effectiveUrl}`;
  }

  // Same logic as init.ts: useSecureCookies
  const useSecureCookies =
    !!process.env.VERCEL || (effectiveUrl?.startsWith("https://") ?? false);

  return useSecureCookies
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
}

/**
 * Read the NextAuth session token from cookies, handling chunked cookies.
 *
 * NextAuth chunks session cookies into multiple cookies if the JWE token
 * exceeds ~3933 bytes. Chunked cookies are named like:
 *   __Secure-next-auth.session-token.0
 *   __Secure-next-auth.session-token.1
 *
 * We must collect all chunks and join them in order, matching the
 * SessionStore class in next-auth/src/core/lib/cookie.ts.
 */
function extractSessionToken(
  allCookies: { name: string; value: string }[],
  cookieName: string
): string | null {
  const chunks: { suffix: number; value: string }[] = [];

  for (const cookie of allCookies) {
    if (cookie.name === cookieName) {
      chunks.push({ suffix: -1, value: cookie.value });
    } else if (cookie.name.startsWith(cookieName + ".")) {
      const suffix = parseInt(cookie.name.split(".").pop() ?? "0", 10);
      chunks.push({ suffix, value: cookie.value });
    }
  }

  if (chunks.length === 0) return null;

  if (chunks.length === 1 && chunks[0].suffix === -1) {
    return chunks[0].value;
  }

  chunks.sort((a, b) => a.suffix - b.suffix);
  return chunks.map((c) => c.value).join("");
}

/**
 * Read and decrypt the NextAuth session token directly.
 *
 * Why not use getServerSession()? NextAuth v4's getServerSession() relies on
 * internal AuthHandler logic that can break in Next.js 16 App Router route
 * handlers (CJS require of next/headers, mismatched cookie handling, etc.).
 *
 * Instead we replicate exactly what next-auth/jwt does internally:
 *  1. Read the session cookie (name depends on HTTPS / VERCEL env)
 *  2. Derive an AES-256-GCM encryption key via HKDF-SHA256
 *  3. Decrypt the JWE token with jose's jwtDecrypt
 */
async function getNextAuthSession(request: Request): Promise<{
  email: string;
  name: string | null;
  picture: string | null;
} | null> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not configured");
  }

  const primaryCookieName = getNextAuthCookieName();
  const fallbackCookieName = primaryCookieName.startsWith("__Secure-")
    ? "next-auth.session-token"
    : "__Secure-next-auth.session-token";

  let allCookies: { name: string; value: string }[] = [];
  try {
    const cookieStore = await cookies();
    allCookies = cookieStore.getAll();
  } catch {
    const rawCookie = request.headers.get("cookie") || "";
    allCookies = rawCookie
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((pair) => {
        const eqIdx = pair.indexOf("=");
        if (eqIdx === -1) return { name: pair, value: "" };
        return {
          name: pair.substring(0, eqIdx).trim(),
          value: pair.substring(eqIdx + 1).trim(),
        };
      });
  }

  let token = extractSessionToken(allCookies, primaryCookieName);
  if (!token) {
    token = extractSessionToken(allCookies, fallbackCookieName);
  }

  if (!token) {
    console.error(
      `[google-bridge] No NextAuth session cookie found. ` +
        `Tried "${primaryCookieName}" and "${fallbackCookieName}". ` +
        `Available cookies:`,
      allCookies.map((c) => c.name)
    );
    return null;
  }

  const encryptionKey = await hkdf(
    "sha256",
    secret,
    "",
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
    const session = await getNextAuthSession(request);
    if (!session?.email) {
      return NextResponse.json(
        { error: "No Google session found" },
        { status: 401 }
      );
    }

    const googleEmail = session.email;
    const googleName = session.name || googleEmail.split("@")[0];

    let member = await db.familyMember.findUnique({
      where: { email: googleEmail },
      include: { household: true },
    });

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
      if (session.picture && session.picture !== member.avatarUrl) {
        await db.familyMember.update({
          where: { id: member.id },
          data: { avatarUrl: session.picture },
        });
      }
    }

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

export async function GET(request: Request) {
  return bridgeLogic(request);
}

export async function POST(request: Request) {
  return bridgeLogic(request);
}
