/**
 * Server-side guard for vendor API routes under /api/vendors/[id]/
 * Prevents Insecure Direct Object Reference (IDOR) by verifying
 * that the authenticated vendor session matches the requested vendorId.
 */
import { NextResponse } from "next/server";
import { getVendorSession } from "@/lib/vendor-auth";

export interface VendorOwnershipResult {
  success: true;
  vendorId: string;
}

export interface VendorOwnershipError {
  success: false;
  response: NextResponse;
}

/**
 * Validates that the currently authenticated vendor (from JWT cookie)
 * matches the vendorId supplied in the URL path.
 *
 * Usage:
 *   const auth = await requireVendorOwnership(id);
 *   if (!auth.success) return auth.response;
 *   // auth.vendorId is safe to use
 */
export async function requireVendorOwnership(
  urlVendorId: string
): Promise<VendorOwnershipResult | VendorOwnershipError> {
  const session = await getVendorSession();

  if (!session) {
    return {
      success: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (session.vendorId !== urlVendorId) {
    return {
      success: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { success: true, vendorId: session.vendorId };
}

/**
 * Returns a NextResponse with X-Vendor-Id header set.
 * Use this in all vendor API routes so the frontend can detect
 * cookie-overwrite / session-switch issues.
 */
export function vendorJson(
  data: unknown,
  vendorId: string,
  init?: { status?: number; headers?: Record<string, string> }
): NextResponse {
  return new NextResponse(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      "X-Vendor-Id": vendorId,
      ...(init?.headers ?? {}),
    },
  });
}
