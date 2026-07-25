"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAnnaStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  formatSgd,
  PROPERTY_TYPE_LABELS,
  type Household,
  type FamilyMember,
  type Subscription,
  type Address,
  type PropertyType,
} from "@/lib/types";
import { useTheme } from "next-themes";
import {
  Mail,
  MapPin,
  Phone,
  Crown,
  Users,
  Pencil,
  Plus,
  Trash2,
  Check,
  X,
  Camera,
  Moon,
  ArrowUpCircle,
  AlertTriangle,
  Info,
  LogOut,
  Building2,
  Trees,
  Briefcase,
  HelpCircle,
  Loader2,
  CircleCheck,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PhoneInput } from "@/components/shared/phone-input";
import { AddressForm, type AddressFormData } from "@/components/shared/address-form";
import { HouseholdProfileSection, type HouseholdProfile } from "@/components/anna/household-profile-section";
import { BillingSection } from "@/components/anna/billing-section";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Data fetching
// ─────────────────────────────────────────────────────────────

async function fetchHouseholdDetail(id: string) {
  const res = await fetch(`/api/households/${id}`);
  if (!res.ok) throw new Error("Failed to fetch household");
  return res.json();
}

async function fetchAddresses(householdId: string) {
  const res = await fetch(`/api/households/${householdId}/addresses`);
  if (!res.ok) throw new Error("Failed to fetch addresses");
  const data = await res.json();
  return data.addresses as Address[];
}

// ─────────────────────────────────────────────────────────────
// Property type icon helper
// ─────────────────────────────────────────────────────────────

const PROPERTY_TYPE_ICONS: Record<PropertyType, React.ElementType> = {
  HDB: Building2,
  CONDOMINIUM: Building2,
  LANDED: Trees,
  OFFICE: Briefcase,
  OTHER: HelpCircle,
};

function PropertyTypeBadge({ type }: { type: PropertyType }) {
  const Icon = PROPERTY_TYPE_ICONS[type] || HelpCircle;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
      <Icon size={10} />
      {PROPERTY_TYPE_LABELS[type]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Phone editable field (inline editing with PhoneInput)
// ─────────────────────────────────────────────────────────────

function PhoneEditableField({
  value,
  isMutating,
  onSave,
}: {
  value: string;
  isMutating: boolean;
  onSave: (normalized: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [phoneValue, setPhoneValue] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const phoneInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && phoneInputRef.current) {
      // Focus the actual input inside PhoneInput
      const input = phoneInputRef.current.querySelector("input");
      input?.focus();
    }
  }, [editing]);

  const startEditing = () => {
    setPhoneValue(value || "");
    setPhoneError("");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setPhoneError("");
  };

  const handlePhoneChange = useCallback((normalized: string, _raw: string) => {
    setPhoneValue(normalized);
    setPhoneError("");
  }, []);

  const handleSave = useCallback(() => {
    if (phoneError) return;

    if (!phoneValue || phoneValue.replace(/^\+65/, "").replace(/\D/g, "").length < 8) {
      setPhoneError("Please enter a valid 8-digit phone number");
      return;
    }

    if (phoneValue === value) {
      cancelEditing();
      return;
    }

    onSave(phoneValue);
    setEditing(false);
  }, [phoneValue, value, phoneError, onSave]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      cancelEditing();
    }
  };

  // Display formatted phone
  const displayPhone = (() => {
    if (!value) return "—";
    const digits = value.replace(/^\+65/, "").replace(/\D/g, "");
    if (digits.length === 8) return `+65 ${digits.slice(0, 4)} ${digits.slice(4)}`;
    return value;
  })();

  const isEmpty = !value;

  if (editing) {
    return (
      <div className="flex items-start gap-3" onKeyDown={handleKeyDown}>
        <Phone size={14} className="text-[var(--anna-muted)] flex-shrink-0 mt-2.5" />
        <div className="flex-1 space-y-1" ref={phoneInputRef as React.RefObject<HTMLDivElement>}>
          <PhoneInput
            value={phoneValue}
            onChange={handlePhoneChange}
            label=""
            required
            error={phoneError}
            showStatus
            disabled={isMutating}
          />
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-[var(--anna-success)] hover:bg-[var(--anna-success)]/10 px-2"
              onClick={handleSave}
              disabled={isMutating}
            >
              <Check size={12} className="mr-1" />
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-[var(--anna-muted)] hover:bg-[var(--anna-bg)] px-2"
              onClick={cancelEditing}
              disabled={isMutating}
            >
              <X size={12} className="mr-1" />
              Cancel
            </Button>
            {isMutating && (
              <Loader2 size={12} className="animate-spin text-[var(--anna-muted)] ml-1" />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Phone size={14} className="text-[var(--anna-muted)] flex-shrink-0" />
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className={cn(
          "text-sm truncate",
          isEmpty ? "text-[var(--anna-muted)] italic" : "text-[var(--anna-slate-light)]"
        )}>
          {isEmpty ? "No phone" : displayPhone}
        </span>
        {isEmpty && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-[var(--anna-warning)]/40 text-[var(--anna-warning)] flex-shrink-0">
            Required
          </Badge>
        )}
        <button
          onClick={startEditing}
          className="p-1 rounded-md hover:bg-[var(--anna-sage-light)] text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 md:opacity-0"
          aria-label="Edit phone"
        >
          <Pencil size={12} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Address card
// ─────────────────────────────────────────────────────────────

function AddressCard({
  address,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  address: Address;
  onEdit: (address: Address) => void;
  onDelete: (address: Address) => void;
  onSetDefault: (address: Address) => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)]/50 p-3.5 space-y-2 group/card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <PropertyTypeBadge type={address.propertyType} />
          {address.isDefault && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-success)]/15 text-[var(--anna-success)]">
              Default
            </span>
          )}
          {address.label && (
            <span className="text-[10px] font-medium text-[var(--anna-muted)]">
              {address.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity">
          {!address.isDefault && (
            <button
              onClick={() => onSetDefault(address)}
              className="p-1 rounded-md hover:bg-[var(--anna-sage-light)] text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] transition-colors"
              aria-label="Set as default address"
              title="Set as default"
            >
              <ArrowUpCircle size={12} />
            </button>
          )}
          <button
            onClick={() => onEdit(address)}
            className="p-1 rounded-md hover:bg-[var(--anna-sage-light)] text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] transition-colors"
            aria-label="Edit address"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={() => onDelete(address)}
            className="p-1 rounded-md hover:bg-[var(--anna-error)]/10 text-[var(--anna-muted)] hover:text-[var(--anna-error)] transition-colors"
            aria-label="Delete address"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="flex items-start gap-1.5">
        <MapPin size={12} className="text-[var(--anna-muted)] flex-shrink-0 mt-0.5" />
        <p className="text-sm text-[var(--anna-slate)] leading-snug">{address.fullAddress}</p>
      </div>
      <p className="text-[11px] text-[var(--anna-muted)]">
        Singapore {address.postalCode}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Member avatar with upload
// ─────────────────────────────────────────────────────────────

function MemberAvatar({
  member,
  onUploaded,
}: {
  member: FamilyMember;
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
      fd.append("memberId", member.id);

      const res = await fetch("/api/upload-avatar", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      toast.success("Photo updated");
      setImgError(false);
      onUploaded();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      // Reset so same file can be re-selected
      e.target.value = "";
    }
  };

  const initials = member.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  const showImage = member.avatarUrl && !imgError;

  return (
    <div className="relative group/avatar flex-shrink-0">
      {showImage ? (
        <img
          src={member.avatarUrl}
          alt={member.name}
          className="w-10 h-10 rounded-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[var(--anna-sage-light)] flex items-center justify-center text-sm font-semibold text-[var(--anna-sage-dark)]">
          {initials}
        </div>
      )}
      {/* Camera overlay on hover */}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity disabled:opacity-0"
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

// ─────────────────────────────────────────────────────────────
// Editable field row
// ─────────────────────────────────────────────────────────────

function EditableField({
  label,
  value,
  icon: Icon,
  fieldKey,
  householdId,
  isMutating,
  mutate,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  fieldKey: string;
  householdId: string;
  isMutating: boolean;
  mutate: ReturnType<typeof useMutation>["mutate"];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleSave = useCallback(() => {
    if (!draft.trim() || draft === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    mutate(
      { [fieldKey]: draft },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(`${label} updated`);
        },
        onError: () => {
          setDraft(value);
          setEditing(false);
          toast.error(`Failed to update ${label.toLowerCase()}`);
        },
      }
    );
  }, [draft, value, fieldKey, label, mutate]);

  const handleCancel = useCallback(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  return (
    <div className="flex items-center gap-3">
      <Icon size={14} className="text-[var(--anna-muted)] flex-shrink-0" />
      {editing ? (
        <div className="flex items-center gap-2 flex-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            className="h-8 text-sm border-[var(--anna-border)] bg-[var(--anna-bg)] rounded-lg px-2.5"
            autoFocus
            disabled={isMutating}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-[var(--anna-success)] hover:bg-[var(--anna-success)]/10 flex-shrink-0"
            onClick={handleSave}
            disabled={isMutating}
          >
            <Check size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-[var(--anna-muted)] hover:bg-[var(--anna-bg)] flex-shrink-0"
            onClick={handleCancel}
            disabled={isMutating}
          >
            <X size={14} />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm text-[var(--anna-slate-light)] truncate">
            {value || "—"}
          </span>
          <button
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            className="p-1 rounded-md hover:bg-[var(--anna-sage-light)] text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 md:opacity-0"
            aria-label={`Edit ${label}`}
          >
            <Pencil size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Switch
      checked={isDark}
      onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
      aria-label="Toggle night mode"
    />
  );
}

export function SettingsPanel() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedHouseholdId, setHouseholdNames, householdNames } =
    useAnnaStore();

  // ── Queries ──

  const { data, isLoading } = useQuery({
    queryKey: ["household", selectedHouseholdId],
    queryFn: () => fetchHouseholdDetail(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
  });

  const {
    data: addresses,
    isLoading: addressesLoading,
  } = useQuery({
    queryKey: ["addresses", selectedHouseholdId],
    queryFn: () => fetchAddresses(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
  });

  // ── Mutations ──

  const updateHousehold = useMutation({
    mutationFn: async (patch: Record<string, string>) => {
      const res = await fetch(`/api/households/${selectedHouseholdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Update failed");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
      queryClient.invalidateQueries({ queryKey: ["households"] });
      if (variables.name) {
        setHouseholdNames({
          ...householdNames,
          [selectedHouseholdId]: variables.name,
        });
      }
    },
  });

  const addMember = useMutation({
    mutationFn: async (body: {
      name: string;
      email: string;
      phone?: string;
    }) => {
      const res = await fetch(`/api/households/${selectedHouseholdId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add member");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
      toast.success("Member added");
      setAddDialogOpen(false);
      setNewMember({ name: "", email: "", phone: "" });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMember = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await fetch(
        `/api/households/${selectedHouseholdId}/members/${memberId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to remove member");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
      toast.success("Member removed");
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err.message),
  });

  // ── State ──

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newMember, setNewMember] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [deleteTarget, setDeleteTarget] = useState<FamilyMember | null>(null);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [deleteAddressTarget, setDeleteAddressTarget] = useState<Address | null>(null);

  // ── Address mutations ──

  const createAddress = useMutation({
    mutationFn: async (data: AddressFormData) => {
      const res = await fetch(`/api/households/${selectedHouseholdId}/addresses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create address");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["addresses", selectedHouseholdId] });
      queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
      toast.success("Address added");
      setAddressDialogOpen(false);
      setEditingAddress(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateAddress = useMutation({
    mutationFn: async ({ addressId, data }: { addressId: string; data: AddressFormData }) => {
      const res = await fetch(
        `/api/households/${selectedHouseholdId}/addresses/${addressId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update address");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["addresses", selectedHouseholdId] });
      queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
      toast.success("Address updated");
      setAddressDialogOpen(false);
      setEditingAddress(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteAddress = useMutation({
    mutationFn: async (addressId: string) => {
      const res = await fetch(
        `/api/households/${selectedHouseholdId}/addresses/${addressId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete address");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["addresses", selectedHouseholdId] });
      queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
      toast.success("Address deleted");
      setDeleteAddressTarget(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const setDefaultAddress = useMutation({
    mutationFn: async (addressId: string) => {
      const res = await fetch(
        `/api/households/${selectedHouseholdId}/addresses/${addressId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isDefault: true }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to set default address");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["addresses", selectedHouseholdId] });
      queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
      toast.success("Default address updated");
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Derived ──

  const household: Household | undefined = data?.household;
  const members: FamilyMember[] = data?.members || [];
  const subscriptions: Subscription[] = data?.subscriptions || [];
  const sub = subscriptions[0];

  // Contact completeness check
  const hasFullName = !!household?.fullName?.trim();
  const hasPhone = !!household?.phone?.trim();
  const hasAddress = addresses && addresses.length > 0;
  const missingContactInfo = !hasFullName || !hasPhone;
  const profileComplete = hasFullName && hasPhone && hasAddress;

  // ── Render ──

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-8 w-48 rounded-xl bg-[var(--anna-border)]" />
        <Skeleton className="h-56 w-full rounded-2xl bg-[var(--anna-border)]" />
        <Skeleton className="h-40 w-full rounded-2xl bg-[var(--anna-border)]" />
        <Skeleton className="h-48 w-full rounded-2xl bg-[var(--anna-border)]" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 pb-20 md:pb-0 anna-fade-in">
      <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)] mb-1">
        Settings
      </h1>
      <p className="text-sm text-[var(--anna-muted)] mb-6">
        Household configuration and subscription
      </p>

      {/* ── Profile Completeness Banner ── */}
      {missingContactInfo ? (
        <div className="rounded-2xl p-4 mb-4 border bg-[var(--anna-warning)]/8 border-[var(--anna-warning)]/25">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--anna-warning)]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle size={16} className="text-[var(--anna-warning)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--anna-slate)]">Complete your profile</p>
              <p className="text-xs text-[var(--anna-muted)] mt-0.5 leading-relaxed">
                {!hasFullName && !hasPhone
                  ? "Add your name and phone number so service providers can reach you."
                  : !hasFullName
                    ? "Add your full name to personalise your service experience."
                    : "Add your phone number so service providers can contact you on the day."}
              </p>
            </div>
          </div>
        </div>
      ) : hasFullName && hasPhone ? (
        <div className="rounded-2xl p-4 mb-4 border bg-[var(--anna-success)]/8 border-[var(--anna-success)]/25">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--anna-success)]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <CircleCheck size={16} className="text-[var(--anna-success)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--anna-slate)]">Profile complete</p>
              <p className="text-xs text-[var(--anna-muted)] mt-0.5 leading-relaxed">
                Your contact details are all set. Service providers can now identify and reach you easily.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Household Info ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)] mb-4">
        {/* Contact subsection */}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1">
          Contact Information
        </h3>
        <p className="text-[11px] text-[var(--anna-muted)] mb-4">
          Your name and phone help service providers identify and reach you.
        </p>
        <div className="space-y-3.5 group">
          {/* Avatar with household name */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-[var(--anna-sage-dark)]">
                {(household?.fullName || household?.name)?.charAt(0) || "?"}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div>
                <p className="text-sm font-semibold text-[var(--anna-slate)]">
                  {household?.name}
                </p>
                {household?.fullName && household.fullName !== household.name && (
                  <p className="text-xs text-[var(--anna-muted)]">
                    {household.fullName}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Full Name — editable */}
          <EditableField
            label="Full Name"
            value={household?.fullName || ""}
            icon={Users}
            fieldKey="fullName"
            householdId={selectedHouseholdId}
            isMutating={updateHousehold.isPending}
            mutate={updateHousehold.mutate}
          />

          {/* Email — keep existing EditableField */}
          <EditableField
            label="Email"
            value={household?.email || ""}
            icon={Mail}
            fieldKey="email"
            householdId={selectedHouseholdId}
            isMutating={updateHousehold.isPending}
            mutate={updateHousehold.mutate}
          />

          {/* Phone — inline PhoneInput editing */}
          <PhoneEditableField
            value={household?.phone || ""}
            isMutating={updateHousehold.isPending}
            onSave={(normalized) => {
              updateHousehold.mutate(
                { phone: normalized },
                {
                  onSuccess: () => toast.success("Phone updated"),
                  onError: () => toast.error("Failed to update phone"),
                }
              );
            }}
          />
        </div>
      </div>

      {/* ── Addresses ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)] mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
            <MapPin size={14} />
            Addresses
          </h3>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-[var(--anna-border)] text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)] hover:border-[var(--anna-sage)]"
            onClick={() => {
              setEditingAddress(null);
              setAddressDialogOpen(true);
            }}
          >
            <Plus size={12} className="mr-1" />
            Add Address
          </Button>
        </div>

        {addressesLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-xl bg-[var(--anna-border)]" />
            <Skeleton className="h-20 w-full rounded-xl bg-[var(--anna-border)]" />
          </div>
        ) : addresses && addresses.length > 0 ? (
          <div className="space-y-3">
            {addresses.map((addr) => (
              <AddressCard
                key={addr.id}
                address={addr}
                onEdit={(a) => {
                  setEditingAddress(a);
                  setAddressDialogOpen(true);
                }}
                onDelete={(a) => setDeleteAddressTarget(a)}
                onSetDefault={(a) => setDefaultAddress.mutate(a.id)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-xl bg-[var(--anna-bg)] flex items-center justify-center mx-auto mb-3">
              <MapPin size={20} className="text-[var(--anna-muted)]" />
            </div>
            <p className="text-sm font-medium text-[var(--anna-slate)]">No addresses yet</p>
            <p className="text-xs text-[var(--anna-muted)] mt-1">
              Add your service address to get started
            </p>
          </div>
        )}
      </div>

      {/* ── Household Profile ── */}
      <HouseholdProfileSection
        profile={(household?.onboardingProfile as HouseholdProfile) || {}}
        householdId={selectedHouseholdId}
      />

      {/* ── Appearance ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)] mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
          Appearance
        </h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--anna-bg)] flex items-center justify-center">
              <Moon size={16} className="text-[var(--anna-slate-light)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--anna-slate)]">Night mode</p>
              <p className="text-xs text-[var(--anna-muted)]">Switch to dark theme</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </div>

      {/* ── Subscription & Billing (Stripe-integrated) ── */}
      <BillingSection sub={sub} householdId={selectedHouseholdId} />

      {/* ── Members ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
            <Users size={14} />
            Members ({members.length})
          </h3>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-[var(--anna-border)] text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)] hover:border-[var(--anna-sage)]"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus size={12} className="mr-1" />
            Add
          </Button>
        </div>
        <div className="space-y-1">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between py-2 group/row"
            >
              <div className="flex items-center gap-3 min-w-0">
                <MemberAvatar
                  member={member}
                  onUploaded={() =>
                    queryClient.invalidateQueries({
                      queryKey: ["household", selectedHouseholdId],
                    })
                  }
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
                    {member.name}
                  </p>
                  <p className="text-[11px] text-[var(--anna-muted)] truncate">
                    {member.email}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${
                    member.role === "OWNER"
                      ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                      : "bg-[var(--anna-bg)] text-[var(--anna-muted)]"
                  }`}
                >
                  {member.role}
                </span>
                {member.role !== "OWNER" && (
                  <button
                    onClick={() => setDeleteTarget(member)}
                    className="p-1.5 rounded-md text-[var(--anna-muted)] hover:text-[var(--anna-error)] hover:bg-[var(--anna-error)]/10 transition-colors opacity-0 group-hover/row:opacity-100 focus:opacity-100"
                    aria-label={`Remove ${member.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Add Member Dialog ── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>
              Add a new member to your household.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="member-name" className="text-xs">
                Name <span className="text-[var(--anna-error)]">*</span>
              </Label>
              <Input
                id="member-name"
                value={newMember.name}
                onChange={(e) =>
                  setNewMember((m) => ({ ...m, name: e.target.value }))
                }
                placeholder="Full name"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-email" className="text-xs">
                Email <span className="text-[var(--anna-error)]">*</span>
              </Label>
              <Input
                id="member-email"
                type="email"
                value={newMember.email}
                onChange={(e) =>
                  setNewMember((m) => ({ ...m, email: e.target.value }))
                }
                placeholder="email@example.com"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-phone" className="text-xs">
                Phone
              </Label>
              <Input
                id="member-phone"
                value={newMember.phone}
                onChange={(e) =>
                  setNewMember((m) => ({ ...m, phone: e.target.value }))
                }
                placeholder="+65 9XXX XXXX"
                className="h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-[var(--anna-border)]"
              onClick={() => setAddDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => addMember.mutate(newMember)}
              disabled={
                !newMember.name.trim() ||
                !newMember.email.trim() ||
                addMember.isPending
              }
              className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white"
            >
              {addMember.isPending ? "Adding..." : "Add Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Sign Out (mobile) ── */}
      <button
        onClick={() => setLogoutDialogOpen(true)}
        className="w-full mt-6 flex items-center justify-center gap-2 py-3 rounded-2xl border border-[var(--anna-error)]/30 text-[var(--anna-error)] text-sm font-medium hover:bg-[var(--anna-error)]/10 transition-colors md:hidden"
      >
        <LogOut size={16} />
        Sign out
      </button>

      {/* ── Address Dialog (Add / Edit) ── */}
      <Dialog
        open={addressDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddressDialogOpen(false);
            setEditingAddress(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingAddress ? "Edit Address" : "Add Address"}
            </DialogTitle>
            <DialogDescription>
              {editingAddress
                ? "Update the details for this address."
                : "Add a new service address for your household."}
            </DialogDescription>
          </DialogHeader>
          <AddressForm
            key={editingAddress?.id || "new"}
            initialData={editingAddress
              ? {
                  propertyType: editingAddress.propertyType,
                  postalCode: editingAddress.postalCode,
                  blockNumber: editingAddress.blockNumber || "",
                  streetName: editingAddress.streetName || "",
                  buildingName: editingAddress.buildingName || "",
                  level: editingAddress.level || "",
                  unitNumber: editingAddress.unitNumber || "",
                  houseNumber: editingAddress.houseNumber || "",
                  streetAddress: editingAddress.streetAddress || "",
                  label: editingAddress.label || "",
                  isDefault: editingAddress.isDefault,
                }
              : undefined}
            onSubmit={(formData) => {
              if (editingAddress) {
                updateAddress.mutate({
                  addressId: editingAddress.id,
                  data: formData,
                });
              } else {
                createAddress.mutate(formData);
              }
            }}
            submitLabel={editingAddress ? "Update Address" : "Add Address"}
            loading={createAddress.isPending || updateAddress.isPending}
            showPropertyTypeSelector
            showLabel
            hideSubmit={false}
          />
        </DialogContent>
      </Dialog>

      {/* ── Delete Address Confirmation ── */}
      <AlertDialog
        open={!!deleteAddressTarget}
        onOpenChange={(open) => !open && setDeleteAddressTarget(null)}
      >
        <AlertDialogContent className="rounded-2xl border-[var(--anna-border)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this address?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteAddressTarget?.fullAddress}
              {deleteAddressTarget?.isDefault && (
                <span className="block mt-1 text-[var(--anna-warning)]">
                  This is your default address. It will be reassigned automatically.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[var(--anna-border)]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteAddressTarget && deleteAddress.mutate(deleteAddressTarget.id)
              }
              disabled={deleteAddress.isPending}
              className="bg-[var(--anna-error)] hover:bg-[var(--anna-error)]/90 text-white"
            >
              {deleteAddress.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Sign Out Confirmation Dialog ── */}
      <AlertDialog open={logoutDialogOpen} onOpenChange={setLogoutDialogOpen}>
        <AlertDialogContent className="rounded-2xl border-[var(--anna-border)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You will need to sign in again to access your household dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await fetch("/api/household/auth", { method: "DELETE" });
                  queryClient.clear();
                  router.push("/login");
                } catch {
                  toast.error("Failed to sign out");
                }
              }}
              className="bg-red-500 hover:bg-red-600 text-white rounded-xl"
            >
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete Member Confirmation ── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {deleteTarget?.name} from the household. They
              won't have access to household tasks or data anymore.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[var(--anna-border)]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMember.mutate(deleteTarget.id)}
              disabled={deleteMember.isPending}
              className="bg-[var(--anna-error)] hover:bg-[var(--anna-error)]/90 text-white"
            >
              {deleteMember.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}