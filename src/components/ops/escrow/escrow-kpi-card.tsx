"use client";

import { Clock, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSgd } from "@/lib/ops-format";

export const ESCROW_STYLES: Record<string, { bg: string; text: string; icon: typeof Clock }> = {
  HELD: { bg: "bg-amber-50", text: "text-amber-700", icon: Clock },
  RELEASED: { bg: "bg-emerald-50", text: "text-emerald-700", icon: CheckCircle2 },
  DISPUTED: { bg: "bg-red-50", text: "text-red-600", icon: AlertTriangle },
  REFUNDED: { bg: "bg-gray-100", text: "text-gray-600", icon: XCircle },
};

const KPI_STYLES: Record<string, { cardBg: string; iconBg: string; iconColor: string; amountColor: string }> = {
  HELD: { cardBg: "bg-amber-50/50", iconBg: "bg-amber-100", iconColor: "text-amber-600", amountColor: "text-amber-700" },
  RELEASED: { cardBg: "bg-emerald-50/50", iconBg: "bg-emerald-100", iconColor: "text-emerald-600", amountColor: "text-emerald-700" },
  DISPUTED: { cardBg: "bg-red-50/50", iconBg: "bg-red-100", iconColor: "text-red-600", amountColor: "text-red-700" },
  REFUNDED: { cardBg: "bg-gray-50/50", iconBg: "bg-gray-200", iconColor: "text-gray-500", amountColor: "text-gray-600" },
};

export function EscrowKpiCard({
  label,
  state,
  count,
  amountCents,
}: {
  label: string;
  state: string;
  count: number;
  amountCents: number;
}) {
  const style = KPI_STYLES[state] || KPI_STYLES.HELD;
  const Icon = ESCROW_STYLES[state]?.icon || Clock;

  return (
    <div className={cn("rounded-2xl border border-[var(--anna-border)] p-4", style.cardBg)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
          {label}
        </span>
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", style.iconBg)}>
          <Icon size={16} className={style.iconColor} />
        </div>
      </div>
      <p className={cn("text-lg font-bold font-data", style.amountColor)}>
        {formatSgd(amountCents)}
      </p>
      <p className="text-[10px] text-[var(--anna-muted)] mt-0.5 font-data">
        {count} {count === 1 ? "entry" : "entries"}
      </p>
    </div>
  );
}
