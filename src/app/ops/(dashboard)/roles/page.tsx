"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Shield,
  ShieldCheck,
  Lock,
  Pencil,
  Trash2,
  Eye,
  MoreVertical,
  Loader2,
  Users,
  Key,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OpsPageHeader } from "@/components/ops/ops-page-header";
import { OpsEmptyState } from "@/components/ops/ops-empty-state";
import { OpsLoadingRows } from "@/components/ops/ops-loading-skeleton";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";

// ── Types ──

interface RoleItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  level: number;
  permissionCount: number;
  userCount: number;
  permissions: string[];
}

interface ModuleInfo {
  module: string;
  actions: string[];
}

// ── Level indicator ──

function LevelIndicator({ level, max = 5 }: { level: number; max?: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-1.5 w-3 rounded-full transition-colors",
            i < level
              ? "bg-[var(--anna-sage)]"
              : "bg-[var(--anna-border)]"
          )}
        />
      ))}
    </div>
  );
}

// ── Role Card ──

function RoleCard({
  role,
  onViewPermissions,
  onEditPermissions,
  onEditRole,
  onDeleteRole,
  canEdit,
  canDelete,
  currentRoleSlug,
}: {
  role: RoleItem;
  onViewPermissions: () => void;
  onEditPermissions: () => void;
  onEditRole: () => void;
  onDeleteRole: () => void;
  canEdit: boolean;
  canDelete: boolean;
  currentRoleSlug: string;
}) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "h-9 w-9 rounded-xl flex items-center justify-center shrink-0",
              role.isSystem
                ? "bg-[var(--anna-sage-light)]"
                : "bg-purple-50"
            )}
          >
            {role.isSystem ? (
              <Lock size={16} className="text-[var(--anna-sage-dark)]" />
            ) : (
              <Shield size={16} className="text-purple-600" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-[var(--anna-slate)] truncate">
                {role.name}
              </h3>
              {role.isSystem && <Lock size={12} className="text-[var(--anna-muted)] shrink-0" />}
            </div>
            <Badge
              variant="secondary"
              className="text-[9px] font-mono px-1 py-0 bg-[var(--anna-bg)] text-[var(--anna-muted)]"
            >
              {role.slug}
            </Badge>
          </div>
        </div>

        {/* Actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <MoreVertical size={14} className="text-[var(--anna-slate-light)]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onViewPermissions}>
              <Eye size={14} className="mr-2" />
              View Permissions
            </DropdownMenuItem>
            {canEdit && (
              <DropdownMenuItem onClick={onEditPermissions}>
                <Key size={14} className="mr-2" />
                Edit Permissions
              </DropdownMenuItem>
            )}
            {canEdit && (
              <DropdownMenuItem onClick={onEditRole}>
                <Pencil size={14} className="mr-2" />
                Edit Role
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-500 focus:text-red-500"
                  onClick={onDeleteRole}
                >
                  <Trash2 size={14} className="mr-2" />
                  Delete Role
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Description */}
      {role.description && (
        <p className="text-xs text-[var(--anna-muted)] line-clamp-2 leading-relaxed">
          {role.description}
        </p>
      )}

      {/* Level */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--anna-muted)]">
          Level
        </span>
        <LevelIndicator level={role.level} />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 pt-1">
        <div className="flex items-center gap-1 text-xs text-[var(--anna-slate-light)]">
          <Key size={12} className="text-[var(--anna-muted)]" />
          <span className="font-data">{role.permissionCount}</span>
          <span className="text-[var(--anna-muted)]">perms</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-[var(--anna-slate-light)]">
          <Users size={12} className="text-[var(--anna-muted)]" />
          <span className="font-data">{role.userCount}</span>
          <span className="text-[var(--anna-muted)]">users</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 rounded-xl border-[var(--anna-border)] text-xs font-medium"
          onClick={onViewPermissions}
        >
          <Eye size={12} className="mr-1.5" />
          Permissions
        </Button>
        {canEdit && (
          <Button
            size="sm"
            className="flex-1 rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white text-xs font-medium"
            onClick={onEditPermissions}
          >
            <ShieldCheck size={12} className="mr-1.5" />
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Permission Editor Sheet ──

function PermissionEditorSheet({
  open,
  onOpenChange,
  roleName,
  roleId,
  currentPermissions,
  isEditable,
  modules,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roleName: string;
  roleId: string;
  currentPermissions: string[];
  isEditable: boolean;
  modules: ModuleInfo[];
  onSave: (permissionIds: string[]) => void;
  isSaving: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentPermissions));

  const allActions = ["view", "create", "edit", "delete", "export", "approve", "assign", "configure"];

  // Build a lookup: "module:action" → permissionId
  // We need permission IDs from the API. For now, we'll work with string permission keys.
  // The PUT endpoint takes permissionIds[], so we need to fetch all permissions.
  // We'll build a permission key → id map.

  const togglePermission = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  function toggleModuleModule(module: string, actions: string[]) {
    const allSelected = actions.every((a) => selected.has(`${module}:${a}`));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const action of actions) {
        const key = `${module}:${action}`;
        if (allSelected) {
          next.delete(key);
        } else {
          next.add(key);
        }
      }
      return next;
    });
  }

  function toggleAction(action: string, modules: ModuleInfo[]) {
    const allSelected = modules
      .filter((m) => m.actions.includes(action))
      .every((m) => selected.has(`${m.module}:${action}`));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const m of modules) {
        if (m.actions.includes(action)) {
          const key = `${m.module}:${action}`;
          if (allSelected) {
            next.delete(key);
          } else {
            next.add(key);
          }
        }
      }
      return next;
    });
  }

  // We need to map permission keys to IDs. We'll fetch all permissions for the ID map.
  const { data: permsData } = useQuery({
    queryKey: ["ops-permissions-all"],
    queryFn: async () => {
      const res = await fetch("/api/ops/permissions");
      if (!res.ok) return { permissions: [] };
      return res.json();
    },
    enabled: open && isEditable,
  });

  const permIdMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of permsData?.permissions || []) {
      map.set(`${p.module}:${p.action}`, p.id);
    }
    return map;
  }, [permsData]);

  function handleSave() {
    const ids: string[] = [];
    for (const key of selected) {
      const id = permIdMap.get(key);
      if (id) ids.push(id);
    }
    onSave(ids);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {roleName} — Permissions
          </SheetTitle>
          <SheetDescription>
            {isEditable
              ? "Toggle permissions to grant or revoke access for this role."
              : "View the permissions assigned to this system role."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          {/* Column headers for actions */}
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              {/* Header row */}
              <div className="grid gap-1 border-b border-[var(--anna-border)] pb-2 mb-1" style={{ gridTemplateColumns: "140px repeat(8, 1fr)" }}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Module
                </div>
                {allActions.map((action) => (
                  <div key={action} className="flex items-center justify-center">
                    {isEditable ? (
                      <button
                        onClick={() => toggleAction(action, modules)}
                        className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] hover:text-[var(--anna-slate)] cursor-pointer"
                      >
                        {action}
                      </button>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                        {action}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Module rows */}
              {modules.map((mod) => {
                const allModSelected = mod.actions.every((a) =>
                  selected.has(`${mod.module}:${a}`)
                );
                return (
                  <div
                    key={mod.module}
                    className="grid gap-1 border-b border-[var(--anna-border)]/50 py-2"
                    style={{ gridTemplateColumns: "140px repeat(8, 1fr)" }}
                  >
                    <div className="flex items-center gap-1.5">
                      {isEditable && (
                        <Checkbox
                          checked={allModSelected}
                          onCheckedChange={() =>
                            toggleModuleModule(mod.module, mod.actions)
                          }
                          className="h-3.5 w-3.5 rounded"
                        />
                      )}
                      <span className="text-xs font-medium text-[var(--anna-slate)] truncate">
                        {mod.module}
                      </span>
                    </div>
                    {allActions.map((action) => {
                      const key = `${mod.module}:${action}`;
                      const has = mod.actions.includes(action);
                      const checked = selected.has(key);
                      return (
                        <div key={action} className="flex items-center justify-center">
                          {has ? (
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() =>
                                isEditable && togglePermission(key)
                              }
                              disabled={!isEditable}
                              className="h-3.5 w-3.5 rounded"
                            />
                          ) : (
                            <div className="h-3.5 w-3.5 rounded border border-[var(--anna-border)]/30 bg-[var(--anna-bg)]/50" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-[var(--anna-muted)]">
              <span className="font-data text-[var(--anna-slate)]">{selected.size}</span>{" "}
              permissions selected
            </p>
            {isEditable && (
              <Button
                size="sm"
                className="rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white text-xs font-medium"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Save Permissions
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Create Role Dialog ──

function CreateRoleDialog({
  open,
  onOpenChange,
  onCreate,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (data: { name: string; slug: string; description: string; level: number; permissionIds: string[] }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState(1);
  const [error, setError] = useState("");

  // Auto-generate slug from name
  function handleNameChange(val: string) {
    setName(val);
    setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, ""));
  }

  function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Name is required"); return; }
    if (!slug.trim()) { setError("Slug is required"); return; }
    onCreate({ name: name.trim(), slug: slug.trim(), description: description.trim(), level, permissionIds: [] });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Role</DialogTitle>
          <DialogDescription>
            Define a custom role with specific permissions.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[var(--anna-slate)]">Role Name</Label>
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Field Supervisor"
              className="rounded-xl border-[var(--anna-border)] text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[var(--anna-slate)]">Slug</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="field_supervisor"
              className="rounded-xl border-[var(--anna-border)] text-sm font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[var(--anna-slate)]">Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief role description"
              className="rounded-xl border-[var(--anna-border)] text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[var(--anna-slate)]">
              Access Level: {level}
            </Label>
            <div className="flex items-center gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setLevel(i + 1)}
                  className={cn(
                    "h-8 w-10 rounded-lg text-xs font-bold transition-colors",
                    i < level
                      ? "bg-[var(--anna-sage)] text-white"
                      : "bg-[var(--anna-bg)] text-[var(--anna-muted)] border border-[var(--anna-border)]"
                  )}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <Button
            className="w-full rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white text-sm font-medium"
            onClick={handleSubmit}
            disabled={isSaving}
          >
            {isSaving && <Loader2 size={14} className="mr-2 animate-spin" />}
            Create Role
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Role Dialog ──

function EditRoleDialog({
  open,
  onOpenChange,
  role,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  role: RoleItem;
  onSave: (data: { name?: string; description?: string | null; level?: number }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description || "");
  const [level, setLevel] = useState(role.level);

  function handleSubmit() {
    const data: { name?: string; description?: string | null; level?: number } = {};
    if (name.trim() !== role.name) data.name = name.trim();
    data.description = description.trim() || null;
    if (level !== role.level) data.level = level;
    onSave(data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Role</DialogTitle>
          <DialogDescription>
            {role.isSystem
              ? "System roles can only have their description updated."
              : "Update role details."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[var(--anna-slate)]">Role Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={role.isSystem}
              className="rounded-xl border-[var(--anna-border)] text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[var(--anna-slate)]">Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief role description"
              className="rounded-xl border-[var(--anna-border)] text-sm"
            />
          </div>

          {!role.isSystem && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Access Level: {level}
              </Label>
              <div className="flex items-center gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setLevel(i + 1)}
                    className={cn(
                      "h-8 w-10 rounded-lg text-xs font-bold transition-colors",
                      i < level
                        ? "bg-[var(--anna-sage)] text-white"
                        : "bg-[var(--anna-bg)] text-[var(--anna-muted)] border border-[var(--anna-border)]"
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button
            className="w-full rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white text-sm font-medium"
            onClick={handleSubmit}
            disabled={isSaving}
          >
            {isSaving && <Loader2 size={14} className="mr-2 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──

export default function RolesPage() {
  const queryClient = useQueryClient();
  const opsCtx = useOpsUser();
  const can = opsCtx?.can;
  const currentUser = opsCtx?.user;
  const currentRoleSlug = currentUser?.roleName?.toLowerCase().includes("super") ? "super_admin" : "";

  // Permission editor state
  const [permSheetOpen, setPermSheetOpen] = useState(false);
  const [permTargetRole, setPermTargetRole] = useState<RoleItem | null>(null);
  const [permEditable, setPermEditable] = useState(false);

  // Create dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Edit dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTargetRole, setEditTargetRole] = useState<RoleItem | null>(null);

  // ── Data fetching ──

  const { data: rolesData, isLoading } = useQuery({
    queryKey: ["ops-roles-all"],
    queryFn: async () => {
      const res = await fetch("/api/ops/roles");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const roles: RoleItem[] = rolesData?.roles || [];

  const { data: modulesData } = useQuery({
    queryKey: ["ops-permissions-modules"],
    queryFn: async () => {
      const res = await fetch("/api/ops/permissions/modules");
      if (!res.ok) return { modules: [] };
      return res.json();
    },
  });
  const modules: ModuleInfo[] = modulesData?.modules || [];

  // ── Mutations ──

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ops/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ops-roles-all"] });
      setCreateDialogOpen(false);
      // Open permission editor for the newly created role
      if (data?.role?.id) {
        const newRole = { ...data.role, permissionCount: 0, userCount: 0, permissions: [] };
        setPermTargetRole(newRole);
        setPermEditable(true);
        setPermSheetOpen(true);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/ops/roles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-roles-all"] });
      setEditDialogOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ops/roles/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-roles-all"] });
    },
  });

  const savePermissionsMutation = useMutation({
    mutationFn: async ({ id, permissionIds }: { id: string; permissionIds: string[] }) => {
      const res = await fetch(`/api/ops/roles/${id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-roles-all"] });
      setPermSheetOpen(false);
    },
  });

  // ── Handlers ──

  function openPermViewer(role: RoleItem) {
    setPermTargetRole(role);
    setPermEditable(!role.isSystem || currentRoleSlug === "super_admin");
    setPermSheetOpen(true);
  }

  function openPermEditor(role: RoleItem) {
    setPermTargetRole(role);
    setPermEditable(true);
    setPermSheetOpen(true);
  }

  function handleSavePermissions(permissionIds: string[]) {
    if (permTargetRole) {
      savePermissionsMutation.mutate({ id: permTargetRole.id, permissionIds });
    }
  }

  // ── Render ──

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <OpsPageHeader
        title="Role Management"
        subtitle={`${roles.length} roles configured`}
        actions={
          can?.("roles", "create") && (
            <Button
              size="sm"
              onClick={() => setCreateDialogOpen(true)}
              className="rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white text-xs font-medium"
            >
              <Plus size={14} className="mr-1.5" />
              New Role
            </Button>
          )
        }
      />

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <OpsLoadingRows count={4} rowClassName="h-40" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && roles.length === 0 && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)]">
          <OpsEmptyState
            icon={<Shield size={24} />}
            title="No roles configured"
            subtitle="Create roles to manage access permissions"
            iconBg="bg-[var(--anna-sage-light)]"
          />
        </div>
      )}

      {/* Role Grid */}
      {!isLoading && roles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {roles.map((role) => {
            const canEdit = can?.("roles", "edit") && (!role.isSystem || currentRoleSlug === "super_admin");
            const canDelete = can?.("roles", "delete") && !role.isSystem && role.userCount === 0;

            return (
              <RoleCard
                key={role.id}
                role={role}
                onViewPermissions={() => openPermViewer(role)}
                onEditPermissions={() => openPermEditor(role)}
                onEditRole={() => {
                  setEditTargetRole(role);
                  setEditDialogOpen(true);
                }}
                onDeleteRole={() => deleteMutation.mutate(role.id)}
                canEdit={!!canEdit}
                canDelete={!!canDelete}
                currentRoleSlug={currentRoleSlug}
              />
            );
          })}
        </div>
      )}

      {/* Permission Editor Sheet */}
      {permTargetRole && (
        <PermissionEditorSheet
          key={permTargetRole.id}
          open={permSheetOpen}
          onOpenChange={setPermSheetOpen}
          roleName={permTargetRole.name}
          roleId={permTargetRole.id}
          currentPermissions={permTargetRole.permissions}
          isEditable={permEditable}
          modules={modules}
          onSave={handleSavePermissions}
          isSaving={savePermissionsMutation.isPending}
        />
      )}

      {/* Create Role Dialog */}
      <CreateRoleDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={(data) => createMutation.mutate(data)}
        isSaving={createMutation.isPending}
      />

      {/* Edit Role Dialog */}
      {editTargetRole && (
        <EditRoleDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          role={editTargetRole}
          onSave={(data) =>
            updateMutation.mutate({ id: editTargetRole.id, body: data })
          }
          isSaving={updateMutation.isPending}
        />
      )}
    </div>
  );
}
