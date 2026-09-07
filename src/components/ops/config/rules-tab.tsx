"use client";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Camera, ShieldCheck } from "lucide-react";

/**
 * Ops Config → Rules tab (AUDIT-3 P2).
 *
 * Booking / operational rules that Ops can change WITHOUT a developer.
 * First surfaced rule: the vendor verification-photo completion gate
 * (`require_verification_photos` PlatformConfig key).
 *
 * The flag is read at runtime by BOTH vendor job-completion paths
 * (vendor booking update + j/share completion link) through
 * getRequireVerificationPhotos() — a cached reader (60s TTL) whose cache
 * is invalidated on save, so a toggle here changes what the completion
 * endpoints enforce within the same process.
 *
 * Before this tab existed the key had a runtime reader but NO write
 * path anywhere in the codebase — the gate was stuck at its compiled
 * default (true) forever, making it a developer-only setting in practice.
 */

interface RulesTabProps {
  /** Current effective value (read via the same cached reader the completion path uses). */
  requireVerificationPhotos: boolean;
  isAdmin: boolean;
  onToggleVerificationPhotos: (value: boolean) => void;
}

export function RulesTab({
  requireVerificationPhotos,
  isAdmin,
  onToggleVerificationPhotos,
}: RulesTabProps) {
  return (
    <div className="mt-4 space-y-4">
      {/* ── Verification photo completion gate ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-9 w-9 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center shrink-0">
              <Camera className="h-4.5 w-4.5 text-[var(--anna-sage-dark)]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Verification Photos Required
                </h3>
                <Badge
                  variant="secondary"
                  className={
                    requireVerificationPhotos
                      ? "text-[10px] bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                      : "text-[10px] bg-amber-100 text-amber-800"
                  }
                >
                  {requireVerificationPhotos ? "Enforced" : "Off — jobs complete without photos"}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--anna-muted)] mt-1 max-w-xl">
                When on, vendors must upload at least one completion photo before they can mark a
                job complete — enforced server-side on both the vendor portal and the shared
                completion link. Turning it off allows photo-free completion (use only for
                categories where verification is impractical).
              </p>
            </div>
          </div>
          <Switch
            checked={requireVerificationPhotos}
            onCheckedChange={(v) => {
              if (isAdmin) onToggleVerificationPhotos(v);
            }}
            disabled={!isAdmin}
            aria-label="Toggle verification photos requirement"
            className="shrink-0"
          />
        </div>
      </div>

      {/* Info note */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-4 text-xs text-[var(--anna-muted)]">
        <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p>
            <span className="font-semibold text-[var(--anna-slate)]">Rules propagate live:</span>{" "}
            these settings are stored in PlatformConfig and read through a 60-second cached reader
            by the enforcing endpoints — a change here takes effect on the next completion attempt,
            no deploy needed. Every change is written to the audit log.
          </p>
          {!isAdmin && (
            <p className="mt-1 text-amber-700">
              Read-only view — ADMIN role required to change operational rules.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
