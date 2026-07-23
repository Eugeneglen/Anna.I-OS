"use client";

import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Sparkles,
  Shirt,
  Fan,
  Droplets,
  Zap,
  Paintbrush,
  Bug,
  Wrench,
  KeyRound,
  Plug,
  Home,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Phone,
  Mail,
  MapPin,
  Hash,
  Clock,
  Globe,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ServiceCategory } from "@/lib/types";

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
  onboardingStep: number;
}

interface OnboardingWizardProps {
  household: OnboardingHousehold;
  onComplete: () => void;
}

// ─── Constants ──────────────────────────────────────────────────

const TOTAL_STEPS = 5;

const STEP_LABELS = ["Welcome", "Profile", "Address", "Services", "Preferences"];

const CATEGORIES: {
  key: ServiceCategory;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  { key: "CLEANING", label: "Cleaning", description: "Regular & deep cleaning", icon: Sparkles },
  { key: "LAUNDRY", label: "Laundry", description: "Wash, fold & dry clean", icon: Shirt },
  { key: "AIRCON", label: "Aircon", description: "Service & gas top-up", icon: Fan },
  { key: "PLUMBING", label: "Plumbing", description: "Unclogging & repairs", icon: Droplets },
  { key: "ELECTRICAL", label: "Electrical", description: "Wiring & fixtures", icon: Zap },
  { key: "PAINTING", label: "Painting", description: "Touch-up & full repaint", icon: Paintbrush },
  { key: "PEST_CONTROL", label: "Pest Control", description: "Cockroach, mosquito & termite", icon: Bug },
  { key: "HANDYMAN", label: "Handyman", description: "Assembly & mounting", icon: Wrench },
  { key: "LOCKSMITH", label: "Locksmith", description: "Unlock & lock changes", icon: KeyRound },
  { key: "APPLIANCE_REPAIR", label: "Appliance Repair", description: "Diagnosis & fix", icon: Plug },
];

const DAYS_OF_WEEK = [
  { value: "ANY", label: "Any Day" },
  { value: "MONDAY", label: "Monday" },
  { value: "TUESDAY", label: "Tuesday" },
  { value: "WEDNESDAY", label: "Wednesday" },
  { value: "THURSDAY", label: "Thursday" },
  { value: "FRIDAY", label: "Friday" },
  { value: "SATURDAY", label: "Saturday" },
  { value: "SUNDAY", label: "Sunday" },
];

const TIME_PREFERENCES = [
  { value: "ANY", label: "Any Time" },
  { value: "MORNING", label: "Morning" },
  { value: "AFTERNOON", label: "Afternoon" },
  { value: "EVENING", label: "Evening" },
];

const LANGUAGES = [
  { value: "ENGLISH", label: "English" },
  { value: "MANDARIN", label: "Mandarin" },
  { value: "MALAY", label: "Malay" },
  { value: "TAMIL", label: "Tamil" },
];

// ─── Animation Variants ─────────────────────────────────────────

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 80 : -80,
    opacity: 0,
  }),
};

const slideTransition = {
  type: "spring" as const,
  stiffness: 300,
  damping: 30,
};

const successVariants = {
  initial: { scale: 0, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: { type: "spring", stiffness: 200, damping: 15, delay: 0.1 },
  },
};

// ─── Progress Bar ───────────────────────────────────────────────

function ProgressBar({ currentStep }: { currentStep: number }) {
  return (
    <div className="mb-6" role="progressbar" aria-valuenow={currentStep} aria-valuemin={0} aria-valuemax={TOTAL_STEPS} aria-label={`Step ${currentStep + 1} of ${TOTAL_STEPS}`}>
      {/* Step dots */}
      <div className="flex items-center justify-between mb-2">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex flex-col items-center gap-1 flex-1">
            <div
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300",
                i < currentStep
                  ? "bg-[var(--anna-sage)] text-white"
                  : i === currentStep
                    ? "bg-[var(--anna-sage)] text-white ring-4 ring-[var(--anna-sage-light)]"
                    : "bg-[var(--anna-border)] text-[var(--anna-muted)]"
              )}
            >
              {i < currentStep ? (
                <CheckCircle2 size={14} />
              ) : (
                i + 1
              )}
            </div>
            <span
              className={cn(
                "text-[9px] font-medium hidden sm:block transition-colors",
                i <= currentStep ? "text-[var(--anna-sage-dark)]" : "text-[var(--anna-muted)]"
              )}
            >
              {label}
            </span>
          </div>
        ))}
      </div>
      {/* Track bar */}
      <div className="h-1.5 bg-[var(--anna-border)] rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-[var(--anna-sage)] rounded-full"
          initial={false}
          animate={{ width: `${((currentStep) / (TOTAL_STEPS - 1)) * 100}%` }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        />
      </div>
    </div>
  );
}

// ─── Step 1: Welcome ───────────────────────────────────────────

function StepWelcome({
  householdName,
  onContinue,
}: {
  householdName: string;
  onContinue: () => void;
}) {
  return (
    <div className="text-center py-8">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, type: "spring" }}
        className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--anna-sage)] to-[var(--anna-sage-dark)] flex items-center justify-center mx-auto mb-6 shadow-lg"
      >
        <Home size={36} className="text-white" />
      </motion.div>

      <h2 className="text-2xl font-bold text-[var(--anna-slate)] mb-2">
        Welcome to Anna.I
      </h2>
      <p className="text-[var(--anna-muted)] text-sm mb-1">
        Let&apos;s set up your household in a few quick steps.
      </p>
      {householdName && (
        <p className="text-xs font-data text-[var(--anna-sage-dark)] bg-[var(--anna-sage-light)] px-3 py-1 rounded-full inline-block mt-3 mb-8">
          {householdName}
        </p>
      )}

      <div className="mt-8">
        <Button
          onClick={onContinue}
          className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl px-8 h-11 text-sm font-semibold shadow-sm"
        >
          Get Started
          <ArrowRight size={16} />
        </Button>
      </div>

      <div className="mt-10 flex items-center justify-center gap-6 text-[10px] text-[var(--anna-muted)]">
        <span className="flex items-center gap-1"><CheckCircle2 size={12} /> Quick setup</span>
        <span className="flex items-center gap-1"><CheckCircle2 size={12} /> 5 easy steps</span>
        <span className="flex items-center gap-1"><CheckCircle2 size={12} /> Takes 2 minutes</span>
      </div>
    </div>
  );
}

// ─── Step 2: Profile ────────────────────────────────────────────

function StepProfile({
  formData,
  onChange,
  onContinue,
  onBack,
  isSaving,
}: {
  formData: { name: string; phone: string; email: string };
  onChange: (field: string, value: string) => void;
  onContinue: () => void;
  onBack: () => void;
  isSaving: boolean;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">
        Your Profile
      </h2>
      <p className="text-xs text-[var(--anna-muted)] mb-6">
        Let us know how to reach your household.
      </p>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="onb-name" className="text-xs font-medium text-[var(--anna-slate)]">
            Household Name <span className="text-[var(--anna-error)]">*</span>
          </Label>
          <div className="relative">
            <Home size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)]" />
            <Input
              id="onb-name"
              value={formData.name}
              onChange={(e) => onChange("name", e.target.value)}
              placeholder="e.g. Smith Residence"
              className="pl-9 border-[var(--anna-border)] bg-[var(--anna-white)]"
              required
              aria-required="true"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="onb-phone" className="text-xs font-medium text-[var(--anna-slate)]">
            Phone Number <span className="text-[var(--anna-muted)]">(optional)</span>
          </Label>
          <div className="relative">
            <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)]" />
            <Input
              id="onb-phone"
              value={formData.phone}
              onChange={(e) => onChange("phone", e.target.value)}
              placeholder="+65 9XXX XXXX"
              className="pl-9 border-[var(--anna-border)] bg-[var(--anna-white)]"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="onb-email" className="text-xs font-medium text-[var(--anna-slate)]">
            Household Email <span className="text-[var(--anna-muted)]">(read-only)</span>
          </Label>
          <div className="relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)]" />
            <Input
              id="onb-email"
              value={formData.email}
              readOnly
              className="pl-9 border-[var(--anna-border)] bg-[var(--anna-bg)] text-[var(--anna-slate-light)] cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end mt-8 gap-3">
        <Button
          variant="ghost"
          onClick={onBack}
          className="rounded-xl text-sm text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
        >
          <ArrowLeft size={14} />
          Back
        </Button>
        <Button
          onClick={onContinue}
          disabled={!formData.name.trim() || isSaving}
          className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl px-6 text-sm font-semibold"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
          Continue
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 3: Address ────────────────────────────────────────────

function StepAddress({
  formData,
  onChange,
  onContinue,
  onBack,
  isSaving,
}: {
  formData: { address: string; postalCode: string; unitNumber: string };
  onChange: (field: string, value: string) => void;
  onContinue: () => void;
  onBack: () => void;
  isSaving: boolean;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">
        Your Address
      </h2>
      <p className="text-xs text-[var(--anna-muted)] mb-6">
        Where should our service vendors go?
      </p>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="onb-address" className="text-xs font-medium text-[var(--anna-slate)]">
            Address / Estate Name <span className="text-[var(--anna-error)]">*</span>
          </Label>
          <div className="relative">
            <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)]" />
            <Input
              id="onb-address"
              value={formData.address}
              onChange={(e) => onChange("address", e.target.value)}
              placeholder="e.g. 123 Orchard Road, The Sail"
              className="pl-9 border-[var(--anna-border)] bg-[var(--anna-white)]"
              required
              aria-required="true"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="onb-postal" className="text-xs font-medium text-[var(--anna-slate)]">
              Postal Code <span className="text-[var(--anna-muted)]">(optional)</span>
            </Label>
            <div className="relative">
              <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)]" />
              <Input
                id="onb-postal"
                value={formData.postalCode}
                onChange={(e) => onChange("postalCode", e.target.value)}
                placeholder="e.g. 238888"
                className="pl-9 border-[var(--anna-border)] bg-[var(--anna-white)]"
                maxLength={6}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="onb-unit" className="text-xs font-medium text-[var(--anna-slate)]">
              Unit Number <span className="text-[var(--anna-muted)]">(optional)</span>
            </Label>
            <div className="relative">
              <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)]" />
              <Input
                id="onb-unit"
                value={formData.unitNumber}
                onChange={(e) => onChange("unitNumber", e.target.value)}
                placeholder="e.g. #12-34"
                className="pl-9 border-[var(--anna-border)] bg-[var(--anna-white)]"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end mt-8 gap-3">
        <Button
          variant="ghost"
          onClick={onBack}
          className="rounded-xl text-sm text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
        >
          <ArrowLeft size={14} />
          Back
        </Button>
        <Button
          onClick={onContinue}
          disabled={!formData.address.trim() || isSaving}
          className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl px-6 text-sm font-semibold"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
          Continue
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 4: Services ───────────────────────────────────────────

function StepServices({
  selectedCategories,
  onToggle,
  onContinue,
  onBack,
  isSaving,
}: {
  selectedCategories: string[];
  onToggle: (category: string) => void;
  onContinue: () => void;
  onBack: () => void;
  isSaving: boolean;
}) {
  const hasSelection = selectedCategories.length > 0;

  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">
        Services You Need
      </h2>
      <p className="text-xs text-[var(--anna-muted)] mb-6">
        Select at least one service category. You can change this later.
      </p>

      <div className="grid grid-cols-2 gap-3 max-h-72 overflow-y-auto anna-scroll pr-1">
        {CATEGORIES.map((cat) => {
          const isSelected = selectedCategories.includes(cat.key);
          const Icon = cat.icon;
          return (
            <button
              type="button"
              key={cat.key}
              onClick={() => onToggle(cat.key)}
              aria-pressed={isSelected}
              className={cn(
                "relative text-left rounded-xl border p-3 transition-all duration-200 select-none",
                isSelected
                  ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40 shadow-sm"
                  : "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/40 hover:bg-[var(--anna-sage-light)]/10"
              )}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggle(cat.key)}
                className="absolute top-3 right-3"
                aria-label={`Select ${cat.label}`}
              />
              <div className="flex items-start gap-2.5 pr-6">
                <div
                  className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                    isSelected
                      ? "bg-[var(--anna-sage)] text-white"
                      : "bg-[var(--anna-bg)] text-[var(--anna-slate-light)]"
                  )}
                >
                  <Icon size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[var(--anna-slate)] leading-tight">
                    {cat.label}
                  </p>
                  <p className="text-[10px] text-[var(--anna-muted)] mt-0.5 leading-tight">
                    {cat.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {!hasSelection && (
        <p className="text-[10px] text-[var(--anna-error)] mt-2 text-center">
          Please select at least one service category.
        </p>
      )}

      <div className="flex justify-end mt-8 gap-3">
        <Button
          variant="ghost"
          onClick={onBack}
          className="rounded-xl text-sm text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
        >
          <ArrowLeft size={14} />
          Back
        </Button>
        <Button
          onClick={onContinue}
          disabled={!hasSelection || isSaving}
          className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl px-6 text-sm font-semibold"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
          Continue
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 5: Preferences ────────────────────────────────────────

function StepPreferences({
  formData,
  onChange,
  onComplete,
  onBack,
  isSaving,
}: {
  formData: {
    preferredDay: string;
    preferredTime: string;
    preferredLanguage: string;
    notes: string;
  };
  onChange: (field: string, value: string) => void;
  onComplete: () => void;
  onBack: () => void;
  isSaving: boolean;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--anna-slate)] mb-1">
        Your Preferences
      </h2>
      <p className="text-xs text-[var(--anna-muted)] mb-6">
        Help us match you with the right service vendors.
      </p>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs font-medium text-[var(--anna-slate)]">
              <Clock size={12} className="inline mr-1.5 text-[var(--anna-muted)]" />
              Preferred Day
            </Label>
            <Select value={formData.preferredDay} onValueChange={(v) => onChange("preferredDay", v)}>
              <SelectTrigger className="border-[var(--anna-border)] bg-[var(--anna-white)] text-sm">
                <SelectValue placeholder="Select day" />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OF_WEEK.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-[var(--anna-slate)]">
              <Clock size={12} className="inline mr-1.5 text-[var(--anna-muted)]" />
              Preferred Time
            </Label>
            <Select value={formData.preferredTime} onValueChange={(v) => onChange("preferredTime", v)}>
              <SelectTrigger className="border-[var(--anna-border)] bg-[var(--anna-white)] text-sm">
                <SelectValue placeholder="Select time" />
              </SelectTrigger>
              <SelectContent>
                {TIME_PREFERENCES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-medium text-[var(--anna-slate)]">
            <Globe size={12} className="inline mr-1.5 text-[var(--anna-muted)]" />
            Preferred Language
          </Label>
          <Select value={formData.preferredLanguage} onValueChange={(v) => onChange("preferredLanguage", v)}>
            <SelectTrigger className="border-[var(--anna-border)] bg-[var(--anna-white)] text-sm">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="onb-notes" className="text-xs font-medium text-[var(--anna-slate)]">
            <FileText size={12} className="inline mr-1.5 text-[var(--anna-muted)]" />
            Special Notes / Instructions <span className="text-[var(--anna-muted)]">(optional)</span>
          </Label>
          <Textarea
            id="onb-notes"
            value={formData.notes}
            onChange={(e) => onChange("notes", e.target.value)}
            placeholder="e.g. Prefer vendors who can speak Mandarin, gate code is 1234, etc."
            className="border-[var(--anna-border)] bg-[var(--anna-white)] min-h-[80px] text-sm resize-none"
            rows={3}
          />
        </div>
      </div>

      <div className="flex justify-end mt-8 gap-3">
        <Button
          variant="ghost"
          onClick={onBack}
          className="rounded-xl text-sm text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
        >
          <ArrowLeft size={14} />
          Back
        </Button>
        <Button
          onClick={onComplete}
          disabled={isSaving}
          className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl px-6 text-sm font-semibold"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
          Complete Setup
          <CheckCircle2 size={14} />
        </Button>
      </div>
    </div>
  );
}

// ─── Completion Screen ──────────────────────────────────────────

function CompletionScreen() {
  return (
    <div className="text-center py-10">
      <motion.div {...successVariants}>
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
        Your household is all set!
      </motion.h2>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="text-sm text-[var(--anna-muted)]"
      >
        Let&apos;s get started.
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="mt-6"
      >
        <Loader2 size={16} className="text-[var(--anna-muted)] animate-spin mx-auto" />
        <p className="text-[10px] text-[var(--anna-muted)] mt-2">
          Redirecting to dashboard...
        </p>
      </motion.div>
    </div>
  );
}

// ─── Main Onboarding Wizard ────────────────────────────────────

export function OnboardingWizard({ household, onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(() =>
    Math.max(0, Math.min(household.onboardingStep, TOTAL_STEPS - 1))
  );
  const [direction, setDirection] = useState(1);
  const [isCompleted, setIsCompleted] = useState(false);

  // Parse existing active categories
  const initialCategories = (() => {
    try {
      const raw = household.activeCategories;
      if (Array.isArray(raw)) return raw.filter(Boolean);
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      }
      return [];
    } catch {
      return [];
    }
  })();

  const [formData, setFormData] = useState({
    // Step 2: Profile
    name: household.name,
    phone: household.phone ?? "",
    email: household.email,
    // Step 3: Address
    address: household.address,
    postalCode: household.postalCode ?? "",
    unitNumber: household.unitNumber ?? "",
    // Step 4: Services
    selectedCategories: initialCategories,
    // Step 5: Preferences
    preferredDay: household.preferences?.preferredDay ?? "ANY",
    preferredTime: household.preferences?.preferredTime ?? "ANY",
    preferredLanguage: household.preferences?.preferredLanguage ?? "ENGLISH",
    notes: household.preferences?.notes ?? "",
  });

  // PATCH mutation for saving each step
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
    onSuccess: () => {
      // Success is handled per-step
    },
    onError: (err: Error) => {
      toast.error(err.message || "Something went wrong. Please try again.");
    },
  });

  const handleFieldChange = useCallback((field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const goNext = useCallback(() => {
    setDirection(1);
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }, []);

  const goBack = useCallback(() => {
    setDirection(-1);
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedCategories: prev.selectedCategories.includes(category)
        ? prev.selectedCategories.filter((c) => c !== category)
        : [...prev.selectedCategories, category],
    }));
  }, []);

  // Save step 1 (profile) and advance
  const handleStep2Continue = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({
        step: 1,
        data: { name: formData.name, phone: formData.phone, email: formData.email },
      });
      goNext();
    } catch {
      // error handled in onError
    }
  }, [formData.name, formData.phone, formData.email, saveMutation, goNext]);

  // Save step 2 (address) and advance
  const handleStep3Continue = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({
        step: 2,
        data: {
          address: formData.address,
          postalCode: formData.postalCode,
          unitNumber: formData.unitNumber,
        },
      });
      goNext();
    } catch {
      // error handled in onError
    }
  }, [formData.address, formData.postalCode, formData.unitNumber, saveMutation, goNext]);

  // Save step 3 (categories) and advance
  const handleStep4Continue = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({
        step: 3,
        data: { activeCategories: formData.selectedCategories },
      });
      goNext();
    } catch {
      // error handled in onError
    }
  }, [formData.selectedCategories, saveMutation, goNext]);

  // Complete onboarding (step 5)
  const handleComplete = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({
        step: 5,
        data: {
          preferences: {
            preferredDay: formData.preferredDay,
            preferredTime: formData.preferredTime,
            preferredLanguage: formData.preferredLanguage,
            notes: formData.notes,
          },
        },
      });
      setIsCompleted(true);
      // Auto-redirect after 2 seconds
      setTimeout(() => {
        onComplete();
      }, 2000);
    } catch {
      // error handled in onError
    }
  }, [formData, saveMutation, onComplete]);

  // If completed, show success screen
  if (isCompleted) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-4 bg-[var(--anna-bg)]">
        <div className="w-full max-w-lg">
          <CompletionScreen />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-start bg-[var(--anna-bg)] p-4 md:p-6">
      <div className="w-full max-w-lg pt-4 md:pt-8">
        {/* Progress bar */}
        <ProgressBar currentStep={currentStep} />

        {/* Step card */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-6 shadow-sm overflow-hidden">
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
              {currentStep === 0 && (
                <StepWelcome
                  householdName={formData.name}
                  onContinue={goNext}
                />
              )}
              {currentStep === 1 && (
                <StepProfile
                  formData={{ name: formData.name, phone: formData.phone, email: formData.email }}
                  onChange={handleFieldChange}
                  onContinue={handleStep2Continue}
                  onBack={goBack}
                  isSaving={saveMutation.isPending}
                />
              )}
              {currentStep === 2 && (
                <StepAddress
                  formData={{
                    address: formData.address,
                    postalCode: formData.postalCode,
                    unitNumber: formData.unitNumber,
                  }}
                  onChange={handleFieldChange}
                  onContinue={handleStep3Continue}
                  onBack={goBack}
                  isSaving={saveMutation.isPending}
                />
              )}
              {currentStep === 3 && (
                <StepServices
                  selectedCategories={formData.selectedCategories}
                  onToggle={toggleCategory}
                  onContinue={handleStep4Continue}
                  onBack={goBack}
                  isSaving={saveMutation.isPending}
                />
              )}
              {currentStep === 4 && (
                <StepPreferences
                  formData={{
                    preferredDay: formData.preferredDay,
                    preferredTime: formData.preferredTime,
                    preferredLanguage: formData.preferredLanguage,
                    notes: formData.notes,
                  }}
                  onChange={handleFieldChange}
                  onComplete={handleComplete}
                  onBack={goBack}
                  isSaving={saveMutation.isPending}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer branding */}
        <p className="text-center text-[10px] text-[var(--anna-muted)] mt-6">
          Anna.I &mdash; The Operating System for the Modern Household
        </p>
      </div>
    </div>
  );
}
