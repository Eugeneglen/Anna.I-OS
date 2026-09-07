import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getHouseholdSession } from "@/lib/household-auth";
import { getVendorSession } from "@/lib/vendor-auth";
import { getOpsSession } from "@/lib/ops-auth";
import { checkRateLimit } from "@/lib/rate-limit";

// GET /api/events/token
//
// FIX-1b — short-lived realtime event token.
//
// The ops-events socket.io service authenticates every websocket
// handshake. Primary mechanism: the portal session cookie
// (household_token / vendor_token / ops_token), which the browser
// forwards on the same-origin handshake through the Caddy gateway
// (/?XTransformPort=3004). This route is the FALLBACK: it issues a
// 5-minute JWT signed with the caller's OWN portal secret so a client
// whose cookies were unavailable on the handshake can still connect
// via the socket.io `auth.token` option.
//
//   • The token only ever carries the identity ALREADY verified by the
//     session check — nothing client-supplied can influence the payload.
//   • Classification on the service is bound to the signing secret, so
//     a household-signed token can never act as a vendor/ops token.
//   • 30 tokens / minute per identity is far above any legit reconnect
//     cadence while capping runaway loops.

const TOKEN_TTL_SEC = 300; // 5 minutes

const HOUSEHOLD_JWT_SECRET = process.env.HOUSEHOLD_JWT_SECRET || "anna-household-dev-secret";
const VENDOR_JWT_SECRET = process.env.VENDOR_JWT_SECRET || "anna-vendor-dev-secret";
const OPS_JWT_SECRET = process.env.OPS_JWT_SECRET || "anna-ops-dev-secret";

const householdSecret = new TextEncoder().encode(HOUSEHOLD_JWT_SECRET);
const vendorSecret = new TextEncoder().encode(VENDOR_JWT_SECRET);
const opsSecret = new TextEncoder().encode(OPS_JWT_SECRET);

export async function GET() {
  try {
    // Resolve whichever portal session is present (household first,
    // then vendor, then ops) and sign with the matching portal secret.
    const household = await getHouseholdSession();
    if (household) {
      if (!checkRateLimit(`events-token:household:${household.householdId}`, 30, 60_000)) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
      }
      const token = await new SignJWT({
        role: "household",
        householdId: household.householdId,
        memberId: household.memberId,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${TOKEN_TTL_SEC}s`)
        .sign(householdSecret);
      return NextResponse.json({ token, role: "household", expiresInSec: TOKEN_TTL_SEC });
    }

    const vendor = await getVendorSession();
    if (vendor) {
      if (!checkRateLimit(`events-token:vendor:${vendor.vendorId}`, 30, 60_000)) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
      }
      const token = await new SignJWT({
        role: "vendor",
        vendorId: vendor.vendorId,
        ...(vendor.userId ? { userId: vendor.userId } : {}),
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${TOKEN_TTL_SEC}s`)
        .sign(vendorSecret);
      return NextResponse.json({ token, role: "vendor", expiresInSec: TOKEN_TTL_SEC });
    }

    const ops = await getOpsSession();
    if (ops) {
      if (!checkRateLimit(`events-token:ops:${ops.userId}`, 30, 60_000)) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
      }
      const token = await new SignJWT({
        role: "ops",
        userId: ops.userId,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${TOKEN_TTL_SEC}s`)
        .sign(opsSecret);
      return NextResponse.json({ token, role: "ops", expiresInSec: TOKEN_TTL_SEC });
    }

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } catch (error) {
    console.error("[/api/events/token GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
