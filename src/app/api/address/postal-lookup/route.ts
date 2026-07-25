import { NextRequest, NextResponse } from "next/server";

// ============================================================
// OneMap Postal Code Lookup API
// GET /api/address/postal-lookup?code=123456
// Uses Singapore OneMap API with auth token + 5-min result cache
// Requires ONEMAP_EMAIL and ONEMAP_PASSWORD env vars for auth
// ============================================================

interface OneMapResult {
  SEARCHVAL: string;
  BLK_NO: string;
  ROAD_NAME: string;
  BUILDING: string;
  ADDRESS: string;
  POSTAL: string;
  X: string; // longitude
  Y: string; // latitude
  LATITUDE: string;
  LONGITUDE: string;
}

interface CachedEntry {
  results: Array<{
    blk_no: string;
    road_name: string;
    building: string;
    address: string;
    postal: string;
    lat: number;
    lon: number;
  }>;
  cachedAt: number;
}

// ─── OneMap Token Management ──────────────────────────────

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getOneMapToken(): Promise<string | null> {
  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;

  if (!email || !password) {
    console.warn("[postal-lookup] ONEMAP_EMAIL or ONEMAP_PASSWORD not set");
    return null;
  }

  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < tokenExpiry - 60_000) {
    return cachedToken;
  }

  try {
    const res = await fetch("https://www.onemap.gov.sg/api/auth/post-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error("[postal-lookup] Auth failed:", res.status);
      return null;
    }

    const data = await res.json();
    if (!data.access_token) {
      console.error("[postal-lookup] No access_token in response");
      return null;
    }

    cachedToken = data.access_token;
    // OneMap tokens typically expire in 24h; parse expiry if available
    const expiry = data.expiry_timestamp
      ? parseInt(data.expiry_timestamp, 10) * 1000
      : Date.now() + 24 * 60 * 60 * 1000;
    tokenExpiry = expiry;

    console.log("[postal-lookup] Token obtained, expires at", new Date(tokenExpiry).toISOString());
    return cachedToken;
  } catch (error) {
    console.error("[postal-lookup] Token fetch error:", error);
    return null;
  }
}

// ─── Result Cache ─────────────────────────────────────────

const cache = new Map<string, CachedEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Main Handler ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json(
        { found: false, error: "Postal code is required (query param: code)" },
        { status: 400 }
      );
    }

    const normalizedCode = code.replace(/\s/g, "");

    if (!/^\d{6}$/.test(normalizedCode)) {
      return NextResponse.json(
        { found: false, error: "Invalid postal code format. Must be 6 digits." },
        { status: 400 }
      );
    }

    // Check result cache first
    const cached = cache.get(normalizedCode);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return NextResponse.json({ found: cached.results.length > 0, results: cached.results });
    }

    // Get OneMap auth token
    const token = await getOneMapToken();
    if (!token) {
      return NextResponse.json({
        found: false,
        error: "Address lookup unavailable. Please enter your address manually.",
      });
    }

    // Fetch from OneMap with auth token
    const url = `https://www.onemap.gov.sg/api/common/elite/search?searchval=${normalizedCode}&returngeom=Y&getaddrdetails=Y&page=1`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error("[postal-lookup] OneMap API returned", response.status);
      // If 401/403, the token may have expired — clear it for next request
      if (response.status === 401 || response.status === 403) {
        cachedToken = null;
        tokenExpiry = 0;
      }
      return NextResponse.json({
        found: false,
        error: "Lookup service unavailable. Please enter manually.",
      });
    }

    const data = await response.json();

    if (!data.results || !Array.isArray(data.results)) {
      return NextResponse.json({ found: false, results: [] });
    }

    const results = data.results.map((r: OneMapResult) => ({
      blk_no: r.BLK_NO || "",
      road_name: r.ROAD_NAME || "",
      building: r.BUILDING || "",
      address: r.ADDRESS || "",
      postal: r.POSTAL || "",
      lat: parseFloat(r.LATITUDE) || parseFloat(r.Y) || 0,
      lon: parseFloat(r.LONGITUDE) || parseFloat(r.X) || 0,
    }));

    // Store in cache
    cache.set(normalizedCode, { results, cachedAt: Date.now() });

    return NextResponse.json({ found: results.length > 0, results });
  } catch (error) {
    console.error("[postal-lookup] Error:", error);

    return NextResponse.json({
      found: false,
      error: "Lookup service unavailable. Please enter manually.",
    });
  }
}
