"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Search,
  Home,
  Users,
  ChevronRight,
  MapPin,
  Mail,
  Phone,
  Clock,
  Star,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AUTONOMY_LEVEL_NAMES } from "@/lib/constants";

const SUBSCRIPTION_STYLES: Record<string, string> = {
  HOME: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]",
  CARE: "bg-purple-50 text-purple-700",
  CANCELLED: "bg-red-50 text-red-600",
  PAST_DUE: "bg-amber-50 text-amber-700",
};

const TASK_STATUS_STYLES: Record<string, string> = {
  CREATED: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)]",
  DISPATCHED: "bg-blue-50 text-blue-700",
  IN_PROGRESS: "bg-purple-50 text-purple-700",
  COMPLETED: "bg-[var(--anna-success)]/15 text-[var(--anna-success)]",
  VERIFIED: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]",
  ESCROW_RELEASED: "bg-emerald-50 text-emerald-700",
  DISPUTED: "bg-red-50 text-red-700",
};

function formatCategories(catsJson: string | null) {
  if (!catsJson) return [];
  try {
    return JSON.parse(catsJson) as string[];
  } catch {
    return [];
  }
}

function formatCents(cents: number) {
  return `$${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2 })}`;
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HouseholdsPage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: listData, isLoading } = useQuery({
    queryKey: ["ops-households"],
    queryFn: async () => {
      const res = await fetch("/api/households");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const households = (listData?.households || []) as Record<string, unknown>[];
  const filtered = search
    ? households.filter(
        (h) =>
          (h.name as string)?.toLowerCase().includes(search.toLowerCase()) ||
          (h.email as string)?.toLowerCase().includes(search.toLowerCase()) ||
          (h.postalCode as string)?.includes(search)
      )
    : households;

  // Detail query
  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["ops-household-detail", selectedId],
    queryFn: async () => {
      const res = await fetch(`/api/households/${selectedId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedId,
  });

  const detail = detailData || null;
  const members = (detail?.members || []) as Record<string, unknown>[];
  const tasks = (detail?.tasks || []) as Record<string, unknown>[];
  const subscriptions = (detail?.subscriptions || []) as Record<string, unknown>[];
  const categoryAutonomy = (detail?.categoryAutonomy || []) as Record<string, unknown>[];

  const activeSub = subscriptions.find(
    (s: Record<string, unknown>) => s.status === "ACTIVE"
  );

  // Enrich household list with member/task counts
  // We'll fetch counts inline since the list API is simple
  const household = selectedId
    ? households.find((h) => h.id === selectedId)
    : null;

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            Households
          </h2>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            <span className="font-data">{filtered.length}</span> households
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]" />
          <Input
            placeholder="Search name, email, postal..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-64 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
          />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl bg-[var(--anna-border)]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-4">
            <Home size={24} className="text-[var(--anna-sage-dark)]" />
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)]">No households found</p>
          <p className="text-xs text-[var(--anna-muted)] mt-1">
            {search ? "Try a different search term" : "Households will appear here once they sign up"}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Name</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Contact</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Location</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Categories</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Subscription</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Joined</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((h: Record<string, unknown>) => {
                  const cats = formatCategories(h.activeCategories as string);
                  return (
                    <tr
                      key={h.id as string}
                      onClick={() => setSelectedId(h.id as string)}
                      className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/30 cursor-pointer transition-colors group"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--anna-slate)]">{h.name as string}</span>
                          <ChevronRight size={14} className="text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-[var(--anna-slate-light)]">{h.email as string}</p>
                        <p className="text-[10px] text-[var(--anna-muted)]">{h.phone as string || "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-[var(--anna-slate-light)] truncate max-w-48">{h.address as string || "—"}</p>
                        <p className="text-[10px] text-[var(--anna-muted)] font-data">{h.postalCode as string || ""} {h.unitNumber ? `#${h.unitNumber as string}` : ""}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {cats.slice(0, 2).map((c) => (
                            <span key={c} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                              {c.replace(/_/g, " ")}
                            </span>
                          ))}
                          {cats.length > 2 && (
                            <span className="text-[10px] text-[var(--anna-muted)] font-data">+{cats.length - 2}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={cn("text-[10px] font-medium", SUBSCRIPTION_STYLES["HOME"])}>
                          HOME
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-data text-xs text-[var(--anna-muted)]">
                        {new Date(h.createdAt as string).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((h: Record<string, unknown>) => {
              const cats = formatCategories(h.activeCategories as string);
              return (
                <div
                  key={h.id as string}
                  onClick={() => setSelectedId(h.id as string)}
                  className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-all cursor-pointer"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[var(--anna-slate)]">{h.name as string}</p>
                      <p className="text-xs text-[var(--anna-muted)] mt-0.5">{h.email as string}</p>
                    </div>
                    <ChevronRight size={16} className="text-[var(--anna-muted)] shrink-0 mt-0.5" />
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--anna-muted)]">
                    <MapPin size={10} />
                    <span className="truncate">{h.address as string || "—"}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {cats.slice(0, 3).map((c) => (
                      <span key={c} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                        {c.replace(/_/g, " ")}
                      </span>
                    ))}
                    {cats.length > 3 && (
                      <span className="text-[10px] text-[var(--anna-muted)] font-data">+{cats.length - 3}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto bg-[var(--anna-white)] anna-scroll">
          {detailLoading ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-6 w-48 bg-[var(--anna-border)]" />
              <Skeleton className="h-4 w-32 bg-[var(--anna-border)]" />
              <Skeleton className="h-32 w-full rounded-2xl bg-[var(--anna-border)]" />
              <Skeleton className="h-40 w-full rounded-2xl bg-[var(--anna-border)]" />
            </div>
          ) : detail ? (
            <div className="p-6 space-y-5">
              <SheetHeader>
                <SheetTitle className="text-[var(--anna-slate)]">{household?.name}</SheetTitle>
              </SheetHeader>

              {/* Contact Info */}
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-[var(--anna-slate-light)]">
                  <Mail size={14} className="text-[var(--anna-muted)]" />
                  {detail.household.email}
                </div>
                <div className="flex items-center gap-2 text-[var(--anna-slate-light)]">
                  <Phone size={14} className="text-[var(--anna-muted)]" />
                  {detail.household.phone || "—"}
                </div>
                <div className="flex items-start gap-2 text-[var(--anna-slate-light)]">
                  <MapPin size={14} className="text-[var(--anna-muted)] mt-0.5 shrink-0" />
                  <span>
                    {detail.household.address || "—"}
                    {detail.household.postalCode && (
                      <span className="font-data text-[var(--anna-muted)]"> · {detail.household.postalCode}</span>
                    )}
                    {detail.household.unitNumber && (
                      <span className="font-data text-[var(--anna-muted)]"> #{detail.household.unitNumber}</span>
                    )}
                  </span>
                </div>
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

              {/* Recent Tasks */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
                  <Clock size={12} className="inline mr-1" />Recent Tasks · {tasks.length}
                </p>
                <div className="space-y-1.5 max-h-64 overflow-y-auto anna-scroll">
                  {tasks.slice(0, 10).map((t: Record<string, unknown>) => {
                    const vendor = ((t.bookings as Record<string, unknown>[])?.[0]?.vendor) as Record<string, unknown> | undefined;
                    const rating = (t.bookings as Record<string, unknown>[])?.[0]?.rating as number | undefined;
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
                          {t.amountCents && (
                            <p className="font-data text-[10px] text-[var(--anna-muted)] mt-0.5">{formatCents(t.amountCents as number)}</p>
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
    </div>
  );
}
