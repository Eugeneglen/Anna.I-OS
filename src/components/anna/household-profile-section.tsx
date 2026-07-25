"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Home,
  Building2,
  Trees,
  HelpCircle,
  Users,
  Baby,
  GraduationCap,
  HeartPulse,
  Dog,
  Cat,
  Fish,
  Bird,
  BrushCleaning,
  Wind,
  Wrench,
  Shirt,
  ShoppingCart,
  Handshake,
  Bell,
  Lightbulb,
  Target,
  Zap,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────

export interface HouseholdProfile {
  home?: {
    homeType?: string;
    homeSize?: string;
    occupants?: string;
  } | null;
  people?: {
    members?: string[];
    pets?: string[];
    petTypes?: string[];
    schedule?: string;
    roomCount?: string;
  } | null;
  painPoints?: {
    timeConsumingTasks?: string[];
    frustrations?: string;
  } | null;
  serviceHabits?: {
    categoryFrequency?: Record<string, string>;
    existingVendors?: Record<string, { name: string; phone?: string } | null>;
    vendorGaps?: string[];
  } | null;
  preferences?: {
    preferredDay?: string;
    preferredTime?: string;
    autonomyLevel?: string;
  } | null;
}

interface ProfileSectionProps {
  profile: HouseholdProfile;
  householdId: string;
}

// ─── Label helpers ────────────────────────────────────────

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

const MEMBER_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  ADULTS: { label: "Working Adults", icon: Users },
  CHILDREN: { label: "Young Children", icon: Baby },
  TEENS: { label: "Teenagers", icon: GraduationCap },
  ELDERLY: { label: "Elderly", icon: HeartPulse },
  PETS: { label: "Pets", icon: Dog },
};

const PET_TYPE_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  DOGS: { label: "Dogs", icon: Dog },
  CATS: { label: "Cats", icon: Cat },
  SMALL: { label: "Small Animals", icon: Fish },
  OTHERS: { label: "Others", icon: Bird },
};

const SCHEDULE_LABELS: Record<string, string> = {
  HOME: "Everyone's usually home",
  MIXED: "Mixed schedule",
  OUT: "Usually out during the day",
};

const OCCUPANT_LABELS: Record<string, string> = {
  "1": "1 (Solo)",
  "2": "2 (Couple)",
  "3-4": "3–4 (Small family)",
  "5+": "5+ (Large family)",
};

const PAIN_POINT_TASKS = [
  { value: "CLEANING", label: "Cleaning & tidying", icon: BrushCleaning },
  { value: "AIRCON", label: "Air-con servicing", icon: Wind },
  { value: "REPAIRS", label: "Repairs & maintenance", icon: Wrench },
  { value: "LAUNDRY", label: "Laundry", icon: Shirt },
  { value: "PLANNING", label: "Planning & scheduling", icon: ShoppingCart },
  { value: "FINDING", label: "Finding reliable providers", icon: Handshake },
];

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  "AD_HOC": "Ad hoc",
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

const AUTONOMY_CONFIG = [
  { value: "1", label: "Remind me", desc: "Just remind me when tasks are due", icon: Bell },
  { value: "2", label: "Suggest", desc: "Recommend what I should do", icon: Lightbulb },
  { value: "3", label: "Prepare", desc: "Get options ready for me to approve", icon: Target },
  { value: "4", label: "Automate", desc: "Handle routine decisions (with approval)", icon: Zap },
];

const HOME_TYPE_OPTIONS = [
  { value: "HDB", label: "HDB Flat", icon: Building2, desc: "Public housing" },
  { value: "CONDO", label: "Condominium", icon: Building2, desc: "Private apartment" },
  { value: "LANDED", label: "Landed Property", icon: Trees, desc: "Detached or semi-D" },
  { value: "TERRACE", label: "Terrace House", icon: Home, desc: "Link house" },
  { value: "OTHER", label: "Other", icon: HelpCircle, desc: "Studio, dorm, etc." },
];

const HDB_SIZE_OPTIONS = [
  { value: "2ROOM", label: "2-Room" },
  { value: "3ROOM", label: "3-Room" },
  { value: "4ROOM", label: "4-Room" },
  { value: "5ROOM", label: "5-Room" },
  { value: "EXEC", label: "Executive" },
];

const OCCUPANT_OPTIONS = [
  { value: "1", label: "1", sub: "Solo" },
  { value: "2", label: "2", sub: "Couple" },
  { value: "3-4", label: "3–4", sub: "Small family" },
  { value: "5+", label: "5+", sub: "Large family" },
];

const SCHEDULE_OPTIONS = [
  { value: "HOME", label: "Everyone's usually home" },
  { value: "MIXED", label: "Mixed schedule" },
  { value: "OUT", label: "Usually out during the day" },
];

const ROOM_COUNT_OPTIONS = [
  { value: "3", label: "3 rooms" },
  { value: "4", label: "4 rooms" },
  { value: "5+", label: "5+ rooms" },
];

const FREQUENCY_OPTIONS = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "FORTNIGHTLY", label: "Fortnightly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "AD_HOC", label: "Ad hoc" },
];

const DAY_OPTIONS = [
  { value: "ANY", label: "Any day" },
  { value: "WEEKDAY", label: "Weekdays" },
  { value: "WEEKEND", label: "Weekends" },
];

const TIME_OPTIONS = [
  { value: "MORNING", label: "Morning" },
  { value: "AFTERNOON", label: "Afternoon" },
  { value: "EVENING", label: "Evening" },
  { value: "FLEXIBLE", label: "Flexible" },
];

// ─── Shared tiny components ──────────────────────────────

function Pill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
        active
          ? "border-[var(--anna-sage)] bg-[var(--anna-sage)] text-white"
          : "border-[var(--anna-border)] bg-white text-[var(--anna-muted)] hover:border-[var(--anna-sage)]/40"
      )}
    >
      {label}
    </button>
  );
}

function OptionBtn({
  label,
  sub,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  sub?: string;
  icon?: React.ElementType;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-xl border p-3 transition-all",
        active
          ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40 shadow-sm"
          : "border-[var(--anna-border)] bg-white hover:border-[var(--anna-sage)]/30"
      )}
    >
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
              active
                ? "bg-[var(--anna-sage)] text-white"
                : "bg-[var(--anna-bg)] text-[var(--anna-slate-light)]"
            )}
          >
            <Icon size={16} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className={cn("text-xs font-semibold", active ? "text-[var(--anna-sage-dark)]" : "text-[var(--anna-slate)]")}>
            {label}
          </p>
          {sub && <p className="text-[10px] text-[var(--anna-muted)]">{sub}</p>}
        </div>
        {active && (
          <div className="w-5 h-5 rounded-full bg-[var(--anna-sage)] flex items-center justify-center shrink-0">
            <Check size={12} className="text-white" />
          </div>
        )}
      </div>
    </button>
  );
}

function ToggleChip({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-xl border p-2.5 transition-all w-full",
        active
          ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40"
          : "border-[var(--anna-border)] bg-white hover:border-[var(--anna-sage)]/30"
      )}
    >
      <div
        className={cn(
          "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
          active ? "bg-[var(--anna-sage)] text-white" : "bg-[var(--anna-bg)] text-[var(--anna-slate-light)]"
        )}
      >
        <Icon size={14} />
      </div>
      <span className={cn("text-xs font-semibold", active ? "text-[var(--anna-sage-dark)]" : "text-[var(--anna-slate)]")}>
        {label}
      </span>
    </button>
  );
}

function SectionWrapper({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] mb-4 overflow-hidden">
      <div className="px-5 pt-4 pb-2">
        <h4 className="text-sm font-semibold text-[var(--anna-slate)]">{title}</h4>
        <p className="text-[11px] text-[var(--anna-muted)] mt-0.5">{description}</p>
      </div>
      <div className="px-5 pb-4">{children}</div>
    </div>
  );
}

// ─── Section 1: Your Home ────────────────────────────────────

function HomeSection({
  data,
  onEdit,
  onSave,
  onCancel,
  saving,
}: {
  data: HouseholdProfile["home"];
  onEdit: () => void;
  onSave: (data: NonNullable<HouseholdProfile["home"]>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<NonNullable<HouseholdProfile["home"]>>(data || {});

  const startEdit = () => {
    setDraft(data || {});
    setEdit(true);
    onEdit();
  };
  const cancel = () => { setEdit(false); onCancel(); };
  const save = () => { setEdit(false); onSave(draft); };

  if (edit) {
    return (
      <SectionWrapper title="Your Home" description="Home type, size, and occupants">
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Home Type</p>
            <div className="grid grid-cols-2 gap-2">
              {HOME_TYPE_OPTIONS.map((opt) => (
                <OptionBtn key={opt.value} {...opt} active={draft.homeType === opt.value} onClick={() => setDraft((p) => ({ ...p, homeType: opt.value }))} />
              ))}
            </div>
          </div>
          {draft.homeType === "HDB" && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Flat Size</p>
              <div className="flex flex-wrap gap-2">
                {HDB_SIZE_OPTIONS.map((opt) => (
                  <Pill key={opt.value} label={opt.label} active={draft.homeSize === opt.value} onClick={() => setDraft((p) => ({ ...p, homeSize: opt.value }))} />
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Occupants</p>
            <div className="grid grid-cols-4 gap-2">
              {OCCUPANT_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" onClick={() => setDraft((p) => ({ ...p, occupants: opt.value }))} className={cn("flex flex-col items-center gap-0.5 p-3 rounded-xl border transition-all", draft.occupants === opt.value ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40" : "border-[var(--anna-border)] bg-white hover:border-[var(--anna-sage)]/30")}>
                  <span className={cn("text-base font-bold font-data", draft.occupants === opt.value ? "text-[var(--anna-sage)]" : "text-[var(--anna-slate)]")}>{opt.label}</span>
                  <span className="text-[9px] text-[var(--anna-muted)]">{opt.sub}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin mr-1" /> : <Check size={12} className="mr-1" />}
              Save
            </Button>
          </div>
        </div>
      </SectionWrapper>
    );
  }

  // Read-only view
  const items: { label: string; value: string }[] = [
    { label: "Home Type", value: data?.homeType ? HOME_TYPE_LABELS[data.homeType] || data.homeType : "—" },
  ];
  if (data?.homeType === "HDB" && data?.homeSize) {
    items.push({ label: "Flat Size", value: HDB_SIZE_LABELS[data.homeSize] || data.homeSize });
  }
  if (data?.occupants) {
    items.push({ label: "Occupants", value: OCCUPANT_LABELS[data.occupants] || data.occupants });
  }

  return (
    <SectionWrapper title="Your Home" description="Home type, size, and occupants">
      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between">
            <span className="text-xs text-[var(--anna-muted)]">{item.label}</span>
            <span className="text-xs font-medium text-[var(--anna-slate)]">{item.value}</span>
          </div>
        ))}
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]" onClick={startEdit}>
            Edit
          </Button>
        </div>
      </div>
    </SectionWrapper>
  );
}

// ─── Section 2: Your People ───────────────────────────────

function PeopleSection({
  data,
  onEdit,
  onSave,
  onCancel,
  saving,
}: {
  data: HouseholdProfile["people"];
  onEdit: () => void;
  onSave: (data: NonNullable<HouseholdProfile["people"]>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<NonNullable<HouseholdProfile["people"]>>(data || {});

  const toggleMember = (v: string) => {
    setDraft((p) => {
      const members = (p.members || []).includes(v)
        ? (p.members || []).filter((m) => m !== v)
        : [...(p.members || []), v];
      return { ...p, members, ...(v === "PETS" && !members.includes(v) ? {} : v === "PETS" ? { petTypes: [] } : {}) };
    });
  };

  const startEdit = () => { setDraft(data || {}); setEdit(true); onEdit(); };
  const cancel = () => { setEdit(false); onCancel(); };
  const save = () => { setEdit(false); onSave(draft); };

  if (edit) {
    return (
      <SectionWrapper title="Your People" description="Who lives at home, schedule, and rooms">
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Household Members</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(MEMBER_LABELS).map(([key, { label, icon }]) => (
                <ToggleChip key={key} label={label} icon={icon} active={(draft.members || []).includes(key)} onClick={() => toggleMember(key)} />
              ))}
            </div>
          </div>
          {(draft.members || []).includes("PETS") && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Pet Types</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(PET_TYPE_LABELS).map(([key, { label, icon }]) => (
                  <Pill key={key} label={label} active={(draft.petTypes || []).includes(key)} onClick={() => setDraft((p) => ({ ...p, petTypes: (p.petTypes || []).includes(key) ? (p.petTypes || []).filter((t) => t !== key) : [...(p.petTypes || []), key] }))} />
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Household Schedule</p>
            <div className="space-y-2">
              {SCHEDULE_OPTIONS.map((opt) => (
                <OptionBtn key={opt.value} label={opt.label} active={draft.schedule === opt.value} onClick={() => setDraft((p) => ({ ...p, schedule: opt.value }))} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Number of Rooms</p>
            <div className="flex flex-wrap gap-2">
              {ROOM_COUNT_OPTIONS.map((opt) => (
                <Pill key={opt.value} label={opt.label} active={draft.roomCount === opt.value} onClick={() => setDraft((p) => ({ ...p, roomCount: opt.value }))} />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin mr-1" /> : <Check size={12} className="mr-1" />}
              Save
            </Button>
          </div>
        </div>
      </SectionWrapper>
    );
  }

  const members = (data?.members || []).map((m) => MEMBER_LABELS[m]?.label || m);
  const pets = (data?.petTypes || []).map((t) => PET_TYPE_LABELS[t]?.label || t);
  const items: { label: string; value: string }[] = [];
  if (members.length) items.push({ label: "Members", value: members.join(", ") });
  if (pets.length) items.push({ label: "Pets", value: pets.join(", ") });
  if (data?.schedule) items.push({ label: "Schedule", value: SCHEDULE_LABELS[data.schedule] || data.schedule });
  if (data?.roomCount) items.push({ label: "Rooms", value: `${data.roomCount} rooms` });

  return (
    <SectionWrapper title="Your People" description="Who lives at home, schedule, and rooms">
      <div className="space-y-2.5">
        {items.length === 0 ? (
          <p className="text-xs text-[var(--anna-muted)] italic">Not set yet</p>
        ) : (
          items.map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <span className="text-xs text-[var(--anna-muted)]">{item.label}</span>
              <span className="text-xs font-medium text-[var(--anna-slate)] text-right max-w-[60%]">{item.value}</span>
            </div>
          ))
        )}
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]" onClick={startEdit}>
            Edit
          </Button>
        </div>
      </div>
    </SectionWrapper>
  );
}

// ─── Section 3: Pain Points ───────────────────────────────

function PainPointsSection({
  data,
  onEdit,
  onSave,
  onCancel,
  saving,
}: {
  data: HouseholdProfile["painPoints"];
  onEdit: () => void;
  onSave: (data: NonNullable<HouseholdProfile["painPoints"]>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<NonNullable<HouseholdProfile["painPoints"]>>(data || {});

  const toggleTask = (v: string) => {
    setDraft((p) => ({
      ...p,
      timeConsumingTasks: (p.timeConsumingTasks || []).includes(v)
        ? (p.timeConsumingTasks || []).filter((t) => t !== v)
        : [...(p.timeConsumingTasks || []), v],
    }));
  };

  const startEdit = () => { setDraft(data || {}); setEdit(true); onEdit(); };
  const cancel = () => { setEdit(false); onCancel(); };
  const save = () => { setEdit(false); onSave(draft); };

  if (edit) {
    return (
      <SectionWrapper title="Pain Points" description="Tasks that take up your time and frustrations">
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Time-Consuming Tasks (select up to 4)</p>
            <div className="grid grid-cols-2 gap-2">
              {PAIN_POINT_TASKS.map((task) => (
                <OptionBtn key={task.value} label={task.label} icon={task.icon} active={(draft.timeConsumingTasks || []).includes(task.value)} onClick={() => toggleTask(task.value)} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Frustrations</p>
            <Textarea
              value={draft.frustrations || ""}
              onChange={(e) => setDraft((p) => ({ ...p, frustrations: e.target.value }))}
              placeholder="What frustrates you about managing your home?"
              className="min-h-[60px] text-xs resize-none bg-[var(--anna-bg)] border-[var(--anna-border)] rounded-xl"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin mr-1" /> : <Check size={12} className="mr-1" />}
              Save
            </Button>
          </div>
        </div>
      </SectionWrapper>
    );
  }

  const tasks = (data?.timeConsumingTasks || []).map((t) => {
    const found = PAIN_POINT_TASKS.find((pt) => pt.value === t);
    return found ? found.label : t;
  });

  return (
    <SectionWrapper title="Pain Points" description="Tasks that take up your time and frustrations">
      <div className="space-y-2.5">
        {tasks.length > 0 ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--anna-muted)]">Time-Consuming Tasks</span>
            <span className="text-xs font-medium text-[var(--anna-slate)] text-right max-w-[60%]">{tasks.join(", ")}</span>
          </div>
        ) : null}
        {data?.frustrations && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-xs text-[var(--anna-muted)] shrink-0">Frustrations</span>
            <span className="text-xs font-medium text-[var(--anna-slate)] text-right">{data.frustrations}</span>
          </div>
        )}
        {tasks.length === 0 && !data?.frustrations && <p className="text-xs text-[var(--anna-muted)] italic">Not set yet</p>}
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]" onClick={startEdit}>
            Edit
          </Button>
        </div>
      </div>
    </SectionWrapper>
  );
}

// ─── Section 4: Service Habits ────────────────────────────

function ServiceHabitsSection({
  data,
  onEdit,
  onSave,
  onCancel,
  saving,
}: {
  data: HouseholdProfile["serviceHabits"];
  onEdit: () => void;
  onSave: (data: NonNullable<HouseholdProfile["serviceHabits"]>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<NonNullable<HouseholdProfile["serviceHabits"]>>(data || {});

  const startEdit = () => { setDraft(data || {}); setEdit(true); onEdit(); };
  const cancel = () => { setEdit(false); onCancel(); };
  const save = () => { setEdit(false); onSave(draft); };

  if (edit) {
    const freq = draft.categoryFrequency || {};
    const setFreq = (cat: string, val: string) => setDraft((p) => ({ ...p, categoryFrequency: { ...p.categoryFrequency, [cat]: val } }));

    return (
      <SectionWrapper title="Service Habits" description="Service frequency and trusted providers">
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Service Frequency</p>
            <div className="space-y-3">
              {PAIN_POINT_TASKS.filter((t) => t.value !== "PLANNING" && t.value !== "FINDING").map((task) => (
                <div key={task.value} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[var(--anna-bg)] flex items-center justify-center shrink-0">
                    <task.icon size={14} className="text-[var(--anna-slate-light)]" />
                  </div>
                  <span className="text-xs font-medium text-[var(--anna-slate)] w-24 shrink-0">{task.label.split(" & ")[0]}</span>
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <Pill key={opt.value} label={opt.label} active={freq[task.value] === opt.value} onClick={() => setFreq(task.value, opt.value)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin mr-1" /> : <Check size={12} className="mr-1" />}
              Save
            </Button>
          </div>
        </div>
      </SectionWrapper>
    );
  }

  const freq = data?.categoryFrequency || {};
  const freqEntries = Object.entries(freq).filter(([_, v]) => v);

  return (
    <SectionWrapper title="Service Habits" description="Service frequency and trusted providers">
      <div className="space-y-2.5">
        {freqEntries.length === 0 ? (
          <p className="text-xs text-[var(--anna-muted)] italic">Not set yet</p>
        ) : (
          freqEntries.map(([cat, val]) => {
            const found = PAIN_POINT_TASKS.find((t) => t.value === cat);
            return (
              <div key={cat} className="flex items-center justify-between">
                <span className="text-xs text-[var(--anna-muted)]">{found?.label || cat}</span>
                <span className="text-xs font-medium text-[var(--anna-slate)]">{FREQUENCY_LABELS[val] || val}</span>
              </div>
            );
          })
        )}
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]" onClick={startEdit}>
            Edit
          </Button>
        </div>
      </div>
    </SectionWrapper>
  );
}

// ─── Section 5: Preferences ────────────────────────────────

function PreferencesSection({
  data,
  onEdit,
  onSave,
  onCancel,
  saving,
}: {
  data: HouseholdProfile["preferences"];
  onEdit: () => void;
  onSave: (data: NonNullable<HouseholdProfile["preferences"]>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<NonNullable<HouseholdProfile["preferences"]>>(data || {});

  const startEdit = () => { setDraft(data || {}); setEdit(true); onEdit(); };
  const cancel = () => { setEdit(false); onCancel(); };
  const save = () => { setEdit(false); onSave(draft); };

  if (edit) {
    return (
      <SectionWrapper title="Preferences" description="How Anna.I should help you">
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Autonomy Level</p>
            <div className="space-y-2">
              {AUTONOMY_CONFIG.map((level) => (
                <OptionBtn key={level.value} label={level.label} sub={level.desc} icon={level.icon} active={draft.autonomyLevel === level.value} onClick={() => setDraft((p) => ({ ...p, autonomyLevel: level.value }))} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Preferred Day</p>
            <div className="flex flex-wrap gap-2">
              {DAY_OPTIONS.map((opt) => (
                <Pill key={opt.value} label={opt.label} active={draft.preferredDay === opt.value} onClick={() => setDraft((p) => ({ ...p, preferredDay: opt.value }))} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Preferred Time</p>
            <div className="flex flex-wrap gap-2">
              {TIME_OPTIONS.map((opt) => (
                <Pill key={opt.value} label={opt.label} active={draft.preferredTime === opt.value} onClick={() => setDraft((p) => ({ ...p, preferredTime: opt.value }))} />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin mr-1" /> : <Check size={12} className="mr-1" />}
              Save
            </Button>
          </div>
        </div>
      </SectionWrapper>
    );
  }

  const autonomy = AUTONOMY_CONFIG.find((l) => l.value === data?.autonomyLevel);
  const items: { label: string; value: string }[] = [];
  if (autonomy) items.push({ label: "Autonomy Level", value: autonomy.label });
  if (data?.preferredDay) items.push({ label: "Preferred Day", value: DAY_LABELS[data.preferredDay] || data.preferredDay });
  if (data?.preferredTime) items.push({ label: "Preferred Time", value: TIME_LABELS[data.preferredTime] || data.preferredTime });

  return (
    <SectionWrapper title="Preferences" description="How Anna.I should help you">
      <div className="space-y-2.5">
        {items.length === 0 ? (
          <p className="text-xs text-[var(--anna-muted)] italic">Not set yet</p>
        ) : (
          items.map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <span className="text-xs text-[var(--anna-muted)]">{item.label}</span>
              <span className="text-xs font-medium text-[var(--anna-slate)]">{item.value}</span>
            </div>
          ))
        )}
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]" onClick={startEdit}>
            Edit
          </Button>
        </div>
      </div>
    </SectionWrapper>
  );
}

// ─── Main Export ─────────────────────────────────────────

export function HouseholdProfileSection({ profile, householdId }: ProfileSectionProps) {
  const queryClient = useQueryClient();
  const [savingSection, setSavingSection] = useState<string | null>(null);

  const saveSection = useCallback(
    async (section: string, data: Record<string, unknown>) => {
      setSavingSection(section);
      try {
        const res = await fetch(`/api/households/${householdId}/profile`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, data }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to save");
        }
        const result = await res.json();
        // Invalidate the household query so the parent re-fetches fresh data
        queryClient.invalidateQueries({ queryKey: ["household", householdId] });
        return result.household;
      } catch {
        // Error handled by section component
      } finally {
        setSavingSection(null);
      }
    },
    [householdId, queryClient]
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-[var(--anna-sage-light)] flex items-center justify-center">
          <Users size={16} className="text-[var(--anna-sage-dark)]" />
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            Household Profile
          </h3>
          <p className="text-[11px] text-[var(--anna-muted)]">
            Information from onboarding — edit anytime
          </p>
        </div>
      </div>

      <HomeSection
        data={profile.home}
        onEdit={() => {}}
        onSave={(d) => saveSection("home", d)}
        onCancel={() => {}}
        saving={savingSection === "home"}
      />
      <PeopleSection
        data={profile.people}
        onEdit={() => {}}
        onSave={(d) => saveSection("people", d)}
        onCancel={() => {}}
        saving={savingSection === "people"}
      />
      <PainPointsSection
        data={profile.painPoints}
        onEdit={() => {}}
        onSave={(d) => saveSection("painPoints", d)}
        onCancel={() => {}}
        saving={savingSection === "painPoints"}
      />
      <ServiceHabitsSection
        data={profile.serviceHabits}
        onEdit={() => {}}
        onSave={(d) => saveSection("serviceHabits", d)}
        onCancel={() => {}}
        saving={savingSection === "serviceHabits"}
      />
      <PreferencesSection
        data={profile.preferences}
        onEdit={() => {}}
        onSave={(d) => saveSection("preferences", d)}
        onCancel={() => {}}
        saving={savingSection === "preferences"}
      />
    </div>
  );
}
