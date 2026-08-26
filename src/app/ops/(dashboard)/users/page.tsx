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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UserPlus,
  UserCog,
  Search,
  MoreVertical,
  Pencil,
  Key,
  Ban,
  CheckCircle2,
  FileText,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { OpsPageHeader, OpsSearchInput } from "@/components/ops/ops-page-header";
import { OpsEmptyState } from "@/components/ops/ops-empty-state";
import { OpsLoadingRows } from "@/components/ops/ops-loading-skeleton";
import { AuditLogList } from "@/components/shared/audit-log-list";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";

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
  email: string;
  role: string;
  roleId: string | null;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  roleRel: RoleItem | null;
}

// ── Status badge colors ──

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

function RoleBadge({ roleName, slug }: { roleName: string | null; slug: string }) {
  const styles: Record<string, string> = {
    super_admin: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]",
    operations: "bg-purple-50 text-purple-700",
    coordinator: "bg-amber-50 text-amber-700",
    data_analyst: "bg-blue-50 text-blue-700",
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

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Page Component ──

export default function UsersPage() {
  const queryClient = useQueryClient();
  const opsCtx = useOpsUser();
  const can = opsCtx?.can;
  const currentUser = opsCtx?.user;

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Sheet state for Add/Edit
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRoleId, setFormRoleId] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");

  // Reset password dialog
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<string | null>(null);

  // ── Data fetching ──

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (roleFilter && roleFilter !== "all") params.set("roleId", roleFilter);
    if (statusFilter !== "all") {
      params.set("active", statusFilter === "active" ? "true" : "false");
    }
    return params.toString();
  }, [search, roleFilter, statusFilter]);

  const { data, isLoading } = useQuery({
    queryKey: ["ops-users", buildParams()],
    queryFn: async () => {
      const qs = buildParams();
      const res = await fetch(`/api/ops/users${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const users: UserItem[] = data?.users || [];

  const { data: rolesData } = useQuery({
    queryKey: ["ops-roles-all"],
    queryFn: async () => {
      const res = await fetch("/api/ops/roles");
      if (!res.ok) return { roles: [] };
      return res.json();
    },
  });
  const roles: RoleItem[] = rolesData?.roles || [];

  // Filter roles for the assignment dropdown:
  // 1. Exclude vendor_* roles — they belong to the vendor portal RBAC domain,
  //    not the ops portal. An ops user should never be assigned a vendor role.
  // 2. Exclude super_admin unless the current user is super_admin.
  const availableRoles = roles.filter(
    (r) => !r.slug.startsWith("vendor_") &&
      (r.slug !== "super_admin" || currentUser?.role === "ADMIN" || currentUser?.roleName === "Super Admin")
  );

  // ── Mutations ──

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, string>) => {
      const res = await fetch("/api/ops/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create user");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-users"] });
      closeSheet();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, string> }) => {
      const res = await fetch(`/api/ops/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update user");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-users"] });
      closeSheet();
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ops/users/${id}/deactivate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-users"] });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ops/users/${id}/reactivate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-users"] });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ops/users/${id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: (data) => {
      setResetResult(data.password);
    },
  });

  // Delete user (permanent — only available for deactivated users)
  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
  const [auditTarget, setAuditTarget] = useState<UserItem | null>(null);
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ops/users/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-users"] });
      setDeleteTarget(null);
    },
  });

  // ── Helpers ──

  function openAddSheet() {
    setEditingUser(null);
    setFormName("");
    setFormEmail("");
    setFormPassword("");
    setFormRoleId("");
    setFormError("");
    setShowPassword(false);
    setSheetOpen(true);
  }

  function openEditSheet(user: UserItem) {
    setEditingUser(user);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormPassword("");
    setFormRoleId(user.roleId || "");
    setFormError("");
    setShowPassword(false);
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
    if (!formEmail.trim()) { setFormError("Email is required"); return; }
    if (!editingUser && formPassword.length < 12) {
      setFormError("Password must be at least 12 characters");
      return;
    }
    if (!formRoleId) { setFormError("Role is required"); return; }

    if (editingUser) {
      updateMutation.mutate({
        id: editingUser.id,
        body: { name: formName, email: formEmail, roleId: formRoleId },
      });
    } else {
      createMutation.mutate({
        name: formName,
        email: formEmail,
        password: formPassword,
        roleId: formRoleId,
      });
    }
  }

  function handleResetPassword(userId: string) {
    setResetTarget(userId);
    setResetResult(null);
    resetPasswordMutation.mutate(userId);
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Render ──

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <OpsPageHeader
        title="User Management"
        subtitle="Manage ops team members"
        actions={
          <div className="flex items-center gap-2">
            <OpsSearchInput
              value={search}
              onChange={(v) => setSearch(v)}
              placeholder="Search name, email..."
              className="w-60"
            />
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-40 h-9 rounded-xl border-[var(--anna-border)] text-sm">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32 h-9 rounded-xl border-[var(--anna-border)] text-sm">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            {can?.("users", "create") && (
              <Button
                size="sm"
                onClick={openAddSheet}
                className="rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white text-xs font-medium"
              >
                <UserPlus size={14} className="mr-1.5" />
                Add User
              </Button>
            )}
          </div>
        }
      />

      {/* Loading */}
      {isLoading && <OpsLoadingRows count={4} rowClassName="h-20" />}

      {/* Empty state */}
      {!isLoading && users.length === 0 && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)]">
          <OpsEmptyState
            icon={<UserCog size={24} />}
            title="No users found"
            subtitle={
              search || roleFilter !== "all" || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "Add your first team member"
            }
            iconBg="bg-[var(--anna-sage-light)]"
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
                  <RoleBadge roleName={u.roleRel?.name || null} slug={u.roleRel?.slug || u.role.toLowerCase()} />
                </div>
                <p className="text-xs text-[var(--anna-muted)] truncate mt-0.5">{u.email}</p>
              </div>

              {/* Status + Last Login */}
              <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0">
                <StatusDot active={u.isActive} />
                <p className="text-[10px] text-[var(--anna-muted)] font-data">
                  {formatDateTime(u.lastLoginAt)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {can?.("users", "edit") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-[var(--anna-sage-light)]"
                    onClick={() => openEditSheet(u)}
                  >
                    <Pencil size={14} className="text-[var(--anna-slate-light)]" />
                  </Button>
                )}
                {can?.("users", "delete") && u.isActive && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-red-50"
                    onClick={() => deactivateMutation.mutate(u.id)}
                  >
                    <Ban size={14} className="text-red-400" />
                  </Button>
                )}
                {can?.("users", "edit") && !u.isActive && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-emerald-50"
                    onClick={() => reactivateMutation.mutate(u.id)}
                  >
                    <CheckCircle2 size={14} className="text-emerald-500" />
                  </Button>
                )}
                {can?.("users", "delete") && !u.isActive && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-red-50"
                    onClick={() => setDeleteTarget(u)}
                  >
                    <Trash2 size={14} className="text-red-400" />
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical size={14} className="text-[var(--anna-slate-light)]" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {can?.("users", "edit") && (
                      <DropdownMenuItem onClick={() => handleResetPassword(u.id)}>
                        <Key size={14} className="mr-2" />
                        Reset Password
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setAuditTarget(u)}>
                      <FileText size={14} className="mr-2" />
                      View Audit Log
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editingUser ? "Edit User" : "Add New User"}</SheetTitle>
            <SheetDescription>
              {editingUser
                ? "Update user details and role assignment."
                : "Create a new ops team member with a role."}
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
              <Label className="text-xs font-medium text-[var(--anna-slate)]">Email</Label>
              <Input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="email@annai.sg"
                className="rounded-xl border-[var(--anna-border)] text-sm"
              />
            </div>

            {!editingUser && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-[var(--anna-slate)]">Password</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="Min 12 characters"
                    className="rounded-xl border-[var(--anna-border)] text-sm pr-9"
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">Role</Label>
              <Select value={formRoleId} onValueChange={setFormRoleId}>
                <SelectTrigger className="rounded-xl border-[var(--anna-border)] text-sm">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="flex items-center gap-1.5">
                        {r.name}
                        {r.isSystem && (
                          <span className="text-[10px] text-[var(--anna-muted)]">🔒</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formError && (
              <p className="text-xs text-red-500">{formError}</p>
            )}

            {(createMutation.error || updateMutation.error) && (
              <p className="text-xs text-red-500">
                {(createMutation.error as Error)?.message || (updateMutation.error as Error)?.message}
              </p>
            )}

            <Button
              className="w-full rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white text-sm font-medium"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving && <Loader2 size={14} className="mr-2 animate-spin" />}
              {editingUser ? "Save Changes" : "Create User"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Reset Password Result */}
      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-6 max-w-sm w-full mx-4 shadow-lg">
            <div className="w-10 h-10 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-3">
              <Key size={20} className="text-[var(--anna-sage-dark)]" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--anna-slate)] text-center">
              New Password Generated
            </h3>
            <p className="text-xs text-[var(--anna-muted)] text-center mt-1 mb-3">
              Share this password with the user. They will need to change it on first login.
            </p>
            <div className="bg-[var(--anna-bg)] rounded-xl p-3 mb-4">
              <p className="text-sm font-mono font-medium text-[var(--anna-slate)] break-all text-center">
                {resetResult}
              </p>
            </div>
            <Button
              className="w-full rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white text-sm font-medium"
              onClick={() => setResetResult(null)}
            >
              Done
            </Button>
          </div>
        </div>
      )}

      {/* Delete User Confirm Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold text-[var(--anna-slate)]">
              Delete user permanently?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-[var(--anna-muted)]">
              You are about to permanently delete{" "}
              <span className="font-medium text-[var(--anna-slate)]">
                {deleteTarget?.name}
              </span>{" "}
              ({deleteTarget?.email}). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-red-500 hover:bg-red-600 text-white"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Audit Log Sheet */}
      <Sheet open={!!auditTarget} onOpenChange={(open) => !open && setAuditTarget(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Audit Log — {auditTarget?.name}</SheetTitle>
            <SheetDescription>
              Recent actions performed on or by this user.
            </SheetDescription>
          </SheetHeader>
          <AuditLogList userId={auditTarget?.id} scope="ops" />
        </SheetContent>
      </Sheet>
    </div>
  );
}
