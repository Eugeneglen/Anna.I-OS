"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Home, Users, AlertCircle, Calendar, Sparkles, MapPin } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/ops-format";

// ============================================================
// Anna.I — Ops Household Intelligence Panel (read-only)
// ============================================================
// Renders the onboarding profile captured by the household app
// in a structured, readable format for ops staff. This is the
// SAME data the user sees in Settings → Household Profile, but
// displayed read-only for ops context.
//
// The data comes from Household.onboardingProfile (JSON column)
// which is updated by PATCH /api/households/[id]/profile.
// Both apps share the same database — no sync needed.
// ============================================================

// ── Label maps (mirrored from household-profile-section.tsx) ──

const HOME_TYPE_LABELS: Record<string, string> = {
  HDB: "HDB Flat",
  CONDO: "Condominium",
  LANDED: "Landed Property",
  TERRACE: "Terrace House",
  OTHER: "Other",
};

const HDB_SIZE_LABELS: Record<string, string> = {
  "2ROOM": "2-Room",
  "3ROOM": "3-Room",
  "4ROOM": "4-Room",
  "5ROOM": "5-Room",
  EXEC: "Executive",
};

const OCCUPANT_LABELS: Record<string, string> = {
  "1": "1 (Solo)",
  "2": "2 (Couple)",
  "3-4": "3–4 (Small family)",
  "5+": "5+ (Large family)",
};

const PET_LABELS: Record<string, string> = {
  DOGS: "Dogs",
  CATS: "Cats",
  SMALL: "Small Animals",
  OTHERS: "Others",
};

const SCHEDULE_LABELS: Record<string, string> = {
  HOME: "Everyone's usually home",
  MIXED: "Mixed schedule",
  OUT: "Usually out during the day",
};

const MEMBER_LABELS: Record<string, string> = {
  ADULTS: "Working Adults",
  CHILDREN: "Young Children",
  TEENS: "Teenagers",
  ELDERLY: "Elderly",
  PETS: "Pets",
};

const PAIN_POINT_LABELS: Record<string, string> = {
  CLEANING: "Cleaning & tidying",
  AIRCON: "Air-con servicing",
  REPAIRS: "Repairs & maintenance",
  LAUNDRY: "Laundry",
  PLANNING: "Planning & scheduling",
  FINDING: "Finding reliable providers",
};

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  AD_HOC: "Ad hoc",
  AS_NEEDED: "As needed",
};

const DAY_LABELS: Record<string, string> = {
  ANY: "Any day",
  WEEKDAY: "Weekdays",
  WEEKEND: "Weekends",
};

const TIME_LABELS: Record<string, string> = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
  FLEXIBLE: "Flexible",
};

const AUTONOMY_LABELS: Record<string, string> = {
  "1": "Remind me",
  "2": "Suggest",
  "3": "Prepare",
  "4": "Automate",
};

const ACQUISITION_LABELS: Record<string, string> = {
  PILOT_COHORT: "Pilot Cohort",
  PUBLIC_CODE: "Public Code",
  PARTNERSHIP_REFERRAL: "Partnership Referral",
  ORGANIC: "Organic",
  OTHER: "Other",
};

// ── Types ──

interface OnboardingProfile {
  home?: {
    homeType?: string;
    homeSize?: string;
    occupants?: string;
  };
  people?: {
    members?: string[];
    pets?: string[];
    petTypes?: string[];
    schedule?: string;
    roomCount?: string;
  };
  painPoints?: {
    tasks?: string[];
    timeConsumingTasks?: string[];
  };
  serviceHabits?: Record<string, unknown> | {
    categoryFrequency?: Record<string, string>;
  };
  preferences?: {
    preferredDay?: string;
    preferredTime?: string;
    autonomyLevel?: string;
    autonomyPreference?: string; // legacy alias
  };
}

interface HouseholdIntelligencePanelProps {
  onboardingProfile: Record<string, unknown> | null | undefined;
  acquisitionSource: string | null | undefined;
  acquisitionCampaignId: string | null | undefined;
  onboardingCompletedAt: string | null | undefined;
  updatedAt?: string | null | undefined;
}

// ── Helper: render a field row ──

function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-2 py-1">
      <span className="text-[10px] text-[var(--anna-muted)] shrink-0">{label}</span>
      <span className="text-xs font-medium text-[var(--anna-slate)] text-right">{value}</span>
    </div>
  );
}

// ── Helper: render a section card ──

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2 flex items-center gap-1">
        <Icon size={11} />
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

// ── Main component ──

export function HouseholdIntelligencePanel({
  onboardingProfile,
  acquisitionSource,
  acquisitionCampaignId,
  onboardingCompletedAt,
  updatedAt,
}: HouseholdIntelligencePanelProps) {
  const [expanded, setExpanded] = useState(true);

  // Parse the onboarding profile
  const profile = (onboardingProfile || {}) as OnboardingProfile;
  const hasProfile =
    profile.home?.homeType ||
    profile.people?.members ||
    profile.painPoints?.tasks ||
    profile.painPoints?.timeConsumingTasks ||
    profile.serviceHabits ||
    profile.preferences?.preferredDay;

  const hasAcquisition = acquisitionSource || acquisitionCampaignId || onboardingCompletedAt;

  // Empty state
  if (!hasProfile && !hasAcquisition) {
    return (
      <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-4">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={12} className="text-[var(--anna-muted)]" />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            Household Intelligence
          </p>
        </div>
        <p className="text-xs text-[var(--anna-muted)] py-2">
          No onboarding data yet — household hasn&apos;t completed onboarding
        </p>
      </div>
    );
  }

  // Parse values
  const homeType = profile.home?.homeType;
  const homeSize = profile.home?.homeSize;
  const occupants = profile.home?.occupants;
  const members = profile.people?.members || [];
  const pets = profile.people?.petTypes || profile.people?.pets || [];
  const schedule = profile.people?.schedule;
  const roomCount = profile.people?.roomCount;
  const painPoints = profile.painPoints?.tasks || profile.painPoints?.timeConsumingTasks || [];
  const serviceHabits = (profile.serviceHabits as Record<string, unknown>)?.categoryFrequency as Record<string, string> || (profile.serviceHabits as Record<string, string>) || {};
  const preferredDay = profile.preferences?.preferredDay;
  const preferredTime = profile.preferences?.preferredTime;
  const autonomyPref = profile.preferences?.autonomyLevel || profile.preferences?.autonomyPreference;

  return (
    <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] overflow-hidden">
      {/* Header (collapsible) */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--anna-sage-light)]/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--anna-sage-dark)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)]">
            Household Intelligence
          </span>
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && (
            <span className="text-[10px] text-[var(--anna-muted)] font-data">
              Updated {formatDateTime(updatedAt)}
            </span>
          )}
          {expanded ? (
            <ChevronUp size={14} className="text-[var(--anna-muted)]" />
          ) : (
            <ChevronDown size={14} className="text-[var(--anna-muted)]" />
          )}
        </div>
      </button>

      {/* Body (collapsible) */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* YOUR HOME */}
          {(homeType || occupants || homeSize) && (
            <SectionCard icon={Home} title="Your Home">
              {homeType && (
                <FieldRow
                  label="Home Type"
                  value={HOME_TYPE_LABELS[homeType] || homeType}
                />
              )}
              {homeType === "HDB" && homeSize && (
                <FieldRow
                  label="HDB Size"
                  value={HDB_SIZE_LABELS[homeSize] || homeSize}
                />
              )}
              {occupants && (
                <FieldRow
                  label="Occupants"
                  value={OCCUPANT_LABELS[occupants] || occupants}
                />
              )}
            </SectionCard>
          )}

          {/* YOUR PEOPLE */}
          {(members.length > 0 || pets.length > 0 || schedule || roomCount) && (
            <SectionCard icon={Users} title="Your People">
              {members.length > 0 && (
                <FieldRow
                  label="Members"
                  value={members.map((m) => MEMBER_LABELS[m] || m.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())).join(", ")}
                />
              )}
              {pets.length > 0 && (
                <FieldRow
                  label="Pets"
                  value={pets.map((p) => PET_LABELS[p] || p).join(", ")}
                />
              )}
              {schedule && (
                <FieldRow
                  label="Schedule"
                  value={SCHEDULE_LABELS[schedule] || schedule}
                />
              )}
              {roomCount && (
                <FieldRow
                  label="Rooms"
                  value={`${roomCount} rooms`}
                />
              )}
            </SectionCard>
          )}

          {/* PAIN POINTS */}
          {painPoints.length > 0 && (
            <SectionCard icon={AlertCircle} title="Pain Points">
              <div className="flex flex-wrap gap-1.5 pt-1">
                {painPoints.map((pp) => (
                  <span
                    key={pp}
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200"
                  >
                    {PAIN_POINT_LABELS[pp] || pp}
                  </span>
                ))}
              </div>
            </SectionCard>
          )}

          {/* SERVICE HABITS */}
          {Object.keys(serviceHabits).length > 0 && (
            <SectionCard icon={Calendar} title="Service Habits">
              {Object.entries(serviceHabits).map(([cat, freq]) => (
                <FieldRow
                  key={cat}
                  label={cat.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                  value={FREQUENCY_LABELS[freq] || freq}
                />
              ))}
            </SectionCard>
          )}

          {/* PREFERENCES */}
          {(preferredDay || preferredTime || autonomyPref) && (
            <SectionCard icon={Calendar} title="Preferences">
              {preferredDay && (
                <FieldRow
                  label="Preferred Day"
                  value={DAY_LABELS[preferredDay] || preferredDay}
                />
              )}
              {preferredTime && (
                <FieldRow
                  label="Preferred Time"
                  value={TIME_LABELS[preferredTime] || preferredTime}
                />
              )}
              {autonomyPref && (
                <FieldRow
                  label="Autonomy Preference"
                  value={AUTONOMY_LABELS[autonomyPref] || autonomyPref}
                />
              )}
            </SectionCard>
          )}

          {/* ACQUISITION */}
          {hasAcquisition && (
            <SectionCard icon={MapPin} title="Acquisition">
              {acquisitionSource && (
                <FieldRow
                  label="Source"
                  value={ACQUISITION_LABELS[acquisitionSource] || acquisitionSource}
                />
              )}
              {acquisitionCampaignId && (
                <FieldRow
                  label="Campaign ID"
                  value={acquisitionCampaignId}
                />
              )}
              {onboardingCompletedAt && (
                <FieldRow
                  label="Onboarded"
                  value={formatDate(onboardingCompletedAt)}
                />
              )}
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
}
