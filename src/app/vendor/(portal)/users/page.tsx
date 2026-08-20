"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, UserCog, Pencil, Ban, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVendorUser } from "@/app/vendor/(portal)/layout";

// ── Types ──

interface RoleItem {
  id: string;
  name: string;
  slug: string;
  level: number;
  isSystem: boolean;
}

interface UserItem {
  id: string;
  name: string;
  email: string | null;
  contact: string;
  role: string;
  roleId: string | null;
  hasPassword: boolean;
  isActive: boolean;
  createdAt: string;
  roleRel: { id: string; name: string; slug: string; level: number } | null;
}

// ── Status Dot ──

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          active ? "bg-emerald-500" : "bg-gray-300"
        )}
      />
      <span className="text-xs text-[var(--anna-slate-light)]">
        {active ? "Active" : "Inactive"}
      </span>
    </span>
  );
}

// ── Role Badge ──

function RoleBadge({ roleName, slug }: { roleName: string | null; slug: string }) {
  const styles: Record<string, string> = {
    vendor_super_admin: "bg-amber-100 text-amber-800 border border-amber-200",
    vendor_admin: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]",
    vendor_manager: "bg-blue-50 text-blue-700",
    vendor_staff_role: "bg-gray-100 text-gray-600",
  };
  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-[10px] font-medium px-1.5 py-0",
        styles[slug] || "bg-[var(--anna-bg)] text-[var(--anna-muted)]"
      )}
    >
      {roleName || slug}
    </Badge>
  );
}

// ── Loading Skeletons (inline, matching Ops style) ──

function LoadingRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] px-4 py-3 flex items-center gap-3"
        >
          <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3 w-40" />
          </div>
          <div className="flex items-center gap-1">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Empty State (inline, matching Ops style) ──

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="text-center py-16">
      <div className="flex items-center justify-center mx-auto mb-3 w-14 h-14 rounded-2xl bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
        {icon}
      </div>
      <p className="text-sm font-medium text-[var(--anna-slate)]">{title}</p>
      {subtitle && (
        <p className="text-xs text-[var(--anna-muted)] mt-1">{subtitle}</p>
      )}
    </div>
  );
}

// ── Page Component ──

export default function VendorUsersPage() {
  const queryClient = useQueryClient();
  const vendorCtx = useVendorUser();
  const can = vendorCtx?.can;

  const [search, setSearch] = useState("");

  // Sheet state for Add/Edit
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formContact, setFormContact] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [formRoleId, setFormRoleId] = useState("");
  const [formError, setFormError] = useState("");

  // ── Data fetching ──

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    return params.toString();
  }, [search]);

  const { data, isLoading } = useQuery<{
    users: UserItem[];
  }>({ queryKey: ["vendor-users", buildParams()],
    queryFn: async () => {
      const qs = buildParams();
      const res = await fetch(`/api/vendor/users${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const users: UserItem[] = data?.users || [];

  const { data: rolesData } = useQuery<{
    roles: RoleItem[];
  }>({
    queryKey: ["vendor-roles-all"],
    queryFn: async () => {
      const res = await fetch("/api/vendor/roles");
      if (!res.ok) return { roles: [] };
      return res.json();
    },
  });
  const roles: RoleItem[] = rolesData?.roles || [];

  // ── Mutations ──

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, string>) => {
      const res = await fetch("/api/vendor/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create staff member");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-users"] });
      closeSheet();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/vendor/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update staff member");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-users"] });
      closeSheet();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/vendor/users/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-users"] });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`/api/vendor/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-users"] });
    },
  });

  // ── Helpers ──

  function openAddSheet() {
    setEditingUser(null);
    setFormName("");
    setFormContact("");
    setFormEmail("");
    setFormPassword("");
    setShowFormPassword(false);
    setFormRoleId("");
    setFormError("");
    setSheetOpen(true);
  }

  function openEditSheet(user: UserItem) {
    setEditingUser(user);
    setFormName(user.name);
    setFormContact(user.contact);
    setFormEmail(user.email || "");
    setFormPassword("");
    setShowFormPassword(false);
    setFormRoleId(user.roleId || "");
    setFormError("");
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setEditingUser(null);
    setFormError("");
  }

  function handleSave() {
    setFormError("");
    if (!formName.trim()) { setFormError("Name is required"); return; }
    if (!formContact.trim()) { setFormError("Contact is required"); return; }
    if (formEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail)) {
      setFormError("Invalid email format");
      return;
    }
    if (formEmail.trim() && !formPassword && !editingUser) {
      setFormError("Password is required when email is provided (for login)");
      return;
    }
    if (formPassword && formPassword.length < 8) {
      setFormError("Password must be at least 8 characters");
      return;
    }

    if (editingUser) {
      const body: Record<string, unknown> = { name: formName, contact: formContact };
      if (formRoleId) body.roleId = formRoleId;
      if (formPassword) (body as Record<string, string>).password = formPassword;
      updateMutation.mutate({ id: editingUser.id, body });
    } else {
      const body: Record<string, string> = { name: formName, contact: formContact };
      if (formRoleId) body.roleId = formRoleId;
      if (formEmail.trim()) body.email = formEmail.trim();
      if (formPassword) body.password = formPassword;
      createMutation.mutate(body);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Render ──

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            User Management
          </h2>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            Manage your team members
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Search name, contact..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-60 pl-9 h-9 rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] text-sm text-[var(--anna-slate)] placeholder:text-[var(--anna-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--anna-sage)]/30 focus:border-transparent transition"
            />
          </div>
          {can?.("v_users", "create") && (
            <Button
              size="sm"
              onClick={openAddSheet}
              className="rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white text-xs font-medium"
            >
              <UserPlus size={14} className="mr-1.5" />
              Add Staff
            </Button>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading && <LoadingRows count={4} />}

      {/* Empty state */}
      {!isLoading && users.length === 0 && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)]">
          <EmptyState
            icon={<UserCog size={24} />}
            title="No staff members found"
            subtitle={
              search
                ? "Try adjusting your search"
                : "Add your first team member"
            }
          />
        </div>
      )}

      {/* User List */}
      {!isLoading && users.length > 0 && (
        <div className="space-y-2">
          {users.map((u) => (
            <div
              key={u.id}
              className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] px-4 py-3 flex items-center gap-3"
            >
              {/* Avatar */}
              <div className="h-9 w-9 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center text-xs font-semibold text-[var(--anna-sage-dark)] shrink-0">
                {u.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
                    {u.name}
                  </p>
                  <RoleBadge
                    roleName={u.roleRel?.name || null}
                    slug={u.roleRel?.slug || u.role.toLowerCase()}
                  />
                  {u.hasPassword && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Login enabled
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--anna-muted)] truncate mt-0.5">
                  {u.email || u.contact}
                </p>
              </div>

              {/* Status */}
              <div className="hidden sm:flex items-center shrink-0">
                <StatusDot active={u.isActive} />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {can?.("v_users", "edit") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-[var(--anna-sage-light)]"
                    onClick={() => openEditSheet(u)}
                  >
                    <Pencil size={14} className="text-[var(--anna-slate-light)]" />
                  </Button>
                )}
                {can?.("v_users", "delete") && u.isActive && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-red-50"
                    onClick={() => toggleActiveMutation.mutate({ id: u.id, isActive: false })}
                  >
                    <Ban size={14} className="text-red-400" />
                  </Button>
                )}
                {can?.("v_users", "edit") && !u.isActive && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-emerald-50"
                    onClick={() => toggleActiveMutation.mutate({ id: u.id, isActive: true })}
                  >
                    <CheckCircle2 size={14} className="text-emerald-500" />
                  </Button>
                )}
                {can?.("v_users", "delete") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-red-50"
                    onClick={() => deleteMutation.mutate(u.id)}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-red-400"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editingUser ? "Edit Staff Member" : "Add Staff Member"}</SheetTitle>
            <SheetDescription>
              {editingUser
                ? "Update staff details and role assignment."
                : "Add a new team member to your vendor staff."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Full name"
                className="rounded-xl border-[var(--anna-border)] text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">Contact (Phone)</Label>
              <Input
                value={formContact}
                onChange={(e) => setFormContact(e.target.value)}
                placeholder="Phone number"
                className="rounded-xl border-[var(--anna-border)] text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Login Email
                <span className="ml-1 text-[var(--anna-muted)] font-normal">(optional — enables staff login)</span>
              </Label>
              <Input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="staff@company.com"
                className="rounded-xl border-[var(--anna-border)] text-sm"
                disabled={!!editingUser}
              />
              {editingUser && (
                <p className="text-[10px] text-[var(--anna-muted)]">Email cannot be changed after creation</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Password
                {!editingUser && formEmail && <span className="text-red-500 ml-1">*</span>}
              </Label>
              <div className="relative">
                <Input
                  type={showFormPassword ? "text" : "password"}
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder={editingUser ? "Leave blank to keep current" : "Min. 8 characters"}
                  className="rounded-xl border-[var(--anna-border)] text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowFormPassword(!showFormPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)] hover:text-[var(--anna-slate)] cursor-pointer"
                >
                  {showFormPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
              {!editingUser && formEmail && !formPassword && (
                <p className="text-[10px] text-red-500">Required when email is provided</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">Role</Label>
              <Select value={formRoleId} onValueChange={setFormRoleId}>
                <SelectTrigger className="rounded-xl border-[var(--anna-border)] text-sm">
                  <SelectValue placeholder="Select role (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="flex items-center gap-1.5">
                        {r.name}
                        {r.isSystem && (
                          <span className="text-[10px] text-[var(--anna-muted)]">
                            🔒
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formError && <p className="text-xs text-red-500">{formError}</p>}

            {(createMutation.error || updateMutation.error) && (
              <p className="text-xs text-red-500">
                {(createMutation.error as Error)?.message ||
                  (updateMutation.error as Error)?.message}
              </p>
            )}

            <Button
              className="w-full rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white text-sm font-medium"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving && <Loader2 size={14} className="mr-2 animate-spin" />}
              {editingUser ? "Save Changes" : "Add Staff Member"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
