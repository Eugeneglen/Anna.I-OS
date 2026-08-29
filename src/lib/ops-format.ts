// ============================================================
// Anna.I — Ops Shared Formatting Utilities
// ============================================================
// Centralised formatters used across all Ops dashboard pages.
// Previously each page defined its own formatCents/formatSgd/formatDateTime
// copies — these are now the single source of truth.
// ============================================================

/**
 * Format SGD cents as `$1,234.50` (no currency prefix).
 * Used by households, anomalies, autonomy pages.
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format SGD cents as `SGD $1,234.50` (with currency prefix).
 * Used by escrow, subscriptions, config pages.
 */
export function formatSgd(cents: number): string {
  return `SGD $${(cents / 100).toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Alias for formatSgd — some pages called it formatPrice. */
export const formatPrice = formatSgd;

/**
 * Format an ISO date string as `DD Mon, HH:MM` (e.g. `05 Jul, 14:30`).
 * Returns `—` for null/empty values.
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format an ISO date string as `DD Mon YYYY` (e.g. `05 Jul 2024`).
 * Returns `—` for null/empty values.
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Human-friendly relative time (e.g. `just now`, `5m ago`, `3h ago`, `2d ago`).
 */
export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Parse a JSON column of category strings (Prisma stores arrays as JSON text in SQLite).
 * Returns `[]` on null/parse error.
 */
export function parseCategoryList(catsJson: string | null | undefined): string[] {
  if (!catsJson) return [];
  try {
    const parsed = JSON.parse(catsJson);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Pretty-print a category enum: `AIRCON` → `AIRCON` already readable, `PEST_CONTROL` → `PEST CONTROL`. */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ");
}

// ────────────────────────────────────────────────────────────
// Fix 21 — Timezone-aware date formatting
// ────────────────────────────────────────────────────────────
//
// The Anna.I app is Singapore-local, but ops users may create campaigns
// from any timezone (e.g. an admin travelling abroad). To display the
// intended "send at" wall-clock time correctly, we use Intl.DateTimeFormat
// with an explicit IANA timezone string instead of relying on the
// browser's local timezone (which is what `toLocaleString` does).
//
// All server-stored DateTime values are UTC (Prisma always persists them
// as ISO-8601 UTC). The frontend selects a display timezone (default
// "Asia/Singapore") and we format the UTC instant in that zone.

/**
 * Format a UTC ISO datetime string as a wall-clock time in the given
 * IANA timezone. Returns `—` for null/empty input.
 *
 * Example: `formatInTimezone("2025-01-15T06:30:00.000Z", "Asia/Singapore")`
 *   → "15 Jan 2025, 02:30 PM" (UTC+8)
 */
export function formatInTimezone(
  isoUtc: string | null | undefined,
  timezone: string | null | undefined,
): string {
  if (!isoUtc) return "—";
  const tz = timezone || "Asia/Singapore";
  try {
    return new Intl.DateTimeFormat("en-SG", {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(isoUtc));
  } catch {
    // Invalid timezone string — fall back to the browser-default
    // format so the UI doesn't crash. The stored data is untouched.
    return new Date(isoUtc).toLocaleString("en-SG");
  }
}

/**
 * Format a UTC ISO datetime string in the given timezone, returning just
 * the time portion (`02:30 PM`). Used for compact inline displays.
 */
export function formatTimeInTimezone(
  isoUtc: string | null | undefined,
  timezone: string | null | undefined,
): string {
  if (!isoUtc) return "—";
  const tz = timezone || "Asia/Singapore";
  try {
    return new Intl.DateTimeFormat("en-SG", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(isoUtc));
  } catch {
    return new Date(isoUtc).toLocaleTimeString("en-SG");
  }
}

/**
 * Convert a wall-clock datetime-local string ("YYYY-MM-DDTHH:mm") from
 * the browser into the equivalent UTC ISO string, interpreting the
 * wall-clock as belonging to the given IANA timezone.
 *
 * Used by the campaign create dialog: the ops user types a wall-clock
 * "send at" time in their chosen timezone; this function converts it to
 * the UTC instant the server should persist.
 *
 * Algorithm:
 *   1. Treat the wall-clock parts as UTC → guessUtcMs.
 *   2. Format guessUtcMs in the target tz → tz wall-clock parts.
 *   3. Treat those tz parts as UTC → tzUtcMs.
 *   4. offsetMs = tzUtcMs - guessUtcMs  (positive when tz is ahead of UTC).
 *   5. realUtcMs = guessUtcMs - offsetMs.
 *
 * Returns `null` if the input is empty or unparseable. The caller
 * should send `null` to the API (meaning "no scheduled send").
 */
export function wallClockToUtcIso(
  wallClock: string,
  timezone: string | null | undefined,
): string | null {
  if (!wallClock) return null;
  const tz = timezone || "Asia/Singapore";
  // Validate the tz upfront so Intl doesn't throw mid-conversion.
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return null;
  }

  // Accept either "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss".
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    wallClock,
  );
  if (!m) return null;
  const [, yStr, moStr, dStr, hStr, miStr, sStr] = m;
  const y = parseInt(yStr, 10);
  const mo = parseInt(moStr, 10) - 1;
  const d = parseInt(dStr, 10);
  const h = parseInt(hStr, 10);
  const mi = parseInt(miStr, 10);
  const s = sStr ? parseInt(sStr, 10) : 0;

  // 1. Pretend the wall-clock is UTC.
  const guessUtcMs = Date.UTC(y, mo, d, h, mi, s);
  if (Number.isNaN(guessUtcMs)) return null;

  // 2. Format guessUtcMs in tz to find the actual tz wall-clock parts.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(guessUtcMs));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const tzUtcMs = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    // Intl can produce "24" at midnight in some hosts — normalise to 0..23.
    parseInt(map.hour, 10) % 24,
    parseInt(map.minute, 10),
    parseInt(map.second, 10),
  );
  if (Number.isNaN(tzUtcMs)) return null;

  // 3. Real UTC instant = guess - offset.
  const offsetMs = tzUtcMs - guessUtcMs;
  const realUtcMs = guessUtcMs - offsetMs;
  return new Date(realUtcMs).toISOString();
}

/**
 * Human-readable timezone label for display: `Asia/Singapore` → `SGT`.
 * Falls back to the raw IANA name when the zone is unusual, so we never
 * show "—" for a real timezone.
 *
 * Note: this is a presentation hint only — we don't compute the offset
 * here (would need an instant reference). For the canonical display,
 * pair with `formatInTimezone` which already includes the time.
 */
export function timezoneLabel(timezone: string | null | undefined): string {
  const tz = timezone || "Asia/Singapore";
  const common: Record<string, string> = {
    "Asia/Singapore": "SGT",
    "Asia/Kuala_Lumpur": "MYT",
    "Asia/Tokyo": "JST",
    "Asia/Hong_Kong": "HKT",
    "Asia/Shanghai": "CST",
    "Asia/Bangkok": "ICT",
    "Asia/Jakarta": "WIB",
    "Asia/Kolkata": "IST",
    "Australia/Sydney": "AEST",
    "UTC": "UTC",
    "Europe/London": "GMT/BST",
    "America/New_York": "EST/EDT",
    "America/Los_Angeles": "PST/PDT",
  };
  return common[tz] || tz;
}
