"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVendorUser } from "@/app/vendor/(portal)/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { formatDate } from "@/lib/types";
import {
  Settings,
  Phone,
  Mail,
  MapPin,
  Clock,
  Briefcase,
  Camera,
  Shield,
  Calendar,
  Users,
  Check,
  X,
  Pencil,
  AlertCircle,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────

interface VendorProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  categories: string;
  vendorType: string;
  staffCount: number;
  dailyCapacity: number;
  maxTasksPerDay: number;
  maxTasksPerWeek: number;
  availability: unknown;
  zones: string;
  status: string;
  avatarUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

type EditSection = "phone" | "email" | "availability" | null;

interface AvailabilityData {
  workingDays: string[];
  workingHours: string;
  notes?: string;
}

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── Vendor Avatar with Upload ──────────────────────────

function VendorAvatarWithUpload({
  name,
  avatarUrl,
  onUploaded,
}: {
  name: string;
  avatarUrl?: string | null;
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [imgError, setImgError] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/vendor/upload-avatar", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      toast({ title: "Photo updated" });
      setImgError(false);
      onUploaded();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const showImage = avatarUrl && !imgError;

  return (
    <div className="relative group/avatar flex-shrink-0">
      {showImage ? (
        <img
          src={avatarUrl}
          alt={name}
          className="w-12 h-12 rounded-2xl object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="w-12 h-12 rounded-2xl bg-[var(--anna-sage)] flex items-center justify-center text-sm font-semibold text-white">
          {initials}
        </div>
      )}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="absolute inset-0 rounded-2xl bg-black/40 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity disabled:opacity-0"
        aria-label="Change photo"
      >
        {uploading ? (
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <Camera size={14} className="text-white" />
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleUpload}
      />
    </div>
  );
}

// ─── Loading Skeleton ──────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 rounded-2xl bg-[var(--anna-border)]" />
      <Skeleton className="h-64 rounded-2xl bg-[var(--anna-border)]" />
      <Skeleton className="h-48 rounded-2xl bg-[var(--anna-border)]" />
      <Skeleton className="h-48 rounded-2xl bg-[var(--anna-border)]" />
    </div>
  );
}

// ─── Section Card wrapper ────────────────────────────────

function SectionCard({
  title,
  subtitle,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      "bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-5",
      className
    )}>
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center">
          <Icon size={15} className="text-[var(--anna-sage-dark)]" />
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)]">{title}</h3>
          {subtitle && <p className="text-[10px] text-[var(--anna-muted)]">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── Editable Field Row ─────────────────────────────────

function EditableRow({
  icon: Icon,
  label,
  value,
  isEditing,
  editContent,
  onEdit,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  isEditing: boolean;
  editContent?: React.ReactNode;
  onEdit?: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2 text-sm text-[var(--anna-muted)]">
          <Icon size={14} className="shrink-0" />
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            editContent
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--anna-slate)] font-data">
                {value || "Not set"}
              </span>
              {onEdit && (
                <button
                  onClick={onEdit}
                  className="p-1 rounded-lg hover:bg-[var(--anna-sage-light)] transition-colors text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)]"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <Separator className="bg-[var(--anna-border)]" />
    </>
  );
}

// ─── Info Row (read-only) ─────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
  badge,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  badge?: { text: string; color: string };
}) {
  return (
    <>
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2 text-sm text-[var(--anna-muted)]">
          <Icon size={14} className="shrink-0" />
          <span>{label}</span>
        </div>
        {badge ? (
          <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 font-medium", badge.color)}>
            {badge.text}
          </Badge>
        ) : (
          <span className="text-sm font-medium text-[var(--anna-slate)] font-data">{value}</span>
        )}
      </div>
      <Separator className="bg-[var(--anna-border)]" />
    </>
  );
}

// ─── Main Page ──────────────────────────────────────────

export default function VendorSettingsPage() {
  const user = useVendorUser();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery<VendorProfile>({
    queryKey: ["vendor-profile"],
    queryFn: async () => {
      const res = await fetch("/api/vendor/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      const data = await res.json();
      return data.vendor as VendorProfile;
    },
    enabled: !!user,
  });

  // Edit state
  const [editSection, setEditSection] = useState<EditSection>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editWorkingDays, setEditWorkingDays] = useState<string[]>([]);
  const [editWorkingHours, setEditWorkingHours] = useState("");
  const [editHoursNotes, setEditHoursNotes] = useState("");

  // Sync edit state when editing starts
  const startEdit = (section: EditSection) => {
    if (!profile) return;
    if (section === "phone") setEditPhone(profile.phone || "");
    if (section === "email") setEditEmail(profile.email || "");
    if (section === "availability") {
      try {
        const avail = (profile.availability as AvailabilityData) || {};
        setEditWorkingDays(avail.workingDays || []);
        setEditWorkingHours(avail.workingHours || "");
        setEditHoursNotes(avail.notes || "");
      } catch {
        setEditWorkingDays(["Mon", "Tue", "Wed", "Thu", "Fri"]);
        setEditWorkingHours("08:00-18:00");
        setEditHoursNotes("");
      }
    }
    setEditSection(section);
  };

  const cancelEdit = () => {
    setEditSection(null);
  };

  // ── Mutations ──

  const savePhoneMutation = useMutation({
    mutationFn: async (phone: string) => {
      const res = await fetch("/api/vendor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Phone number updated", description: "Your contact number has been saved." });
      queryClient.invalidateQueries({ queryKey: ["vendor-profile"] });
      setEditSection(null);
    },
    onError: (err) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const saveEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch("/api/vendor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email updated", description: "Your contact email has been saved." });
      queryClient.invalidateQueries({ queryKey: ["vendor-profile"] });
      setEditSection(null);
    },
    onError: (err) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const saveAvailabilityMutation = useMutation({
    mutationFn: async (availability: AvailabilityData) => {
      const res = await fetch("/api/vendor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Working hours updated", description: "Your availability has been saved." });
      queryClient.invalidateQueries({ queryKey: ["vendor-profile"] });
      setEditSection(null);
    },
    onError: (err) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleDay = (day: string) => {
    setEditWorkingDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  if (isLoading) return <ProfileSkeleton />;
  if (!profile) return null;

  let categories: string[] = [];
  try { categories = JSON.parse(profile.categories); } catch { /* ignore */ }

  let zones: string[] = [];
  try { zones = JSON.parse(profile.zones); } catch { /* ignore */ }

  let parsedAvail: AvailabilityData | null = null;
  try { parsedAvail = (profile.availability as AvailabilityData) || null; } catch { /* ignore */ }

  const statusStyles: Record<string, string> = {
    ACTIVE: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
    PENDING: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
    SUSPENDED: "bg-red-50 text-red-600 border-red-200",
    OFFBOARDED: "bg-[var(--anna-muted)]/15 text-[var(--anna-muted)] border-[var(--anna-muted)]/20",
  };

  const isAnySaving =
    savePhoneMutation.isPending || saveEmailMutation.isPending || saveAvailabilityMutation.isPending;

  return (
    <div className="pb-20 md:pb-0">
      <div className="mb-5">
        <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">Settings</h1>
        <p className="text-sm text-[var(--anna-muted)] mt-0.5">
          Manage your vendor profile and preferences
        </p>
      </div>

      <div className="space-y-5">
        {/* ── Profile Card ── */}
        <SectionCard title="Profile" subtitle="Basic vendor information" icon={Briefcase}>
          <div className="flex items-center gap-3 mb-2">
            <VendorAvatarWithUpload
              name={profile.name}
              avatarUrl={profile.avatarUrl}
              onUploaded={() => queryClient.invalidateQueries({ queryKey: ["vendorProfile"] })}
            />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-[var(--anna-slate)]">{profile.name}</h2>
              <p className="text-xs text-[var(--anna-muted)]">{profile.email}</p>
            </div>
            <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 font-medium", statusStyles[profile.status] ?? "")}>
              {profile.status}
            </Badge>
          </div>
          <Separator className="bg-[var(--anna-border)]" />
          <InfoRow icon={Shield} label="Type" value={profile.vendorType} />
          <InfoRow icon={Users} label="Staff" value={`${profile.staffCount} members`} />
          <InfoRow icon={Calendar} label="Member Since" value={formatDate(profile.createdAt)} />
          <InfoRow icon={Calendar} label="Last Updated" value={formatDate(profile.updatedAt)} />
        </SectionCard>

        {/* ── Contact Information ── */}
        <SectionCard title="Contact Details" subtitle="Your phone and email for bookings" icon={Phone}>
          {/* Phone */}
          <EditableRow
            icon={Phone}
            label="Phone"
            value={profile.phone || "Not set"}
            isEditing={editSection === "phone"}
            onEdit={() => startEdit("phone")}
            editContent={
              <div className="flex items-center gap-2">
                <Input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="+65 9000 0000"
                  className="w-36 rounded-lg border-[var(--anna-border)] h-8 text-xs font-data"
                />
                <Button
                  size="sm"
                  onClick={() => savePhoneMutation.mutate(editPhone)}
                  disabled={savePhoneMutation.isPending || editPhone === profile.phone}
                  className="h-7 px-2 rounded-lg bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white"
                >
                  <Save size={12} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelEdit}
                  className="h-7 px-1 rounded-lg"
                >
                  <X size={12} />
                </Button>
              </div>
            }
          />

          {/* Email */}
          <EditableRow
            icon={Mail}
            label="Email"
            value={profile.email || "Not set"}
            isEditing={editSection === "email"}
            onEdit={() => startEdit("email")}
            editContent={
              <div className="flex items-center gap-2">
                <Input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="ops@sparkclean.sg"
                  className="w-48 rounded-lg border-[var(--anna-border)] h-8 text-xs font-data"
                />
                <Button
                  size="sm"
                  onClick={() => saveEmailMutation.mutate(editEmail)}
                  disabled={saveEmailMutation.isPending || editEmail === profile.email}
                  className="h-7 px-2 rounded-lg bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white"
                >
                  <Save size={12} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelEdit}
                  className="h-7 px-1 rounded-lg"
                >
                  <X size={12} />
                </Button>
              </div>
            }
          />

          <div className="mt-3 flex items-start gap-2 px-1">
            <AlertCircle size={13} className="text-[var(--anna-muted)] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[var(--anna-muted)] leading-relaxed">
              Phone must be a valid Singapore (+65) or Malaysia (+60) number. Email must be unique.
            </p>
          </div>
        </SectionCard>

        {/* ── Working Hours & Availability ── */}
        <SectionCard title="Working Hours" subtitle="Your availability for task scheduling" icon={Clock}>
          {editSection === "availability" ? (
            <div className="space-y-4">
              {/* Day toggles */}
              <div>
                <p className="text-[10px] font-medium text-[var(--anna-muted)] uppercase tracking-wider mb-2">
                  Working Days
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_DAYS.map((day) => {
                    const isActive = editWorkingDays.includes(day);
                    return (
                      <button
                        key={day}
                        onClick={() => toggleDay(day)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                          isActive
                            ? "bg-[var(--anna-sage)] text-white shadow-sm"
                            : "bg-[var(--anna-bg)] text-[var(--anna-muted)] border border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]"
                        )}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Hours */}
              <div>
                <p className="text-[10px] font-medium text-[var(--anna-muted)] uppercase tracking-wider mb-2">
                  Working Hours
                </p>
                <Input
                  value={editWorkingHours}
                  onChange={(e) => setEditWorkingHours(e.target.value)}
                  placeholder="08:00-18:00"
                  className="w-36 rounded-lg border-[var(--anna-border)] h-9 text-xs font-data"
                />
                <p className="text-[10px] text-[var(--anna-muted)] mt-1">Format: HH:MM-HH:MM (e.g. 08:00-18:00)</p>
              </div>

              {/* Notes */}
              <div>
                <p className="text-[10px] font-medium text-[var(--anna-muted)] uppercase tracking-wider mb-2">
                  Notes (optional)
                </p>
                <Input
                  value={editHoursNotes}
                  onChange={(e) => setEditHoursNotes(e.target.value)}
                  placeholder="e.g. Closed on public holidays"
                  className="rounded-lg border-[var(--anna-border)] h-9 text-xs"
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => saveAvailabilityMutation.mutate({
                    workingDays: editWorkingDays,
                    workingHours: editWorkingHours,
                    notes: editHoursNotes || undefined,
                  })}
                  disabled={saveAvailabilityMutation.isPending}
                  className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-9 text-xs font-semibold"
                >
                  {saveAvailabilityMutation.isPending ? "Saving..." : "Save Availability"}
                </Button>
                <Button
                  variant="outline"
                  onClick={cancelEdit}
                  className="rounded-xl h-9 text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {(parsedAvail?.workingDays || ALL_DAYS).map((day) => (
                  <div key={day} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--anna-sage-light)]">
                    <Check size={11} className="text-[var(--anna-sage-dark)]" />
                    <span className="text-[11px] font-medium text-[var(--anna-sage-dark)]">{day}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--anna-muted)]">Hours</span>
                <span className="text-sm font-medium text-[var(--anna-slate)] font-data">
                  {parsedAvail?.workingHours || "Not set"}
                </span>
              </div>
              {parsedAvail?.notes && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--anna-muted)]">Notes</span>
                  <span className="text-xs text-[var(--anna-slate)]">{parsedAvail.notes}</span>
                </div>
              )}
              <Button
                onClick={() => startEdit("availability")}
                variant="outline"
                className="mt-1 rounded-xl h-8 text-xs"
              >
                <Pencil size={12} className="mr-1.5" />
                Edit Hours
              </Button>
            </div>
          )}
        </SectionCard>

        {/* ── Service Categories (read-only) ── */}
        <SectionCard title="Service Categories" subtitle="Your approved service types" icon={Settings}>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <div key={cat} className="flex items-center gap-1.5 bg-[var(--anna-bg)] rounded-lg px-3 py-1.5">
                <CategoryIcon category={cat as `import("src/lib/types").ServiceCategory`} size={14} />
                <span className="text-xs font-medium text-[var(--anna-slate)]">
                  {getCategoryLabel(cat as `import("src/lib/types").ServiceCategory`)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-start gap-2 px-1">
            <AlertCircle size={13} className="text-[var(--anna-muted)] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[var(--anna-muted)] leading-relaxed">
              Contact ops to add or remove service categories.
            </p>
          </div>
        </SectionCard>

        {/* ── Capacity & Limits (read-only) ── */}
        <SectionCard title="Capacity & Limits" subtitle="Your task acceptance thresholds" icon={Briefcase}>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center px-2 py-3 rounded-xl bg-[var(--anna-bg)]">
              <p className="font-data text-lg font-bold text-[var(--anna-slate)]">{profile.dailyCapacity}</p>
              <p className="text-[10px] text-[var(--anna-muted)]">Daily Capacity</p>
            </div>
            <div className="text-center px-2 py-3 rounded-xl bg-[var(--anna-bg)]">
              <p className="font-data text-lg font-bold text-[var(--anna-slate)]">{profile.maxTasksPerDay}</p>
              <p className="text-[10px] text-[var(--anna-muted)]">Max Tasks/Day</p>
            </div>
            <div className="text-center px-2 py-3 rounded-xl bg-[var(--anna-bg)]">
              <p className="font-data text-lg font-bold text-[var(--anna-slate)]">{profile.maxTasksPerWeek}</p>
              <p className="text-[10px] text-[var(--anna-muted)]">Max Tasks/Week</p>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2 px-1">
            <AlertCircle size={13} className="text-[var(--anna-muted)] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[var(--anna-muted)] leading-relaxed">
              Contact ops to adjust capacity limits based on your team size.
            </p>
          </div>
        </SectionCard>

        {/* ── Service Zones (read-only) ── */}
        <SectionCard title="Service Zones" subtitle="Areas where you accept bookings" icon={MapPin}>
          {zones.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {zones.map((zone) => (
                <div key={zone} className="flex items-center gap-1.5 bg-[var(--anna-sage-light)] rounded-lg px-3 py-1.5">
                  <MapPin size={12} className="text-[var(--anna-sage-dark)]" />
                  <span className="text-xs font-medium text-[var(--anna-sage-dark)]">{zone}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--anna-muted)] py-2">No zones configured</p>
          )}
          <div className="mt-3 flex items-start gap-2 px-1">
            <AlertCircle size={13} className="text-[var(--anna-muted)] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[var(--anna-muted)] leading-relaxed">
              Contact ops to update your service zones.
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
