"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Copy,
  Play,
  Pause,
  Square,
  Trash2,
  Ticket,
  Settings2,
  BarChart3,
  Calendar,
  Clock,
  Globe2,
  User,
  Layers,
  AlertCircle,
  Mail,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSgd, formatDateTime, humanizeEnum, formatInTimezone, timezoneLabel } from "@/lib/ops-format";
import {
  STATUS_STYLES,
  TYPE_STYLES,
  APPLIES_TO_LABELS,
  ELIGIBILITY_LABELS,
  formatDiscount,
  CAMPAIGN_QUERY_KEYS,
} from "./campaign-styles";
import { CampaignGenerateCodesDialog } from "./campaign-generate-codes-dialog";
import { CampaignPerformance } from "./campaign-performance";
import type {
  CampaignDetailResponse,
  CampaignStatus,
} from "./types";

// ============================================================
// Anna.I — Ops Campaign Detail Sheet
// ============================================================
// Right-side slide-in showing the campaign summary, discount
// rule, performance stats, codes table, and action buttons.
// Fetches the full detail (+stats+codes) from
// /api/ops/campaigns/{id} when opened. All mutations
// invalidate ["ops-campaigns"] and ["ops-campaign", id].
// ============================================================

interface CampaignDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId: string | null;
  /** Whether the current user may edit/delete campaigns. */
  canEdit: boolean;
  canDelete: boolean;
}

export function CampaignDetailSheet({
  open,
  onOpenChange,
  selectedId,
  canEdit,
  canDelete,
}: CampaignDetailSheetProps) {
  const queryClient = useQueryClient();
  const [showGenCodes, setShowGenCodes] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const {
    data,
    isLoading,
    isFetching,
  } = useQuery<CampaignDetailResponse>({
    queryKey: selectedId
      ? CAMPAIGN_QUERY_KEYS.detail(selectedId)
      : ["ops-campaign", "none"],
    queryFn: async () => {
      if (!selectedId) throw new Error("No campaign selected");
      const res = await fetch(`/api/ops/campaigns/${selectedId}`);
      if (!res.ok) throw new Error("Failed to load campaign");
      return res.json() as Promise<CampaignDetailResponse>;
    },
    enabled: !!selectedId && open,
  });

  // Wrap onOpenChange so closing the sheet also clears the delete-confirm
  // popover (avoids calling setState directly inside useEffect).
  function handleOpenChange(next: boolean) {
    if (!next) setConfirmDelete(false);
    onOpenChange(next);
  }

  const campaign = data?.campaign;
  const stats = data?.stats;

  // ── Status transition mutation ──
  const statusMutation = useMutation({
    mutationFn: async (newStatus: CampaignStatus) => {
      if (!selectedId) throw new Error("No campaign selected");
      const res = await fetch(`/api/ops/campaigns/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "Status change failed"
        );
      }
      return body;
    },
    onSuccess: (_d, newStatus) => {
      const labels: Record<CampaignStatus, string> = {
        DRAFT: "Reverted to draft",
        ACTIVE: newStatus === "ACTIVE" ? "Campaign activated" : "Campaign resumed",
        PAUSED: "Campaign paused",
        ENDED: "Campaign ended",
      };
      toast.success(labels[newStatus]);
      queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEYS.list });
      if (selectedId) {
        queryClient.invalidateQueries({
          queryKey: CAMPAIGN_QUERY_KEYS.detail(selectedId),
        });
      }
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("No campaign selected");
      const res = await fetch(`/api/ops/campaigns/${selectedId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "Delete failed"
        );
      }
      return body;
    },
    onSuccess: () => {
      toast.success("Campaign deleted");
      queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEYS.list });
      if (selectedId) {
        queryClient.removeQueries({
          queryKey: CAMPAIGN_QUERY_KEYS.detail(selectedId),
        });
      }
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed");
      setConfirmDelete(false);
    },
  });

  function copyCode(code: string) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(code)
        .then(() => toast.success("Code copied"))
        .catch(() => toast.error("Copy failed"));
    } else {
      toast.error("Clipboard unavailable");
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-[var(--anna-white)] anna-scroll">
        {isLoading || !campaign ? (
          <div className="p-6 space-y-4">
            {/* Radix requires a SheetTitle (DialogTitle) + SheetDescription
                (DialogDescription) inside SheetContent even during loading —
                otherwise it throws an accessibility error that crashes the
                page. Visually hidden but present. */}
            <SheetTitle className="sr-only">Loading campaign…</SheetTitle>
            <SheetDescription className="sr-only">
              Campaign details are loading.
            </SheetDescription>
            <Skeleton className="h-6 w-48 bg-[var(--anna-border)]" />
            <Skeleton className="h-32 w-full rounded-2xl bg-[var(--anna-border)]" />
            <Skeleton className="h-40 w-full rounded-2xl bg-[var(--anna-border)]" />
            <Skeleton className="h-40 w-full rounded-2xl bg-[var(--anna-border)]" />
          </div>
        ) : (
          <div className="p-6 space-y-5">
            <SheetHeader>
              <div className="flex items-center gap-2 flex-wrap pr-6">
                <SheetTitle className="text-[var(--anna-slate)]">
                  {campaign.name}
                </SheetTitle>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px] font-medium inline-flex items-center gap-1",
                    STATUS_STYLES[campaign.status].bg,
                    STATUS_STYLES[campaign.status].text
                  )}
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      STATUS_STYLES[campaign.status].dot
                    )}
                  />
                  {STATUS_STYLES[campaign.status].label}
                </Badge>
              </div>
              <SheetDescription className="text-[var(--anna-muted)]">
                {campaign.description || "Campaign management"}
                {isFetching && (
                  <span className="ml-2 text-[10px] text-[var(--anna-muted)]">
                    (refreshing…)
                  </span>
                )}
              </SheetDescription>
            </SheetHeader>

            {/* ── Section 1: Campaign details ── */}
            <section className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1">
                <Settings2 size={12} /> Campaign
              </p>
              <div className="bg-gradient-to-br from-[var(--anna-sage-light)] to-[var(--anna-bg)] rounded-2xl p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <DetailField
                    label="Type"
                    value={
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] font-medium",
                          // police-2a f2: fallback for any future type not in
                          // TYPE_STYLES (detail sheet is the one TYPE_STYLES
                          // consumer with NO || fallback — table/mobile do).
                          (TYPE_STYLES[campaign.type] ?? TYPE_STYLES.OTHER).bg,
                          (TYPE_STYLES[campaign.type] ?? TYPE_STYLES.OTHER).text
                        )}
                      >
                        {(TYPE_STYLES[campaign.type] ?? TYPE_STYLES.OTHER).label}
                      </Badge>
                    }
                  />
                  <DetailField
                    label="Applies To"
                    value={APPLIES_TO_LABELS[campaign.appliesTo]}
                  />
                  <DetailField
                    label="Target Tier"
                    value={campaign.targetTier || "All tiers"}
                  />
                  <DetailField
                    label="Target Category"
                    value={campaign.targetCategory || "All categories"}
                  />
                  <DetailField
                    label="Eligibility"
                    value={
                      campaign.discountRule
                        ? ELIGIBILITY_LABELS[campaign.discountRule.eligibility]
                        : "—"
                    }
                  />
                  <DetailField
                    label="Start"
                    value={formatDateTime(campaign.startDate)}
                    icon={<Calendar size={12} />}
                  />
                  <DetailField
                    label="End"
                    value={formatDateTime(campaign.endDate)}
                    icon={<Calendar size={12} />}
                  />
                  <DetailField
                    label="Max Redemptions"
                    value={
                      campaign.maxRedemptions
                        ? `${campaign.redemptionsCount} / ${campaign.maxRedemptions}`
                        : `${campaign.redemptionsCount} (unlimited)`
                    }
                  />
                  <DetailField
                    label="Created By"
                    value={campaign.createdByName}
                    icon={<User size={12} />}
                  />
                  <DetailField
                    label="Created"
                    value={formatDateTime(campaign.createdAt)}
                  />
                </div>
              </div>
            </section>

            {/* ── Fix 21 — Scheduled Send (only shown when sendAt is set) ── */}
            {/* Display the intended send time + timezone using Intl.DateTimeFormat */}
            {/* so it renders correctly regardless of the viewer's browser tz. */}
            {/* Additive: existing campaigns with no sendAt look unchanged. */}
            {campaign.sendAt && (
              <section className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1">
                  <Clock size={12} /> Scheduled Send
                </p>
                <div className="bg-gradient-to-br from-[var(--anna-sage-light)] to-[var(--anna-bg)] rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Clock size={14} className="text-[var(--anna-sage-dark)]" />
                    <span className="font-data text-sm font-semibold text-[var(--anna-slate)]">
                      {formatInTimezone(campaign.sendAt, campaign.timezone)}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-medium bg-[var(--anna-bg)] text-[var(--anna-slate-light)] inline-flex items-center gap-1"
                    >
                      <Globe2 size={10} />
                      {timezoneLabel(campaign.timezone)}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-[var(--anna-muted)]">
                    Stored in {campaign.timezone || "Asia/Singapore"}. Delivery
                    scheduler is a separate concern — this field records the
                    intended send time only.
                  </p>
                </div>
              </section>
            )}

            {/* ── Section 2: Discount rule ── */}
            <section className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1">
                <Layers size={12} /> Discount Rule
              </p>
              <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
                {campaign.discountRule ? (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <DetailField
                      label="Discount"
                      value={formatDiscount(campaign.discountRule)}
                    />
                    <DetailField
                      label="Stackable"
                      value={campaign.discountRule.stackable ? "Yes" : "No"}
                    />
                    <DetailField
                      label="Min Order"
                      value={
                        campaign.discountRule.minOrderValueCents
                          ? formatSgd(campaign.discountRule.minOrderValueCents)
                          : "No minimum"
                      }
                    />
                    <DetailField
                      label="Max Cap"
                      value={
                        campaign.discountRule.maxDiscountCapCents
                          ? formatSgd(campaign.discountRule.maxDiscountCapCents)
                          : "No cap"
                      }
                    />
                  </div>
                ) : (
                  <p className="text-xs text-[var(--anna-muted)]">
                    No discount rule attached.
                  </p>
                )}
              </div>
            </section>

            {/* ── Section 3: Performance ── */}
            <section className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1">
                <BarChart3 size={12} /> Performance
              </p>
              <div className="grid grid-cols-3 gap-3">
                <StatBox
                  label="Redemptions"
                  value={stats?.totalRedemptions ?? campaign.redemptionsCount}
                />
                <StatBox
                  label="Discount"
                  value={stats ? formatSgd(stats.totalDiscountCents) : "—"}
                />
                <StatBox
                  label="Households"
                  value={stats?.uniqueHouseholds ?? "—"}
                />
              </div>
              {stats?.sourceBreakdown &&
                Object.keys(stats.sourceBreakdown).length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    <span className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">
                      Sources:
                    </span>
                    {Object.entries(stats.sourceBreakdown).map(([src, n]) => (
                      <Badge
                        key={src}
                        variant="secondary"
                        className="text-[10px] font-medium bg-[var(--anna-bg)] text-[var(--anna-slate-light)]"
                      >
                        {humanizeEnum(src)} · {n}
                      </Badge>
                    ))}
                  </div>
                )}
            </section>

            {/* ── Section 3b: Campaign Performance (Phase 3) ── */}
            <section className="space-y-2">
              <CampaignPerformance campaignId={selectedId} />
            </section>

            {/* ── Phase 2 Fix 10 — Campaign Content (read-only display) ── */}
            {(campaign.subjectLine || campaign.bodyText || campaign.smsText) && (
              <section className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1">
                  <Mail size={12} /> Campaign Content
                </p>
                <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 space-y-3">
                  {campaign.subjectLine && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">
                        Subject Line
                      </p>
                      <p className="text-sm font-medium text-[var(--anna-slate)]">
                        {campaign.subjectLine}
                      </p>
                    </div>
                  )}
                  {campaign.bodyText && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">
                        Email Body
                      </p>
                      <pre className="text-xs text-[var(--anna-slate-light)] whitespace-pre-wrap font-sans bg-[var(--anna-bg)] rounded-lg p-2 max-h-60 overflow-y-auto anna-scroll">
                        {campaign.bodyText}
                      </pre>
                    </div>
                  )}
                  {campaign.smsText && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1">
                        <MessageSquare size={10} /> SMS Text
                        <span className="font-data text-[var(--anna-muted)] normal-case tracking-normal">
                          ({campaign.smsText.length}/160)
                        </span>
                      </p>
                      <p className="text-xs text-[var(--anna-slate-light)] bg-[var(--anna-bg)] rounded-lg p-2">
                        {campaign.smsText}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ── Section 4: Codes ── */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1">
                  <Ticket size={12} /> Codes
                  <span className="ml-1 font-data">
                    ({campaign._count.codes})
                  </span>
                </p>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 rounded-lg text-[10px]"
                    onClick={() => setShowGenCodes(true)}
                  >
                    Generate Codes
                  </Button>
                )}
              </div>
              <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
                {campaign.codes.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-xs text-[var(--anna-muted)]">
                      No codes yet. Generate some to start accepting redemptions.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto anna-scroll">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[var(--anna-bg)]">
                        <tr>
                          <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                            Code
                          </th>
                          <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                            Uses
                          </th>
                          <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                            Expires
                          </th>
                          <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaign.codes.map((c) => (
                          <tr
                            key={c.id}
                            className="border-t border-[var(--anna-border)]"
                          >
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1">
                                <code className="font-data text-[var(--anna-slate)] text-[11px]">
                                  {c.code}
                                </code>
                                <button
                                  type="button"
                                  onClick={() => copyCode(c.code)}
                                  className="text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] transition-colors"
                                  aria-label={`Copy ${c.code}`}
                                >
                                  <Copy size={11} />
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-2 font-data text-[var(--anna-slate-light)]">
                              {c.usesRemaining === null
                                ? "∞"
                                : `${c.usesRemaining}${c.maxUses ? `/${c.maxUses}` : ""}`}
                            </td>
                            <td className="px-3 py-2 font-data text-[var(--anna-muted)]">
                              {c.expiresAt ? formatDateTime(c.expiresAt) : "—"}
                            </td>
                            <td className="px-3 py-2">
                              <Badge
                                variant="secondary"
                                className={cn(
                                  "text-[10px] font-medium",
                                  c.isActive
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-rose-50 text-rose-700"
                                )}
                              >
                                {c.isActive ? "Active" : "Disabled"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {campaign._count.codes > campaign.codes.length && (
                      <div className="p-2 text-center border-t border-[var(--anna-border)] bg-[var(--anna-bg)]">
                        <p className="text-[10px] text-[var(--anna-muted)]">
                          Showing first {campaign.codes.length} of{" "}
                          {campaign._count.codes} codes
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* ── Section 5: Actions ── */}
            {canEdit && (
              <section className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1">
                  <AlertCircle size={12} /> Actions
                </p>
                <div className="space-y-2">
                  {campaign.status === "DRAFT" && (
                    <Button
                      variant="outline"
                      className="w-full justify-start h-10 rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 gap-2 text-sm"
                      onClick={() => statusMutation.mutate("ACTIVE")}
                      disabled={statusMutation.isPending}
                    >
                      <Play size={16} /> Activate Campaign
                    </Button>
                  )}
                  {campaign.status === "ACTIVE" && (
                    <>
                      <Button
                        variant="outline"
                        className="w-full justify-start h-10 rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 hover:border-amber-300 gap-2 text-sm"
                        onClick={() => statusMutation.mutate("PAUSED")}
                        disabled={statusMutation.isPending}
                      >
                        <Pause size={16} /> Pause Campaign
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full justify-start h-10 rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:border-rose-300 gap-2 text-sm"
                        onClick={() => statusMutation.mutate("ENDED")}
                        disabled={statusMutation.isPending}
                      >
                        <Square size={16} /> End Campaign
                      </Button>
                    </>
                  )}
                  {campaign.status === "PAUSED" && (
                    <>
                      <Button
                        variant="outline"
                        className="w-full justify-start h-10 rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 gap-2 text-sm"
                        onClick={() => statusMutation.mutate("ACTIVE")}
                        disabled={statusMutation.isPending}
                      >
                        <Play size={16} /> Resume Campaign
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full justify-start h-10 rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:border-rose-300 gap-2 text-sm"
                        onClick={() => statusMutation.mutate("ENDED")}
                        disabled={statusMutation.isPending}
                      >
                        <Square size={16} /> End Campaign
                      </Button>
                    </>
                  )}
                  {campaign.status === "ENDED" && (
                    <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-3 text-xs text-[var(--anna-muted)]">
                      This campaign has ended and is read-only.
                    </div>
                  )}

                  <Button
                    variant="outline"
                    className="w-full justify-start h-10 rounded-xl border-[var(--anna-border)] text-[var(--anna-slate)] hover:bg-[var(--anna-sage-light)] gap-2 text-sm"
                    onClick={() => setShowGenCodes(true)}
                  >
                    <Ticket size={16} /> Generate Codes
                  </Button>

                  {canDelete && campaign.status === "DRAFT" && (
                    <>
                      {confirmDelete ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2">
                          <p className="text-xs text-rose-700">
                            Delete this draft? This cannot be undone.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 h-8 rounded-lg"
                              onClick={() => setConfirmDelete(false)}
                              disabled={deleteMutation.isPending}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="flex-1 h-8 rounded-lg bg-rose-600 hover:bg-rose-700 text-white"
                              onClick={() => deleteMutation.mutate()}
                              disabled={deleteMutation.isPending}
                            >
                              {deleteMutation.isPending ? "Deleting…" : "Delete"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          className="w-full justify-start h-10 rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:border-rose-300 gap-2 text-sm"
                          onClick={() => setConfirmDelete(true)}
                        >
                          <Trash2 size={16} /> Delete Draft
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </SheetContent>

      {/* Generate codes dialog (mounted as sibling so it overlays the sheet) */}
      <CampaignGenerateCodesDialog
        open={showGenCodes}
        onOpenChange={setShowGenCodes}
        campaignId={selectedId}
        campaignName={campaign?.name}
      />
    </Sheet>
  );
}

// ── Small presentational helpers ──

function DetailField({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="font-data text-[var(--anna-slate)] text-xs mt-0.5">
        {value}
      </p>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[var(--anna-bg)] rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">
        {label}
      </p>
      <p className="text-base font-bold font-data text-[var(--anna-slate)] mt-1">
        {value}
      </p>
    </div>
  );
}
