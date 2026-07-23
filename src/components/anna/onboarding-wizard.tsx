"use client";

import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Home,
  Building2,
  Trees,
  Car,
  HelpCircle,
  Users,
  Baby,
  GraduationCap,
  HeartPulse,
  Dog,
  Cat,
  Bird,
  Fish,
  Clock,
  Globe,
  BrushCleaning,
  Wind,
  Wrench,
  Shirt,
  ShoppingCart,
  Handshake,
  Bell,
  Lightbulb,
  Brain,
  Rocket,
  Shield,
  Target,
  Eye,
  Zap,
  ChevronRight,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────

export interface OnboardingHousehold {
  id: string;
  name: string;
  email: string;
  phone?: string;
  address: string;
  postalCode?: string;
  unitNumber?: string;
  activeCategories: string;
  preferences?: Record<string, string> | null;
  onboardingProfile?: Record<string, unknown> | null;
  onboardingStep: number;
}

interface OnboardingWizardProps {
  household: OnboardingHousehold;
  onComplete: () => void;
}

// ─── Profile Data Types ──────────────────────────────────────────

interface HomeData {
  homeType?: string;
  homeSize?: string;
  occupants?: string;
}

interface PeopleData {
  members?: string[];
  pets?: string[];
  petTypes?: string[];
  schedule?: string;
}

interface PainPointsData {
  timeConsumingTasks?: string[];
  frustrations?: string;
}

interface ServiceHabitsData {
  categoryFrequency?: Record<string, string>; // e.g. { CLEANING: "WEEKLY", AIRCON: "QUARTERLY" }
  existingVendors?: Record<string, { name: string; phone?: string } | null>; // e.g. { CLEANING: { name: "ABC", phone: "1234" }, AIRCON: null }
  vendorGaps?: string[]; // categories where user has no vendor: ["AIRCON", "REPAIRS"]
  // DEPRECATED: frequency, findMethod — removed per user spec
}

interface PreferencesData {
  preferredLanguage?: string;
  preferredDay?: string;
  preferredTime?: string;
  autonomyLevel?: string;
}

// ─── Constants ──────────────────────────────────────────────────

const TOTAL_STEPS = 8;
const STEP_LABELS = [
  "Welcome",
  "Your Home",
  "Your People",
  "Pain Points",
  "Service Habits",
  "Preferences",
  "Meet Anna.I",
  "Your Control",
];

const HOME_TYPES = [
  { value: "HDB", label: "HDB Flat", icon: Building2, desc: "Public housing" },
  { value: "CONDO", label: "Condominium", icon: Building2, desc: "Private apartment" },
  { value: "LANDED", label: "Landed Property", icon: Trees, desc: "Detached or semi-D" },
  { value: "TERRACE", label: "Terrace House", icon: Home, desc: "Link house" },
  { value: "OTHER", label: "Other", icon: HelpCircle, desc: "Studio, dorm, etc." },
];

const HDB_SIZES = [
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

const MEMBER_TYPES = [
  { value: "ADULTS", label: "Working Adults", icon: Users },
  { value: "CHILDREN", label: "Young Children", icon: Baby },
  { value: "TEENS", label: "Teenagers", icon: GraduationCap },
  { value: "ELDERLY", label: "Elderly", icon: HeartPulse },
  { value: "PETS", label: "Pets", icon: Dog },
];

const PET_TYPES = [
  { value: "DOGS", label: "Dogs", icon: Dog },
  { value: "CATS", label: "Cats", icon: Cat },
  { value: "SMALL", label: "Small Animals", icon: Fish },
  { value: "OTHERS", label: "Others", icon: Bird },
];

const SCHEDULE_OPTIONS = [
  { value: "HOME", label: "Everyone's usually home" },
  { value: "MIXED", label: "Mixed schedule" },
  { value: "OUT", label: "Usually out during the day" },
];

const PAIN_POINT_TASKS = [
  { value: "CLEANING", label: "Cleaning & tidying", icon: BrushCleaning },
  { value: "AIRCON", label: "Air-con servicing", icon: Wind },
  { value: "REPAIRS", label: "Repairs & maintenance", icon: Wrench },
  { value: "LAUNDRY", label: "Laundry", icon: Shirt },
  { value: "PLANNING", label: "Planning & scheduling", icon: ShoppingCart },
  { value: "FINDING", label: "Finding reliable providers", icon: Handshake },
];

const CATEGORY_FREQUENCY_OPTIONS = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "FORTNIGHTLY", label: "Fortnightly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "AD_HOC", label: "Ad hoc" },
];

// FIND_METHOD_OPTIONS removed — this was marketing data, not product data (per user spec)

const LANGUAGES = [
  { value: "ENGLISH", label: "English" },
  { value: "MANDARIN", label: "Mandarin" },
  { value: "MALAY", label: "Malay" },
  { value: "TAMIL", label: "Tamil" },
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

const AUTONOMY_LEVELS = [
  {
    value: "1",
    label: "Remind me",
    desc: "Just remind me when tasks are due",
    icon: Bell,
    color: "text-[var(--anna-muted)]",
  },
  {
    value: "2",
    label: "Suggest",
    desc: "Recommend what I should do",
    icon: Lightbulb,
    color: "text-[var(--anna-sage-dark)]",
  },
  {
    value: "3",
    label: "Prepare",
    desc: "Get options ready for me to approve",
    icon: Target,
    color: "text-[var(--anna-warning)]",
  },
  {
    value: "4",
    label: "Automate",
    desc: "Handle routine decisions (with approval)",
    icon: Zap,
    color: "text-[var(--anna-sage)]",
  },
];

// ─── Animation Variants ─────────────────────────────────────────

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 60 : -60,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction < 0 ? 60 : -60,
    opacity: 0,
  }),
};

const slideTransition = {
  type: "spring" as const,
  stiffness: 300,
  damping: 30,
};

// ─── Shared: Anna.I Insight Bubble ──────────────────────────────

function AnnaInsight({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.3 }}
      className="mt-5 flex items-start gap-2.5 bg-[var(--anna-sage-light)]/40 rounded-xl p-3"
    >
      <div className="w-7 h-7 rounded-lg bg-[var(--anna-sage)] flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles size={14} className="text-white" />
      </div>
      <p className="text-xs text-[var(--anna-sage-dark)] leading-relaxed">{children}</p>
    </motion.div>
  );
}

// ─── Shared: Progress Dots ────────────────────────────────────────

function ProgressDots({ currentStep, totalSteps, labels }: { currentStep: number; totalSteps: number; labels: string[] }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-1 justify-center">
        {labels.map((_, i) => (
          <div key={i} className="flex items-center">
            <div
              className={cn(
                "h-2 rounded-full transition-all duration-500",
                i === currentStep
                  ? "w-6 bg-[var(--anna-sage)]"
                  : i < currentStep
                    ? "w-2 bg-[var(--anna-sage)]"
                    : "w-2 bg-[var(--anna-border)]"
              )}
            />
            {i < totalSteps - 1 && (
              <div
                className={cn(
                  "w-3 h-0.5 mx-0.5 transition-colors duration-500",
                  i < currentStep ? "bg-[var(--anna-sage)]" : "bg-[var(--anna-border)]"
                )}
              />
            )}
          </div>
        ))}
      </div>
      <p className="text-center text-[10px] text-[var(--anna-muted)] mt-2 font-medium">
        Step {currentStep + 1} of {totalSteps} — {labels[currentStep]}
      </p>
    </div>
  );
}

// ─── Shared: Option Card ────────────────────────────────────────

function OptionCard({
  selected,
  onClick,
  icon: Icon,
  label,
  sub,
  large,
}: {
  selected: boolean;
  onClick: () => void;
  icon?: React.ElementType;
  label: string;
  sub?: string;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-xl border transition-all duration-200 select-none",
        large ? "p-4" : "p-3",
        selected
          ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40 shadow-sm"
          : "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/30 hover:bg-[var(--anna-sage-light)]/10"
      )}
    >
      <div className="flex items-center gap-3">
        {Icon && (
          <div
            className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors",
              selected
                ? "bg-[var(--anna-sage)] text-white"
                : "bg-[var(--anna-bg)] text-[var(--anna-slate-light)]"
            )}
          >
            <Icon size={18} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className={cn("font-semibold leading-tight", large ? "text-sm" : "text-xs", "text-[var(--anna-slate)]")}>
            {label}
          </p>
          {sub && <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">{sub}</p>}
        </div>
        {selected && (
          <div className="w-5 h-5 rounded-full bg-[var(--anna-sage)] flex items-center justify-center shrink-0">
            <CheckCircle2 size={14} className="text-white" />
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Shared: Multi-Select Card ──────────────────────────────────

function MultiSelectCard({
  selected,
  onClick,
  icon: Icon,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-xl border p-3 transition-all duration-200 select-none",
        selected
          ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40 shadow-sm"
          : "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/30 hover:bg-[var(--anna-sage-light)]/10"
      )}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
            selected
              ? "bg-[var(--anna-sage)] text-white"
              : "bg-[var(--anna-bg)] text-[var(--anna-slate-light)]"
          )}
        >
          <Icon size={16} />
        </div>
        <span className="text-xs font-semibold text-[var(--anna-slate)]">{label}</span>
        {selected && <CheckCircle2 size={16} className="ml-auto text-[var(--anna-sage)]" />}
      </div>
    </button>
  );
}

// ─── Shared: Pill Select ────────────────────────────────────────

function PillSelect({
  options,
  selected,
  onSelect,
}: {
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value)}
          className={cn(
            "px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 border",
            selected === opt.value
              ? "border-[var(--anna-sage)] bg-[var(--anna-sage)] text-white"
              : "border-[var(--anna-border)] bg-[var(--anna-white)] text-[var(--anna-slate)] hover:border-[var(--anna-sage)]/30"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Shared: Navigation Footer ──────────────────────────────────

function StepNav({
  onBack,
  onContinue,
  onSkip,
  continueDisabled,
  isSaving,
  continueLabel,
}: {
  onBack?: () => void;
  onContinue: () => void;
  onSkip?: () => void;
  continueDisabled?: boolean;
  isSaving?: boolean;
  continueLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between mt-7">
      <div>
        {onBack && (
          <Button
            variant="ghost"
            onClick={onBack}
            className="rounded-xl text-sm text-[var(--anna-muted)] hover:text-[var(--anna-slate)] -ml-2"
          >
            <ArrowLeft size={14} />
            Back
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="text-[10px] text-[var(--anna-muted)] hover:text-[var(--anna-slate)] transition-colors px-2"
          >
            Skip
          </button>
        )}
        <Button
          onClick={onContinue}
          disabled={continueDisabled || isSaving}
          className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl px-6 h-11 text-sm font-semibold shadow-sm"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
          {continueLabel || "Continue"}
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 0: Welcome ────────────────────────────────────────────

function StepWelcome({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="text-center py-6">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, type: "spring" }}
        className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--anna-sage)] to-[var(--anna-sage-dark)] flex items-center justify-center mx-auto mb-6 shadow-lg"
      >
        <Sparkles size={36} className="text-white" />
      </motion.div>

      <h2 className="text-2xl font-bold text-[var(--anna-slate)] mb-2">
        Welcome to Anna.I
      </h2>
      <p className="text-sm text-[var(--anna-muted)] mb-1 max-w-sm mx-auto">
        Let&apos;s get to know your home so Anna.I can start helping right away.
      </p>
      <p className="text-xs text-[var(--anna-muted)] max-w-xs mx-auto">
        This quick chat helps Anna.I understand your household, preferences, and priorities — so it can provide personalised assistance from day one.
      </p>

      <div className="mt-8">
        <Button
          onClick={onContinue}
          className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl px-8 h-11 text-sm font-semibold shadow-sm"
        >
          Let&apos;s Get Started
          <ArrowRight size={16} />
        </Button>
      </div>

      <div className="mt-8 flex items-center justify-center gap-5 text-[10px] text-[var(--anna-muted)]">
        <span className="flex items-center gap-1">
          <Clock size={12} />
          3-5 minutes
        </span>
        <span className="flex items-center gap-1">
          <Shield size={12} />
          Data stays private
        </span>
        <span className="flex items-center gap-1">
          <Eye size={12} />
          Skip anytime
        </span>
      </div>
    </div>
  );
}

// ─── Step 1: Your Home ──────────────────────────────────────────

function StepYourHome({
  data,
  onChange,
  onContinue,
  onBack,
  onSkip,
  isSaving,
}: {
  data: HomeData;
  onChange: (field: string, value: string) => void;
  onContinue: () => void;
  onBack: () => void;
  onSkip: () => void;
  isSaving: boolean;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">What type of home do you live in?</h2>
      <p className="text-xs text-[var(--anna-muted)] mb-5">This helps Anna.I tailor recommendations to your home.</p>

      {/* Home type selection */}
      <div className="grid grid-cols-2 gap-2.5">
        {HOME_TYPES.map((t) => (
          <OptionCard
            key={t.value}
            selected={data.homeType === t.value}
            onClick={() => onChange("homeType", t.value)}
            icon={t.icon}
            label={t.label}
            sub={t.desc}
          />
        ))}
      </div>

      {/* HDB size follow-up */}
      <AnimatePresence>
        {data.homeType === "HDB" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="text-xs font-medium text-[var(--anna-slate)] mt-5 mb-2.5">What size is your flat?</p>
            <PillSelect options={HDB_SIZES} selected={data.homeSize || ""} onSelect={(v) => onChange("homeSize", v)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Occupants */}
      {data.homeType && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <p className="text-xs font-medium text-[var(--anna-slate)] mt-5 mb-2.5">How many people live in your home?</p>
          <div className="grid grid-cols-4 gap-2">
            {OCCUPANT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange("occupants", o.value)}
                className={cn(
                  "flex flex-col items-center gap-0.5 p-3 rounded-xl border transition-all duration-200",
                  data.occupants === o.value
                    ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40"
                    : "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/30"
                )}
              >
                <span className={cn("text-lg font-bold font-data", data.occupants === o.value ? "text-[var(--anna-sage)]" : "text-[var(--anna-slate)]")}>{o.label}</span>
                <span className="text-[9px] text-[var(--anna-muted)]">{o.sub}</span>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      <AnnaInsight>
        🏠 This helps me recommend the right service frequency, estimate pricing accurately, and match vendors experienced with your home type.
      </AnnaInsight>

      <StepNav
        onBack={onBack}
        onContinue={onContinue}
        onSkip={onSkip}
        continueDisabled={!data.homeType}
        isSaving={isSaving}
      />
    </div>
  );
}

// ─── Step 2: Your People ───────────────────────────────────────

function StepYourPeople({
  data,
  onChange,
  onContinue,
  onBack,
  onSkip,
  isSaving,
}: {
  data: PeopleData;
  onChange: (field: string, value: string | string[]) => void;
  onContinue: () => void;
  onBack: () => void;
  onSkip: () => void;
  isSaving: boolean;
}) {
  const toggleMember = (v: string) => {
    const current = data.members || [];
    if (v === "PETS") {
      // Toggle pets — if deselecting, clear petTypes
      if (current.includes(v)) {
        onChange("members", current.filter((m) => m !== v));
        onChange("petTypes", []);
      } else {
        onChange("members", [...current, v]);
      }
    } else {
      onChange(
        "members",
        current.includes(v) ? current.filter((m) => m !== v) : [...current, v]
      );
    }
  };

  const togglePetType = (v: string) => {
    const current = data.petTypes || [];
    onChange(
      "petTypes",
      current.includes(v) ? current.filter((t) => t !== v) : [...current, v]
    );
  };

  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">Who lives in your home?</h2>
      <p className="text-xs text-[var(--anna-muted)] mb-5">Select all that apply. This helps with service scheduling and safety.</p>

      <div className="grid grid-cols-2 gap-2.5">
        {MEMBER_TYPES.map((m) => (
          <MultiSelectCard
            key={m.value}
            selected={(data.members || []).includes(m.value)}
            onClick={() => toggleMember(m.value)}
            icon={m.icon}
            label={m.label}
          />
        ))}
      </div>

      {/* Pet types follow-up */}
      <AnimatePresence>
        {(data.members || []).includes("PETS") && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="text-xs font-medium text-[var(--anna-slate)] mt-5 mb-2.5">What kind of pets do you have?</p>
            <div className="grid grid-cols-4 gap-2">
              {PET_TYPES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => togglePetType(p.value)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all duration-200",
                    (data.petTypes || []).includes(p.value)
                      ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40"
                      : "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/30"
                  )}
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center",
                      (data.petTypes || []).includes(p.value)
                        ? "bg-[var(--anna-sage)] text-white"
                        : "bg-[var(--anna-bg)] text-[var(--anna-slate-light)]"
                    )}
                  >
                    <p.icon size={16} />
                  </div>
                  <span className="text-[10px] font-medium text-[var(--anna-slate)]">{p.label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Schedule */}
      {(data.members || []).length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <p className="text-xs font-medium text-[var(--anna-slate)] mt-5 mb-2.5">What&apos;s your household&apos;s typical schedule?</p>
          <div className="space-y-2">
            {SCHEDULE_OPTIONS.map((s) => (
              <OptionCard
                key={s.value}
                selected={data.schedule === s.value}
                onClick={() => onChange("schedule", s.value)}
                label={s.label}
              />
            ))}
          </div>
        </motion.div>
      )}

      <AnnaInsight>
        👨‍👩‍👧‍👦 I&apos;ll use this to time service visits safely and recommend kid-friendly or pet-conscious vendors when relevant.
      </AnnaInsight>

      <StepNav
        onBack={onBack}
        onContinue={onContinue}
        onSkip={onSkip}
        continueDisabled={!data.members || data.members.length === 0}
        isSaving={isSaving}
      />
    </div>
  );
}

// ─── Step 3: Pain Points ───────────────────────────────────────

function StepPainPoints({
  data,
  onChange,
  onContinue,
  onBack,
  onSkip,
  isSaving,
}: {
  data: PainPointsData;
  onChange: (field: string, value: unknown) => void;
  onContinue: () => void;
  onBack: () => void;
  onSkip: () => void;
  isSaving: boolean;
}) {
  const MAX_TASKS = 4;
  const selectedTasks = data.timeConsumingTasks || [];

  const toggleTask = (v: string) => {
    if (selectedTasks.includes(v)) {
      onChange("timeConsumingTasks", selectedTasks.filter((t) => t !== v));
    } else if (selectedTasks.length < MAX_TASKS) {
      onChange("timeConsumingTasks", [...selectedTasks, v]);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">What takes up the most of your time?</h2>
      <p className="text-xs text-[var(--anna-muted)] mb-5">Pick up to {MAX_TASKS}. This helps Anna.I focus on what matters most.</p>

      <div className="grid grid-cols-2 gap-2.5">
        {PAIN_POINT_TASKS.map((t) => {
          const isSelected = selectedTasks.includes(t.value);
          const isDisabled = !isSelected && selectedTasks.length >= MAX_TASKS;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => toggleTask(t.value)}
              disabled={isDisabled}
              className={cn(
                "w-full text-left rounded-xl border p-3.5 transition-all duration-200 select-none",
                isSelected
                  ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40 shadow-sm"
                  : isDisabled
                    ? "border-[var(--anna-border)] bg-[var(--anna-bg)] opacity-50 cursor-not-allowed"
                    : "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/30 hover:bg-[var(--anna-sage-light)]/10"
              )}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                    isSelected
                      ? "bg-[var(--anna-sage)] text-white"
                      : "bg-[var(--anna-bg)] text-[var(--anna-slate-light)]"
                  )}
                >
                  <t.icon size={16} />
                </div>
                <span className="text-xs font-semibold text-[var(--anna-slate)]">{t.label}</span>
                {isSelected && <CheckCircle2 size={16} className="ml-auto text-[var(--anna-sage)]" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Optional frustrations */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <p className="text-xs font-medium text-[var(--anna-slate)] mt-5 mb-2">
          Anything else that frustrates you? <span className="text-[var(--anna-muted)] font-normal">(optional)</span>
        </p>
        <Textarea
          value={data.frustrations || ""}
          onChange={(e) => onChange("frustrations", e.target.value)}
          placeholder="e.g. Vendors always show up late, or I never know the real price until they arrive..."
          className="border-[var(--anna-border)] bg-[var(--anna-white)] min-h-[60px] text-sm resize-none rounded-xl"
          rows={2}
        />
      </motion.div>

      <AnnaInsight>
        🎯 I&apos;ll prioritise solutions for these exact pain points and proactively suggest improvements over time.
      </AnnaInsight>

      <StepNav
        onBack={onBack}
        onContinue={onContinue}
        onSkip={onSkip}
        continueDisabled={false}
        isSaving={isSaving}
      />
    </div>
  );
}

// ─── Step 4: Service Habits (Rebuilt) ───────────────────────

// Helper: map pain point value to human-readable label
const PAIN_POINT_LABELS: Record<string, string> = {
  CLEANING: "Cleaning & tidying",
  AIRCON: "Air-con servicing",
  REPAIRS: "Repairs & maintenance",
  LAUNDRY: "Laundry",
  PLANNING: "Planning & scheduling",
  FINDING: "Finding reliable providers",
};

// Helper: map pain point value to icon
const PAIN_POINT_ICONS: Record<string, React.ElementType> = {
  CLEANING: BrushCleaning,
  AIRCON: Wind,
  REPAIRS: Wrench,
  LAUNDRY: Shirt,
  PLANNING: ShoppingCart,
  FINDING: Handshake,
};

function StepServiceHabits({
  data,
  onChange,
  onContinue,
  onBack,
  onSkip,
  isSaving,
  selectedPainPoints,
}: {
  data: ServiceHabitsData;
  onChange: (field: string, value: unknown) => void;
  onContinue: () => void;
  onBack: () => void;
  onSkip: () => void;
  isSaving: boolean;
  selectedPainPoints: string[];
}) {
  // Default to pain points if no categories selected yet
  const categories = selectedPainPoints.length > 0 ? selectedPainPoints : [];

  const categoryFrequency = data.categoryFrequency || {};
  const existingVendors = data.existingVendors || {};
  const vendorGaps = data.vendorGaps || [];

  const handleFrequencyChange = (cat: string, freq: string) => {
    onChange("categoryFrequency", { ...categoryFrequency, [cat]: freq });
  };

  const handleHasVendor = (cat: string, has: boolean) => {
    if (has) {
      // Remove from vendorGaps, set existingVendors[cat] to empty object for inline editing
      const newGaps = vendorGaps.filter((c) => c !== cat);
      onChange("vendorGaps", newGaps);
      onChange("existingVendors", { ...existingVendors, [cat]: { name: "", phone: "" } });
    } else {
      // Add to vendorGaps, remove from existingVendors
      const newVendors = { ...existingVendors };
      delete newVendors[cat];
      onChange("existingVendors", newVendors);
      if (!vendorGaps.includes(cat)) {
        onChange("vendorGaps", [...vendorGaps, cat]);
      }
    }
  };

  const handleVendorName = (cat: string, name: string) => {
    const current = existingVendors[cat] || { name: "", phone: "" };
    onChange("existingVendors", { ...existingVendors, [cat]: { ...current, name } });
  };

  const handleVendorPhone = (cat: string, phone: string) => {
    const current = existingVendors[cat] || { name: "", phone: "" };
    onChange("existingVendors", { ...existingVendors, [cat]: { ...current, phone } });
  };

  // If no pain points selected in Step 3, show a message
  if (categories.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">Your experience with home services</h2>
        <p className="text-xs text-[var(--anna-muted)] mb-5">This helps Anna.I set the right expectations for you.</p>
        <div className="text-center py-6">
          <p className="text-sm text-[var(--anna-muted)]">
            You didn&apos;t select any pain points earlier. No worries — you can always add services later from the dashboard.
          </p>
        </div>
        <StepNav onBack={onBack} onContinue={onContinue} onSkip={onSkip} continueDisabled={false} isSaving={isSaving} />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">Your experience with home services</h2>
      <p className="text-xs text-[var(--anna-muted)] mb-5">Tell us about the services you selected — frequency, and whether you already have someone.</p>

      <div className="space-y-5">
        {categories.map((cat, idx) => {
          const Icon = PAIN_POINT_ICONS[cat] || HelpCircle;
          const label = PAIN_POINT_LABELS[cat] || cat;
          const hasVendor = existingVendors[cat] !== undefined && existingVendors[cat] !== null;
          const vendorInfo = existingVendors[cat];

          return (
            <motion.div
              key={cat}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] overflow-hidden"
            >
              {/* Category header */}
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-[var(--anna-bg)]">
                <div className="w-7 h-7 rounded-lg bg-[var(--anna-sage-light)] flex items-center justify-center">
                  <Icon size={14} className="text-[var(--anna-sage-dark)]" />
                </div>
                <span className="text-xs font-semibold text-[var(--anna-slate)]">{label}</span>
              </div>

              <div className="px-3.5 py-3 space-y-3">
                {/* Frequency row */}
                <div>
                  <p className="text-[10px] font-medium text-[var(--anna-muted)] mb-1.5">How often?</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CATEGORY_FREQUENCY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleFrequencyChange(cat, opt.value)}
                        className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-medium transition-all duration-200 border",
                          categoryFrequency[cat] === opt.value
                            ? "border-[var(--anna-sage)] bg-[var(--anna-sage)] text-white"
                            : "border-[var(--anna-border)] bg-[var(--anna-white)] text-[var(--anna-slate)] hover:border-[var(--anna-sage)]/30"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Existing vendor row */}
                <div>
                  <p className="text-[10px] font-medium text-[var(--anna-muted)] mb-1.5">Do you already have someone you trust for this?</p>
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => handleHasVendor(cat, true)}
                      className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-medium transition-all duration-200 border",
                        hasVendor
                          ? "border-[var(--anna-sage)] bg-[var(--anna-sage)] text-white"
                          : "border-[var(--anna-border)] bg-[var(--anna-white)] text-[var(--anna-slate)] hover:border-[var(--anna-sage)]/30"
                      )}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => handleHasVendor(cat, false)}
                      className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-medium transition-all duration-200 border",
                        !hasVendor
                          ? "border-[var(--anna-sage)] bg-[var(--anna-sage)] text-white"
                          : "border-[var(--anna-border)] bg-[var(--anna-white)] text-[var(--anna-slate)] hover:border-[var(--anna-sage)]/30"
                      )}
                    >
                      Not yet
                    </button>
                  </div>

                  {/* Inline vendor name + phone (revealed on Yes) */}
                  <AnimatePresence>
                    {hasVendor && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="flex gap-2 pt-1">
                          <input
                            type="text"
                            placeholder="Provider name"
                            value={vendorInfo?.name || ""}
                            onChange={(e) => handleVendorName(cat, e.target.value)}
                            className="flex-1 h-8 text-[11px] rounded-lg border border-[var(--anna-border)] bg-[var(--anna-white)] px-2.5 placeholder:text-[var(--anna-muted)] focus:outline-none focus:border-[var(--anna-sage)]"
                          />
                          <input
                            type="text"
                            placeholder="Phone (optional)"
                            value={vendorInfo?.phone || ""}
                            onChange={(e) => handleVendorPhone(cat, e.target.value)}
                            className="w-32 h-8 text-[11px] rounded-lg border border-[var(--anna-border)] bg-[var(--anna-white)] px-2.5 placeholder:text-[var(--anna-muted)] focus:outline-none focus:border-[var(--anna-sage)]"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* No vendor tag */}
                  <AnimatePresence>
                    {!hasVendor && vendorGaps.includes(cat) && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="pt-1"
                      >
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--anna-warning)]/10 text-[9px] font-medium text-[var(--anna-warning)]">
                          <Sparkles size={9} />
                          Anna.I will help you find one
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <AnnaInsight>
        🤝 This helps me match you with providers you already trust, or find great ones where you don&apos;t have one yet.
      </AnnaInsight>

      <StepNav
        onBack={onBack}
        onContinue={onContinue}
        onSkip={onSkip}
        continueDisabled={false}
        isSaving={isSaving}
      />
    </div>
  );
}

// ─── Step 5: Preferences & Autonomy ───────────────────────────

function StepPreferences({
  data,
  onChange,
  onContinue,
  onBack,
  isSaving,
}: {
  data: PreferencesData;
  onChange: (field: string, value: string) => void;
  onContinue: () => void;
  onBack: () => void;
  isSaving: boolean;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">How would you like Anna.I to help?</h2>
      <p className="text-xs text-[var(--anna-muted)] mb-5">Almost done! A few preferences, then we&apos;ll introduce you to Anna.I.</p>

      {/* Autonomy level first — it's the most important */}
      <div className="mb-6">
        <p className="text-xs font-medium text-[var(--anna-slate)] mb-2.5">How involved should Anna.I be?</p>
        <div className="space-y-2.5">
          {AUTONOMY_LEVELS.map((level, idx) => {
            const isSelected = data.autonomyLevel === level.value;
            return (
              <motion.button
                key={level.value}
                type="button"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                onClick={() => onChange("autonomyLevel", level.value)}
                className={cn(
                  "w-full text-left rounded-xl border p-3.5 transition-all duration-200 select-none",
                  isSelected
                    ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40 shadow-sm"
                    : "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/30 hover:bg-[var(--anna-sage-light)]/10"
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                      isSelected ? "bg-[var(--anna-sage)] text-white" : `bg-[var(--anna-bg)] ${level.color}`
                    )}
                  >
                    <level.icon size={20} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-[var(--anna-slate)]">{level.label}</p>
                    <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">{level.desc}</p>
                  </div>
                  {isSelected && (
                    <div className="w-6 h-6 rounded-full bg-[var(--anna-sage)] flex items-center justify-center shrink-0">
                      <CheckCircle2 size={14} className="text-white" />
                    </div>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
        <p className="text-[10px] text-[var(--anna-muted)] mt-2 flex items-center gap-1">
          <Shield size={10} />
          You can always change this later in Settings.
        </p>
      </div>

      {/* Language / Day / Time preferences */}
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2.5">
          <div>
            <p className="text-[10px] font-medium text-[var(--anna-muted)] mb-1.5">
              <Globe size={10} className="inline mr-1" />
              Language
            </p>
            <PillSelect options={LANGUAGES} selected={data.preferredLanguage || "ENGLISH"} onSelect={(v) => onChange("preferredLanguage", v)} />
          </div>
          <div>
            <p className="text-[10px] font-medium text-[var(--anna-muted)] mb-1.5">
              <Clock size={10} className="inline mr-1" />
              Day
            </p>
            <PillSelect options={DAY_OPTIONS} selected={data.preferredDay || "ANY"} onSelect={(v) => onChange("preferredDay", v)} />
          </div>
          <div>
            <p className="text-[10px] font-medium text-[var(--anna-muted)] mb-1.5">
              <Clock size={10} className="inline mr-1" />
              Time
            </p>
            <PillSelect options={TIME_OPTIONS} selected={data.preferredTime || "FLEXIBLE"} onSelect={(v) => onChange("preferredTime", v)} />
          </div>
        </div>
      </div>

      <AnnaInsight>
        ⚙️ Your autonomy preference is Anna.I&apos;s starting point. As trust builds, you can increase or decrease automation anytime.
      </AnnaInsight>

      <StepNav
        onBack={onBack}
        onContinue={onContinue}
        continueDisabled={!data.autonomyLevel}
        isSaving={isSaving}
      />
    </div>
  );
}

// ─── Step 6: Meet Anna.I ──────────────────────────────────────

function StepMeetAnna({
  onContinue,
  onBack,
}: {
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="text-center mb-6">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, type: "spring" }}
          className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--anna-sage)] to-[var(--anna-sage-dark)] flex items-center justify-center mx-auto mb-4 shadow-lg"
        >
          <Brain size={28} className="text-white" />
        </motion.div>
        <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">Meet Anna.I</h2>
        <p className="text-xs text-[var(--anna-muted)] max-w-sm mx-auto">
          Your household AI assistant. Anna.I gets smarter by understanding your home, your routines, and your preferences.
        </p>
      </div>

      {/* Before/After comparison */}
      <div className="space-y-3 mb-5">
        <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="w-6 h-6 rounded-full bg-[var(--anna-error)]/10 flex items-center justify-center">
              <span className="text-[10px]">❌</span>
            </div>
            <p className="text-xs font-semibold text-[var(--anna-slate)]">Before Anna.I</p>
          </div>
          <div className="space-y-1.5 text-[11px] text-[var(--anna-muted)] pl-8">
            <p className="italic">&quot;My air-con is making a weird noise.&quot;</p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {["Search Google", "Read reviews", "Message 3 vendors", "Compare quotes", "Schedule appointment", "Wait..."].map((s) => (
                <span key={s} className="px-2 py-0.5 rounded-md bg-white text-[9px] text-[var(--anna-muted)] border border-[var(--anna-border)]">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border-2 border-[var(--anna-sage)]/30 bg-gradient-to-br from-[var(--anna-sage-light)]/30 to-[var(--anna-white)] p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="w-6 h-6 rounded-full bg-[var(--anna-sage)] flex items-center justify-center">
              <Sparkles size={12} className="text-white" />
            </div>
            <p className="text-xs font-semibold text-[var(--anna-sage-dark)]">With Anna.I</p>
          </div>
          <div className="space-y-1.5 pl-8">
            <div className="flex items-start gap-2">
              <MessageCircle size={12} className="text-[var(--anna-sage)] shrink-0 mt-0.5" />
              <p className="text-[11px] text-[var(--anna-slate)] italic">
                &quot;I noticed your air-con service is due based on your 6-month schedule. I found 3 top-rated options nearby. Want me to book one?&quot;
              </p>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Button size="sm" className="h-7 text-[10px] rounded-lg bg-[var(--anna-sage)] text-white px-3">
                Book the best match
                <ChevronRight size={10} />
              </Button>
              <span className="text-[9px] text-[var(--anna-muted)]">One tap. Done.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Trust note */}
      <div className="flex items-start gap-2 bg-[var(--anna-sage-light)]/40 rounded-xl p-3">
        <Shield size={14} className="text-[var(--anna-sage-dark)] shrink-0 mt-0.5" />
        <p className="text-[10px] text-[var(--anna-sage-dark)] leading-relaxed">
          Anna.I learns from your household patterns. All recommendations are always reviewed by you. No automatic charges, no surprises.
        </p>
      </div>

      <StepNav
        onBack={onBack}
        onContinue={onContinue}
        continueLabel="See how it works"
      />
    </div>
  );
}

// ─── Step 7: Your AI, Your Control ────────────────────────────

function StepYourControl({
  onContinue,
  onBack,
}: {
  onContinue: () => void;
  onBack: () => void;
}) {
  const timeline = [
    {
      phase: "Week 1",
      label: "Learning",
      desc: "Anna.I observes your preferences, booking patterns, and vendor interactions.",
      icon: Eye,
      color: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]",
      dotColor: "bg-[var(--anna-sage)]",
    },
    {
      phase: "Month 1",
      label: "Suggesting",
      desc: "Anna.I starts recommending better routines, timing, and vendor matches.",
      icon: Lightbulb,
      color: "bg-[var(--anna-warning)]/10 text-[var(--anna-warning)]",
      dotColor: "bg-[var(--anna-warning)]",
    },
    {
      phase: "Month 3+",
      label: "Assisting",
      desc: "Anna.I proactively manages recurring tasks — always with your approval.",
      icon: Rocket,
      color: "bg-[var(--anna-sage)]/10 text-[var(--anna-sage)]",
      dotColor: "bg-[var(--anna-sage)]",
    },
    {
      phase: "Always",
      label: "Your Control",
      desc: "You approve every important decision. Adjust or pause automation anytime.",
      icon: Shield,
      color: "bg-[var(--anna-slate-light)]/10 text-[var(--anna-slate)]",
      dotColor: "bg-[var(--anna-slate)]",
    },
  ];

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">Your AI, Your Control</h2>
        <p className="text-xs text-[var(--anna-muted)] max-w-sm mx-auto">
          Anna.I starts simple and grows with you. Automation increases gradually — and only with your trust.
        </p>
      </div>

      {/* Timeline */}
      <div className="space-y-0 mb-6">
        {timeline.map((item, idx) => (
          <motion.div
            key={item.phase}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="flex gap-3"
          >
            {/* Timeline track */}
            <div className="flex flex-col items-center">
              <div className={cn("w-3 h-3 rounded-full shrink-0 mt-1", item.dotColor)} />
              {idx < timeline.length - 1 && (
                <div className="w-0.5 flex-1 bg-[var(--anna-border)] min-h-[40px]" />
              )}
            </div>

            {/* Content */}
            <div className={cn("rounded-xl p-3 flex-1 mb-3", item.color)}>
              <div className="flex items-center gap-2 mb-1">
                <item.icon size={14} />
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">{item.phase}</span>
                <span className="text-xs font-bold">{item.label}</span>
              </div>
              <p className="text-[10px] leading-relaxed opacity-80">{item.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Autonomy ladder summary */}
      <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--anna-muted)] mb-3">The Autonomy Journey</p>
        <div className="flex items-center justify-between">
          {AUTONOMY_LEVELS.map((level, idx) => (
            <div key={level.value} className="flex items-center gap-1">
              <div className="flex flex-col items-center gap-1">
                <div className="w-8 h-8 rounded-lg bg-[var(--anna-bg)] flex items-center justify-center">
                  <level.icon size={14} className="text-[var(--anna-slate-light)]" />
                </div>
                <span className="text-[8px] text-[var(--anna-muted)] font-medium">{level.label}</span>
              </div>
              {idx < AUTONOMY_LEVELS.length - 1 && (
                <ChevronRight size={12} className="text-[var(--anna-border)] mx-1" />
              )}
            </div>
          ))}
        </div>
      </div>

      <StepNav
        onBack={onBack}
        onContinue={onContinue}
        continueLabel="Got it, let's go!"
      />
    </div>
  );
}

// ─── Step 8: Completion ───────────────────────────────────────

function CompletionScreen() {
  return (
    <div className="text-center py-10">
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
      >
        <div className="w-20 h-20 rounded-full bg-[var(--anna-sage)] flex items-center justify-center mx-auto mb-6 shadow-lg">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.3 }}
          >
            <CheckCircle2 size={40} className="text-white" />
          </motion.div>
        </div>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="text-xl font-bold text-[var(--anna-slate)] mb-2"
      >
        You&apos;re all set!
      </motion.h2>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="text-sm text-[var(--anna-muted)] mb-1"
      >
        Anna.I now understands your home and preferences.
      </motion.p>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="text-xs text-[var(--anna-sage-dark)]"
      >
        The more you use Anna.I, the smarter it gets.
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-6"
      >
        <Loader2 size={16} className="text-[var(--anna-muted)] animate-spin mx-auto" />
        <p className="text-[10px] text-[var(--anna-muted)] mt-2">
          Taking you to your dashboard...
        </p>
      </motion.div>
    </div>
  );
}

// ─── Phase Divider ─────────────────────────────────────────────

function PhaseDivider() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center py-4"
    >
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--anna-sage-light)]/40">
        <CheckCircle2 size={14} className="text-[var(--anna-sage)]" />
        <span className="text-xs font-semibold text-[var(--anna-sage-dark)]">Great! Now let&apos;s meet Anna.I</span>
      </div>
    </motion.div>
  );
}

// ─── Main Onboarding Wizard ────────────────────────────────────

export function OnboardingWizard({ household, onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(() =>
    Math.max(0, Math.min(household.onboardingStep, TOTAL_STEPS - 1))
  );
  const [direction, setDirection] = useState(1);
  const [isCompleted, setIsCompleted] = useState(false);

  // Parse existing onboarding profile
  const profile = (household.onboardingProfile as Record<string, Record<string, unknown>>) || {};

  // ── Form state (initialise from existing profile) ──
  const [homeData, setHomeData] = useState<HomeData>((profile.home as HomeData) || {});
  const [peopleData, setPeopleData] = useState<PeopleData>((profile.people as PeopleData) || {});
  const [painPointsData, setPainPointsData] = useState<PainPointsData>((profile.painPoints as PainPointsData) || {});
  const [serviceHabitsData, setServiceHabitsData] = useState<ServiceHabitsData>((profile.serviceHabits as ServiceHabitsData) || {});
  const [prefsData, setPrefsData] = useState<PreferencesData>((profile.preferences as PreferencesData) || {});

  // PATCH mutation
  const saveMutation = useMutation({
    mutationFn: async ({ step, data }: { step: number; data: Record<string, unknown> }) => {
      const res = await fetch("/api/household/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, data }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Failed to save step");
      }
      return res.json();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Something went wrong. Please try again.");
    },
  });

  const goNext = useCallback(() => {
    setDirection(1);
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }, []);

  const goBack = useCallback(() => {
    setDirection(-1);
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  const skipToNext = useCallback(() => {
    // Skip without saving data, just advance
    goNext();
  }, [goNext]);

  // Step handlers: save then advance
  const handleStep1 = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({ step: 1, data: homeData });
      goNext();
    } catch { /* handled in onError */ }
  }, [homeData, saveMutation, goNext]);

  const handleStep2 = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({ step: 2, data: peopleData });
      goNext();
    } catch { /* handled in onError */ }
  }, [peopleData, saveMutation, goNext]);

  const handleStep3 = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({ step: 3, data: painPointsData });
      goNext();
    } catch { /* handled in onError */ }
  }, [painPointsData, saveMutation, goNext]);

  const handleStep4 = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({ step: 4, data: serviceHabitsData });
      goNext();
    } catch { /* handled in onError */ }
  }, [serviceHabitsData, saveMutation, goNext]);

  const handleStep5 = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({ step: 5, data: prefsData });
      goNext();
    } catch { /* handled in onError */ }
  }, [prefsData, saveMutation, goNext]);

  // Steps 6 and 7 just advance (no data to save)
  const handleStep6 = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({ step: 6, data: {} });
      goNext();
    } catch { /* handled in onError */ }
  }, [saveMutation, goNext]);

  const handleStep7 = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({ step: 7, data: {} });
      // Complete onboarding
      await saveMutation.mutateAsync({ step: 8, data: {} });
      setIsCompleted(true);
      setTimeout(() => onComplete(), 2000);
    } catch { /* handled in onError */ }
  }, [saveMutation, onComplete]);

  // Show completion screen
  if (isCompleted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--anna-bg)]">
        <div className="w-full max-w-lg">
          <CompletionScreen />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-start bg-[var(--anna-bg)] p-4 md:p-6">
      <div className="w-full max-w-lg pt-4 md:pt-8">
        {/* Logo / Brand */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--anna-sage)] to-[var(--anna-sage-dark)] flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <span className="text-sm font-bold text-[var(--anna-slate)]">Anna.I</span>
        </div>

        {/* Progress */}
        {currentStep > 0 && <ProgressDots currentStep={currentStep} totalSteps={TOTAL_STEPS} labels={STEP_LABELS} />}

        {/* Phase divider between Get to Know You and Meet Anna.I */}
        <AnimatePresence>
          {currentStep === 5 && <PhaseDivider />}
        </AnimatePresence>

        {/* Step card */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-5 md:p-6 shadow-sm overflow-hidden">
          <AnimatePresence initial={false} custom={direction} mode="wait">
            <motion.div
              key={currentStep}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={slideTransition}
            >
              {currentStep === 0 && <StepWelcome onContinue={goNext} />}
              {currentStep === 1 && (
                <StepYourHome
                  data={homeData}
                  onChange={(field, value) => setHomeData((p) => ({ ...p, [field]: value }))}
                  onContinue={handleStep1}
                  onBack={goBack}
                  onSkip={skipToNext}
                  isSaving={saveMutation.isPending}
                />
              )}
              {currentStep === 2 && (
                <StepYourPeople
                  data={peopleData}
                  onChange={(field, value) => setPeopleData((p) => ({ ...p, [field]: value }))}
                  onContinue={handleStep2}
                  onBack={goBack}
                  onSkip={skipToNext}
                  isSaving={saveMutation.isPending}
                />
              )}
              {currentStep === 3 && (
                <StepPainPoints
                  data={painPointsData}
                  onChange={(field, value) => setPainPointsData((p) => ({ ...p, [field]: value }))}
                  onContinue={handleStep3}
                  onBack={goBack}
                  onSkip={skipToNext}
                  isSaving={saveMutation.isPending}
                />
              )}
              {currentStep === 4 && (
                <StepServiceHabits
                  data={serviceHabitsData}
                  onChange={(field, value) => setServiceHabitsData((p) => ({ ...p, [field]: value }))}
                  onContinue={handleStep4}
                  onBack={goBack}
                  onSkip={skipToNext}
                  isSaving={saveMutation.isPending}
                  selectedPainPoints={painPointsData.timeConsumingTasks || []}
                />
              )}
              {currentStep === 5 && (
                <StepPreferences
                  data={prefsData}
                  onChange={(field, value) => setPrefsData((p) => ({ ...p, [field]: value }))}
                  onContinue={handleStep5}
                  onBack={goBack}
                  isSaving={saveMutation.isPending}
                />
              )}
              {currentStep === 6 && (
                <StepMeetAnna onContinue={handleStep6} onBack={goBack} />
              )}
              {currentStep === 7 && (
                <StepYourControl onContinue={handleStep7} onBack={goBack} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-[var(--anna-muted)] mt-6">
          Anna.I — The Operating System for the Modern Household
        </p>
      </div>
    </div>
  );
}
