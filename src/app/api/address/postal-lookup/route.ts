import { NextRequest, NextResponse } from "next/server";

// ============================================================
// OneMap Postal Code Lookup API
// GET /api/address/postal-lookup?code=123456
// Uses Singapore OneMap API with 5-minute in-memory cache
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

// Simple in-memory cache with 5-minute TTL
const cache = new Map<string, CachedEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

    // Check cache first
    const cached = cache.get(normalizedCode);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return NextResponse.json({ found: cached.results.length > 0, results: cached.results });
    }

    // Fetch from OneMap
    const url = `https://www.onemap.gov.sg/api/common/elite/search?searchval=${normalizedCode}&returngeom=Y&getaddrdetails=Y&page=1`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      console.error("[postal-lookup] OneMap API returned", response.status);
      return NextResponse.json({
        found: false,
        error: "Lookup service unavailable",
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

    // If OneMap is unreachable, return graceful error
    return NextResponse.json({
      found: false,
      error: "Lookup service unavailable",
    });
  }
}
