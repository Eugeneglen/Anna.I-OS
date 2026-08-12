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
