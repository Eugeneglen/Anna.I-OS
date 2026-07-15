"use client";

import { useQuery } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatSgd, type Household, type FamilyMember, type Subscription } from "@/lib/types";
import { Mail, MapPin, Crown, Users } from "lucide-react";

async function fetchHouseholdDetail(id: string) {
  const res = await fetch(`/api/households/${id}`);
  if (!res.ok) throw new Error("Failed to fetch household");
  return res.json();
}

export function SettingsPanel() {
  const { selectedHouseholdId } = useAnnaStore();

  const { data, isLoading } = useQuery({
    queryKey: ["household", selectedHouseholdId],
    queryFn: () => fetchHouseholdDetail(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
  });

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-8 w-48 rounded-xl bg-[var(--anna-border)]" />
        <Skeleton className="h-40 w-full rounded-2xl bg-[var(--anna-border)]" />
        <Skeleton className="h-32 w-full rounded-2xl bg-[var(--anna-border)]" />
      </div>
    );
  }

  const household: Household | undefined = data?.household;
  const members: FamilyMember[] = data?.members || [];
  const subscriptions: Subscription[] = data?.subscriptions || [];
  const sub = subscriptions[0];

  return (
    <div className="p-4 lg:p-6 pb-20 md:pb-0 anna-fade-in">
      <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)] mb-1">
        Settings
      </h1>
      <p className="text-sm text-[var(--anna-muted)] mb-6">
        Household configuration and subscription
      </p>

      {/* Household Info */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)] mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
          Household
        </h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center">
              <span className="text-sm font-bold text-[var(--anna-sage-dark)]">
                {household?.name?.charAt(0) || "?"}
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--anna-slate)]">
                {household?.name}
              </p>
              <p className="text-xs text-[var(--anna-muted)]">
                Owner
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-[var(--anna-slate-light)]">
            <Mail size={14} className="text-[var(--anna-muted)]" />
            {household?.email}
          </div>

          <div className="flex items-center gap-2 text-sm text-[var(--anna-slate-light)]">
            <MapPin size={14} className="text-[var(--anna-muted)]" />
            {household?.address}
            {household?.unitNumber && `, ${household.unitNumber}`}
            {household?.postalCode && ` ${household.postalCode}`}
          </div>
        </div>
      </div>

      {/* Subscription */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)] mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
          Subscription
        </h3>
        {sub ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown size={16} className="text-[var(--anna-warning)]" />
                <span className="text-sm font-semibold text-[var(--anna-slate)]">
                  {sub.tier} Tier
                </span>
              </div>
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${
                  sub.status === "ACTIVE"
                    ? "bg-[var(--anna-success)]/15 text-[var(--anna-success)]"
                    : "bg-[var(--anna-error)]/15 text-[var(--anna-error)]"
                }`}
              >
                {sub.status}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--anna-muted)]">Price</span>
              <span className="font-data font-semibold text-[var(--anna-slate)]">
                {formatSgd(sub.priceCents)}
                <span className="text-[var(--anna-muted)] font-sans font-normal">
                  /mo
                </span>
              </span>
            </div>
            {sub.nextBillingDate && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--anna-muted)]">Next billing</span>
                <span className="font-data text-[var(--anna-slate-light)]">
                  {new Date(sub.nextBillingDate).toLocaleDateString("en-SG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--anna-muted)]">
            No subscription found
          </p>
        )}
      </div>

      {/* Members */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)]">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
          <Users size={14} />
          Members ({members.length})
        </h3>
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between py-1.5"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[var(--anna-sage-light)] flex items-center justify-center text-xs font-semibold text-[var(--anna-sage-dark)]">
                  {member.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--anna-slate)]">
                    {member.name}
                  </p>
                  <p className="text-[11px] text-[var(--anna-muted)]">
                    {member.email}
                  </p>
                </div>
              </div>
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${
                  member.role === "OWNER"
                    ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                    : "bg-[var(--anna-bg)] text-[var(--anna-muted)]"
                }`}
              >
                {member.role}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}