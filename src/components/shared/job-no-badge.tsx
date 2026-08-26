"use client";

import { useState } from "react";
import { Copy, Check, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Anna.I — Job Number Badge (copyable)
// ============================================================
// Displays a human-readable job number (e.g. "AI-00000001") with
// a copy-to-clipboard button. Used across household, vendor, and
// ops portals so all parties can reference jobs by the same number.
// ============================================================

interface JobNoBadgeProps {
  jobNo: string | null | undefined;
  /** Size variant — sm for compact tables, md for detail headers */
  size?: "sm" | "md";
  /** Show the leading "#" symbol (default true) */
  showHash?: boolean;
  className?: string;
}

export function JobNoBadge({
  jobNo,
  size = "sm",
  showHash = true,
  className,
}: JobNoBadgeProps) {
  const [copied, setCopied] = useState(false);

  if (!jobNo) {
    return null;
  }

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(jobNo!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — fail silently
    }
  }

  const display = showHash ? `#${jobNo}` : jobNo;
  const isMd = size === "md";

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy job number: ${display}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-[var(--anna-border)] bg-[var(--anna-bg)] font-mono text-[var(--anna-slate-light)] hover:border-[var(--anna-sage)]/40 hover:bg-[var(--anna-sage-light)]/40 transition-colors",
        isMd ? "px-2 py-1 text-xs" : "px-1.5 py-0.5 text-[10px]",
        className
      )}
    >
      <Hash size={isMd ? 11 : 9} className="text-[var(--anna-muted)] shrink-0" />
      <span className="font-medium tracking-wide">{display}</span>
      {copied ? (
        <Check size={isMd ? 12 : 10} className="text-emerald-600 shrink-0" />
      ) : (
        <Copy size={isMd ? 11 : 9} className="text-[var(--anna-muted)] hover:text-[var(--anna-slate)] shrink-0" />
      )}
    </button>
  );
}
