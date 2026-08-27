"use client";

import { useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users,
  MapPin,
  Mail,
  Phone,
  Clock,
  Star,
  Zap,
  Wallet,
  ShieldAlert,
  CheckCircle2,
  ArrowDownLeft,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AUTONOMY_LEVEL_NAMES } from "@/lib/constants";
import { formatCents, formatDateTime } from "@/lib/ops-format";
import { SUBSCRIPTION_STYLES } from "./households-styles";
import { HouseholdIntelligencePanel } from "./household-intelligence-panel";
import { DownloadButton } from "./download-button";

// ============================================================
// Anna.I — Ops Household Detail Sheet
// ============================================================
// Slide-in panel showing contact info, subscription, members,
// autonomy levels, escrow summary (aggregated from task escrow
// entries), and recent tasks. Owns the TASK_STATUS_STYLES map.
// ============================================================

const TASK_STATUS_STYLES: Record<string, string> = {
  CREATED: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)]",
  PREDICTED: "bg-violet-50 text-violet-700",
  MATCHING: "bg-sky-50 text-sky-700",
  ACCEPTED: "bg-emerald-50 text-emerald-700",
  SCHEDULED: "bg-amber-50 text-amber-700",
  IN_PROGRESS: "bg-purple-50 text-purple-700",
  COMPLETED: "bg-[var(--anna-success)]/15 text-[var(--anna-success)]",
  VERIFIED: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]",
  ESCROW_RELEASED: "bg-emerald-50 text-emerald-700",
  DISPUTED: "bg-red-50 text-red-700",
};

interface HouseholdDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: Record<string, unknown> | null;
  householdName?: string;
  isLoading: boolean;
  selectedId?: string;
}

// ── Escrow aggregation helper ──

interface EscrowAggregate {
  held: number;
  released: number;
  disputed: number;
  refunded: number;
}

function aggregateEscrow(tasks: Record<string, unknown>[]): EscrowAggregate {
  const agg: EscrowAggregate = { held: 0, released: 0, disputed: 0, refunded: 0 };
  for (const t of tasks) {
    const entries = (t.escrowEntries as Record<string, unknown>[]) || [];
    for (const e of entries) {
      const state = e.state as string;
      const amt = (e.amountCents as number) || 0;
      if (state === "HELD") agg.held += amt;
      else if (state === "RELEASED") agg.released += amt;
      else if (state === "DISPUTED") agg.disputed += amt;
      else if (state === "REFUNDED") agg.refunded += amt;
    }
  }
  return agg;
}

export function HouseholdDetailSheet({
  open,
  onOpenChange,
  detail,
  householdName,
  isLoading,
  selectedId,
}: HouseholdDetailSheetProps) {
  const queryClient = useQueryClient();
  const members = (detail?.members || []) as Record<string, unknown>[];
  const tasks = (detail?.tasks || []) as Record<string, unknown>[];
  const subscriptions = (detail?.subscriptions || []) as Record<string, unknown>[];
  const categoryAutonomy = (detail?.categoryAutonomy || []) as Record<string, unknown>[];
  const householdInfo = (detail?.household || {}) as Record<string, unknown>;

  // ── Edit mode state ──
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    fullName: "",
    phone: "",
    address: "",
    postalCode: "",
    unitNumber: "",
  });

  // Wrap onOpenChange to reset edit state on close
  const handleSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setIsEditing(false);
        setEditForm({
          name: "",
          fullName: "",
          phone: "",
          address: "",
          postalCode: "",
          unitNumber: "",
        });
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  // Sync form values from household data
  const startEditing = useCallback(() => {
    setEditForm({
      name: (householdInfo.name as string) || "",
      fullName: (householdInfo.fullName as string) || "",
      phone: (householdInfo.phone as string) || "",
      address: (householdInfo.address as string) || "",
      postalCode: (householdInfo.postalCode as string) || "",
      unitNumber: (householdInfo.unitNumber as string) || "",
    });
    setIsEditing(true);
  }, [householdInfo]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditForm({
      name: "",
      fullName: "",
      phone: "",
      address: "",
      postalCode: "",
      unitNumber: "",
    });
  }, []);

  // ── Save mutation ──
  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const householdId = householdInfo.id as string;
      const res = await fetch(`/api/ops/households/${householdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setIsEditing(false);
      toast.success("Household updated successfully");
      queryClient.invalidateQueries({ queryKey: ["ops-households"] });
      if (selectedId) {
        queryClient.invalidateQueries({ queryKey: ["ops-household-detail", selectedId] });
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to save changes");
    },
  });

  const handleSave = useCallback(() => {
    // Build payload with only changed fields
    const changed: Record<string, unknown> = {};
    if (editForm.name !== ((householdInfo.name as string) || "")) changed.name = editForm.name;
    if (editForm.fullName !== ((householdInfo.fullName as string) || "")) changed.fullName = editForm.fullName;
    if (editForm.phone !== ((householdInfo.phone as string) || "")) changed.phone = editForm.phone;
    if (editForm.address !== ((householdInfo.address as string) || "")) changed.address = editForm.address;
    if (editForm.postalCode !== ((householdInfo.postalCode as string) || "")) changed.postalCode = editForm.postalCode;
    if (editForm.unitNumber !== ((householdInfo.unitNumber as string) || "")) changed.unitNumber = editForm.unitNumber;

    if (Object.keys(changed).length > 0) {
      saveMutation.mutate(changed);
    } else {
      setIsEditing(false);
    }
  }, [editForm, householdInfo, saveMutation]);

  // Escrow summary — only render if at least one task has escrow entries
  const hasEscrow = tasks.some((t) => {
    const entries = t.escrowEntries as Record<string, unknown>[] | undefined;
    return entries && entries.length > 0;
  });
  const escrowAgg = hasEscrow ? aggregateEscrow(tasks) : null;
  const totalEscrow = escrowAgg
    ? escrowAgg.held + escrowAgg.released + escrowAgg.disputed + escrowAgg.refunded
    : 0;
  const showEscrow = escrowAgg !== null && totalEscrow > 0;

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto bg-[var(--anna-white)] anna-scroll">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-6 w-48 bg-[var(--anna-border)]" />
            <Skeleton className="h-4 w-32 bg-[var(--anna-border)]" />
            <Skeleton className="h-32 w-full rounded-2xl bg-[var(--anna-border)]" />
            <Skeleton className="h-40 w-full rounded-2xl bg-[var(--anna-border)]" />
          </div>
        ) : detail ? (
          <div className="p-6 space-y-5">
            <SheetHeader className="flex-row items-center justify-between">
              <SheetTitle className="text-[var(--anna-slate)]">{householdName}</SheetTitle>
              {isEditing ? (
                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={cancelEditing}
                  >
                    <X size={14} className="mr-1" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl"
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                  >
                    <Save size={14} className="mr-1" />
                    {saveMutation.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 ml-auto">
                  <DownloadButton householdId={householdInfo.id as string} />
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl border-[var(--anna-border)]"
                    onClick={startEditing}
                  >
                    <Pencil size={14} className="mr-1" />
                    Edit
                  </Button>
                </div>
              )}
            </SheetHeader>

            {/* Contact Info */}
            <div className="space-y-2 text-sm">
              {isEditing ? (
                <div className="space-y-3 p-3 rounded-2xl bg-[var(--anna-bg)]">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
                      <Mail size={12} />Name
                    </label>
                    <Input
                      className="rounded-xl border-[var(--anna-border)] h-9 text-sm w-full"
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Household name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
                      <Mail size={12} />Full Name
                    </label>
                    <Input
                      className="rounded-xl border-[var(--anna-border)] h-9 text-sm w-full"
                      value={editForm.fullName}
                      onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))}
                      placeholder="Full name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
                      <Phone size={12} />Phone
                    </label>
                    <Input
                      className="rounded-xl border-[var(--anna-border)] h-9 text-sm w-full"
                      value={editForm.phone}
                      onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="Phone number"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
                      <MapPin size={12} />Address
                    </label>
                    <Input
                      className="rounded-xl border-[var(--anna-border)] h-9 text-sm w-full"
                      value={editForm.address}
                      onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                      placeholder="Street address"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                        Postal Code
                      </label>
                      <Input
                        className="rounded-xl border-[var(--anna-border)] h-9 text-sm w-full"
                        value={editForm.postalCode}
                        onChange={(e) => setEditForm((f) => ({ ...f, postalCode: e.target.value }))}
                        placeholder="Postal code"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                        Unit Number
                      </label>
                      <Input
                        className="rounded-xl border-[var(--anna-border)] h-9 text-sm w-full"
                        value={editForm.unitNumber}
                        onChange={(e) => setEditForm((f) => ({ ...f, unitNumber: e.target.value }))}
                        placeholder="Unit #"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-[var(--anna-slate)]">
                    <Users size={14} className="text-[var(--anna-muted)]" />
                    <span className="font-medium">{householdInfo.name as string}</span>
                  </div>
                  {(householdInfo.fullName as string) && householdInfo.fullName !== householdInfo.name && (
                    <div className="flex items-center gap-2 text-[var(--anna-slate-light)]">
                      <Users size={14} className="text-[var(--anna-muted)] opacity-0" />
                      <span>{householdInfo.fullName as string}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-[var(--anna-slate-light)]">
                    <Mail size={14} className="text-[var(--anna-muted)]" />
                    {householdInfo.email as string}
                  </div>
                  <div className="flex items-center gap-2 text-[var(--anna-slate-light)]">
                    <Phone size={14} className="text-[var(--anna-muted)]" />
                    {(householdInfo.phone as string) || "—"}
                  </div>
                  <div className="flex items-start gap-2 text-[var(--anna-slate-light)]">
                    <MapPin size={14} className="text-[var(--anna-muted)] mt-0.5 shrink-0" />
                    <span>
                      {(householdInfo.address as string) || "—"}
                      {householdInfo.postalCode ? (
                        <span className="font-data text-[var(--anna-muted)]"> · {householdInfo.postalCode as string}</span>
                      ) : null}
                      {householdInfo.unitNumber ? (
                        <span className="font-data text-[var(--anna-muted)]"> #{householdInfo.unitNumber as string}</span>
                      ) : null}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Subscription */}
            <div className="bg-[var(--anna-bg)] rounded-2xl p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Subscription</p>
              {subscriptions.length > 0 ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className={cn("text-[10px] font-medium", SUBSCRIPTION_STYLES[(subscriptions[0] as Record<string, unknown>).tier as string] || SUBSCRIPTION_STYLES["HOME"])}>
                    {(subscriptions[0] as Record<string, unknown>).tier as string}
                  </Badge>
                  <Badge variant="secondary" className={cn("text-[10px] font-medium", (subscriptions[0] as Record<string, unknown>).status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : SUBSCRIPTION_STYLES[(subscriptions[0] as Record<string, unknown>).status as string] || "")}>
                    {(subscriptions[0] as Record<string, unknown>).status as string}
                  </Badge>
                </div>
              ) : (
                <p className="text-xs text-[var(--anna-muted)]">No subscription</p>
              )}
            </div>

            {/* Members */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
                <Users size={12} className="inline mr-1" />Members · {members.length}
              </p>
              <div className="space-y-1.5">
                {members.map((m: Record<string, unknown>) => (
                  <div key={m.id as string} className="flex items-center justify-between py-2 px-3 rounded-xl bg-[var(--anna-bg)]">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-[var(--anna-sage-light)] flex items-center justify-center text-[10px] font-medium text-[var(--anna-sage-dark)]">
                        {(m.name as string)?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-[var(--anna-slate)]">{m.name as string}</p>
                        <p className="text-[10px] text-[var(--anna-muted)]">{m.email as string}</p>
                        {m.phone && (
                          <p className="text-[10px] text-[var(--anna-muted)]">{m.phone as string}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("text-[10px]", m.role === "OWNER" ? "border-[var(--anna-sage)]/30 text-[var(--anna-sage-dark)]" : "border-[var(--anna-border)] text-[var(--anna-muted)]")}>
                      {m.role as string}
                    </Badge>
                  </div>
                ))}
                {members.length === 0 && (
                  <p className="text-xs text-[var(--anna-muted)] py-2">No members</p>
                )}
              </div>
            </div>

            {/* Household Intelligence Panel (onboarding profile) */}
            <HouseholdIntelligencePanel
              onboardingProfile={householdInfo.onboardingProfile as Record<string, unknown> | null}
              acquisitionSource={(householdInfo.acquisitionSource as string) || null}
              acquisitionCampaignId={(householdInfo.acquisitionCampaignId as string) || null}
              onboardingCompletedAt={(householdInfo.onboardingCompletedAt as string) || null}
              updatedAt={(householdInfo.updatedAt as string) || null}
            />

            {/* Autonomy Levels */}
            {categoryAutonomy.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
                  <Zap size={12} className="inline mr-1" />Autonomy Levels
                </p>
                <div className="space-y-1.5">
                  {categoryAutonomy.map((a: Record<string, unknown>) => (
                    <div key={a.id as string} className="flex items-center justify-between py-2 px-3 rounded-xl bg-[var(--anna-bg)]">
                      <span className="text-xs text-[var(--anna-slate-light)]">{(a.category as string)?.replace(/_/g, " ")}</span>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <div
                              key={i}
                              className={cn(
                                "w-1.5 h-4 rounded-full",
                                i < (a.currentLevel as number)
                                  ? "bg-[var(--anna-sage-dark)]"
                                  : "bg-[var(--anna-border)]"
                              )}
                            />
                          ))}
                        </div>
                        <span className="text-[10px] font-data text-[var(--anna-muted)] w-24 text-right">
                          {AUTONOMY_LEVEL_NAMES[(a.currentLevel as number) - 1] || `Level ${a.currentLevel}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Escrow Summary */}
            {showEscrow && escrowAgg && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
                  <Wallet size={12} className="inline mr-1" />Escrow Summary
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-amber-50 p-3">
                    <div className="flex items-center gap-1 text-[10px] text-amber-600 mb-1">
                      <ShieldAlert size={10} />
                      Held
                    </div>
                    <p className="font-data text-sm font-semibold text-amber-700">{formatCents(escrowAgg.held)}</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-3">
                    <div className="flex items-center gap-1 text-[10px] text-emerald-600 mb-1">
                      <CheckCircle2 size={10} />
                      Released
                    </div>
                    <p className="font-data text-sm font-semibold text-emerald-700">{formatCents(escrowAgg.released)}</p>
                  </div>
                  {escrowAgg.disputed > 0 && (
                    <div className="rounded-xl bg-red-50 p-3">
                      <div className="flex items-center gap-1 text-[10px] text-red-600 mb-1">
                        <ShieldAlert size={10} />
                        Disputed
                      </div>
                      <p className="font-data text-sm font-semibold text-red-700">{formatCents(escrowAgg.disputed)}</p>
                    </div>
                  )}
                  {escrowAgg.refunded > 0 && (
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="flex items-center gap-1 text-[10px] text-slate-600 mb-1">
                        <ArrowDownLeft size={10} />
                        Refunded
                      </div>
                      <p className="font-data text-sm font-semibold text-slate-700">{formatCents(escrowAgg.refunded)}</p>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-[var(--anna-muted)] mt-2 font-data">
                  Total processed: {formatCents(totalEscrow)}
                </p>
              </div>
            )}

            {/* Recent Tasks */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
                <Clock size={12} className="inline mr-1" />Recent Tasks · {tasks.length}
              </p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto anna-scroll">
                {tasks.slice(0, 10).map((t: Record<string, unknown>) => {
                  const vendor = ((t.bookings as Record<string, unknown>[])?.[0]?.vendor) as Record<string, unknown> | undefined;
                  const rating = (t.bookings as Record<string, unknown>[])?.[0]?.rating as number | undefined;
                  const amountCents = t.amountCents as number | undefined;
                  return (
                    <div key={t.id as string} className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-[var(--anna-bg)] transition-colors">
                      <div className="w-2 h-2 rounded-full shrink-0 bg-[var(--anna-sage-dark)]" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[var(--anna-slate)] truncate">
                          {(t.category as string)?.replace(/_/g, " ")}
                          {vendor ? <span className="text-[var(--anna-muted)]"> · {vendor.name as string}</span> : ""}
                        </p>
                        <p className="text-[10px] text-[var(--anna-muted)] font-data">{formatDateTime(t.createdAt as string)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="secondary" className={cn("text-[10px]", TASK_STATUS_STYLES[t.status as string] || "")}>
                          {(t.status as string)?.replace(/_/g, " ")}
                        </Badge>
                        {amountCents && (
                          <p className="font-data text-[10px] text-[var(--anna-muted)] mt-0.5">{formatCents(amountCents)}</p>
                        )}
                        {rating && (
                          <div className="flex items-center gap-0.5 justify-end mt-0.5">
                            <Star size={10} className="text-amber-500 fill-amber-500" />
                            <span className="font-data text-[10px]">{rating}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {tasks.length === 0 && (
                  <p className="text-xs text-[var(--anna-muted)] py-2">No tasks yet</p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
