"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVendorUser } from "@/app/vendor/(portal)/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { formatDate } from "@/lib/types";
import {
  Settings,
  Phone,
  MapPin,
  Clock,
  Briefcase,
  Shield,
  Calendar,
  Users,
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
  createdAt: string;
}

// ─── Info Row ───────────────────────────────────────────

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
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-2 text-sm text-[var(--anna-muted)]">
        <Icon size={14} className="shrink-0" />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {badge ? (
          <Badge
            variant="outline"
            className={cn("text-[10px] px-2 py-0.5 font-medium", badge.color)}
          >
            {badge.text}
          </Badge>
        ) : (
          <span className="text-sm font-medium text-[var(--anna-slate)] font-data">
            {value}
          </span>
        )}
      </div>
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
    </div>
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

  // Editable fields
  const [phone, setPhone] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async (data: { phone: string }) => {
      const res = await fetch("/api/vendor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["vendor-profile"] });
      setIsEditing(false);
    },
    onError: () => {
      toast({ title: "Failed to update profile", variant: "destructive" });
    },
  });

  const startEditing = () => {
    if (profile) setPhone(profile.phone);
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate({ phone });
  };

  if (isLoading) return <ProfileSkeleton />;
  if (!profile) return null;

  let categories: string[] = [];
  try {
    categories = JSON.parse(profile.categories);
  } catch {
    // ignore
  }

  let zones: string[] = [];
  try {
    zones = JSON.parse(profile.zones);
  } catch {
    // ignore
  }

  const statusStyles: Record<string, string> = {
    ACTIVE: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
    PENDING: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
    SUSPENDED: "bg-red-50 text-red-600 border-red-200",
    OFFBOARDED: "bg-[var(--anna-muted)]/15 text-[var(--anna-muted)] border-[var(--anna-muted)]/20",
  };

  return (
    <div className="pb-20 md:pb-0">
      <div className="mb-4">
        <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
          Settings
        </h1>
        <p className="text-sm text-[var(--anna-muted)] mt-0.5">
          Manage your vendor profile and preferences
        </p>
      </div>

      <div className="space-y-6">
        {/* Profile card */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--anna-sage)] flex items-center justify-center">
                <Briefcase size={20} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[var(--anna-slate)]">{profile.name}</h2>
                <p className="text-xs text-[var(--anna-muted)]">{profile.email}</p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn("text-[10px] px-2 py-0.5 font-medium", statusStyles[profile.status] ?? "")}
            >
              {profile.status}
            </Badge>
          </div>

          {/* Info rows */}
          <Separator className="bg-[var(--anna-border)] mb-2" />
          <InfoRow icon={Shield} label="Type" value={profile.vendorType} />
          <Separator className="bg-[var(--anna-border)]" />
          <InfoRow icon={Users} label="Staff" value={`${profile.staffCount} members`} />
          <Separator className="bg-[var(--anna-border)]" />
          <InfoRow icon={Calendar} label="Member Since" value={formatDate(profile.createdAt)} />
          <Separator className="bg-[var(--anna-border)]" />
          <InfoRow
            icon={Phone}
            label="Phone"
            value={isEditing ? "" : (profile.phone || "Not set")}
          />
          {isEditing && (
            <div className="px-4 py-2">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter phone number"
                className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
              />
            </div>
          )}
          <Separator className="bg-[var(--anna-border)]" />
        </div>

        {/* Edit/Save button */}
        <div className="flex gap-2">
          {!isEditing ? (
            <Button
              onClick={startEditing}
              className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-10 text-sm font-semibold"
            >
              <Settings size={14} className="mr-1.5" />
              Edit Profile
            </Button>
          ) : (
            <>
              <Button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-10 text-sm font-semibold"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsEditing(false)}
                className="rounded-xl h-10 text-sm"
              >
                Cancel
              </Button>
            </>
          )}
        </div>

        {/* Service categories */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)] mb-3">
            Service Categories
          </h3>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <div
                key={cat}
                className="flex items-center gap-1.5 bg-[var(--anna-bg)] rounded-lg px-3 py-1.5"
              >
                <CategoryIcon category={cat as any} size={14} />
                <span className="text-xs font-medium text-[var(--anna-slate)]">
                  {getCategoryLabel(cat as any)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Capacity & Limits */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)] mb-3">
            Capacity & Limits
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="font-data text-lg font-bold text-[var(--anna-slate)]">
                {profile.dailyCapacity}
              </p>
              <p className="text-[10px] text-[var(--anna-muted)]">Daily Capacity</p>
            </div>
            <div className="text-center">
              <p className="font-data text-lg font-bold text-[var(--anna-slate)]">
                {profile.maxTasksPerDay}
              </p>
              <p className="text-[10px] text-[var(--anna-muted)]">Max Tasks/Day</p>
            </div>
            <div className="text-center">
              <p className="font-data text-lg font-bold text-[var(--anna-slate)]">
                {profile.maxTasksPerWeek}
              </p>
              <p className="text-[10px] text-[var(--anna-muted)]">Max Tasks/Week</p>
            </div>
          </div>
          <p className="text-[10px] text-[var(--anna-muted)] mt-3">
            Contact ops to adjust capacity limits.
          </p>
        </div>

        {/* Service Zones */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)] mb-3">
            Service Zones
          </h3>
          {zones.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {zones.map((zone) => (
                <div
                  key={zone}
                  className="flex items-center gap-1.5 bg-[var(--anna-sage-light)] rounded-lg px-3 py-1.5"
                >
                  <MapPin size={12} className="text-[var(--anna-sage-dark)]" />
                  <span className="text-xs font-medium text-[var(--anna-sage-dark)]">{zone}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--anna-muted)]">No zones configured</p>
          )}
          <p className="text-[10px] text-[var(--anna-muted)] mt-3">
            Contact ops to update service zones.
          </p>
        </div>
      </div>
    </div>
  );
}
