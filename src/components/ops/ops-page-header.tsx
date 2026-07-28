"use client";

import { ReactNode } from "react";

// ============================================================
// Anna.I — Ops Page Header
// ============================================================
// Reusable header for every Ops dashboard page.
// Renders title, subtitle (optional count), and an actions slot
// (search, filter buttons, primary actions).
// ============================================================

interface OpsPageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function OpsPageHeader({ title, subtitle, actions }: OpsPageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-wrap">{actions}</div>
      )}
    </div>
  );
}

// ── Search input variant ──

interface OpsSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function OpsSearchInput({
  value,
  onChange,
  placeholder = "Search...",
  className = "w-64",
}: OpsSearchInputProps) {
  return (
    <div className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${className} pl-9 h-9 rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] text-sm text-[var(--anna-slate)] placeholder:text-[var(--anna-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--anna-sage)]/30 focus:border-transparent transition`}
      />
    </div>
  );
}
