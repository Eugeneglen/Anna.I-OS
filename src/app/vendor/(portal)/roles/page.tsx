"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
} from "@/components/ui/dropdown-menu";
import {
  Shield,
  ShieldCheck,
  Lock,
  Eye,
  MoreVertical,
  Users,
  Key,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useVendorUser } from "@/app/vendor/(portal)/layout";

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

interface PermissionDetail {
  id: string;
  module: string;
  action: string;
  description: string;
}

// ── Module Labels (friendly names for v_ prefixed modules) ──

const MODULE_LABELS: Record<string, string> = {
  v_schedule: "Schedule",
  v_calendar: "Calendar",
  v_earnings: "Earnings",
  v_staff: "Staff Roster",
  v_bookings: "Bookings",
  v_settings: "Settings",
  v_users: "User Management",
  v_roles: "Role Management",
  vendors: "Vendor Mgmt",
};

function getModuleLabel(mod: string): string {
  return MODULE_LABELS[mod] || mod.replace(/^v_/, "").replace(/_/g, " ");
}

// ── Level Indicator ──

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
  canEdit,
  isCurrentUserRole,
}: {
  role: RoleItem;
  onViewPermissions: () => void;
  onEditPermissions: () => void;
  canEdit: boolean;
  isCurrentUserRole?: boolean;
}) {
  const isAdmin = role.slug.includes("admin");
  const isManager = role.slug.includes("manager");

  return (
    <div className={cn(
      "bg-[var(--anna-white)] rounded-2xl border p-4 flex flex-col gap-3 transition-all",
      isCurrentUserRole
        ? "border-amber-300 ring-1 ring-amber-200"
        : "border-[var(--anna-border)]"
    )}>
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
            {isAdmin ? (
              <Shield size={16} className="text-[var(--anna-sage-dark)]" />
            ) : isManager ? (
              <ShieldCheck size={16} className="text-[var(--anna-sage-dark)]" />
            ) : (
              <Lock size={16} className={role.isSystem ? "text-[var(--anna-sage-dark)]" : "text-purple-600"} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-[var(--anna-slate)] truncate">
                {role.name}
              </h3>
              {role.isSystem && <Lock size={12} className="text-[var(--anna-muted)] shrink-0" />}
              {isCurrentUserRole && (
                <Badge className="text-[9px] font-bold px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-200 shrink-0">
                  <Star size={9} className="mr-0.5" />
                  Your Role
                </Badge>
              )}
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

// ── Permissions Dialog (read-only for system roles, same checkbox grid as Ops) ──

function PermissionsDialog({
  open,
  onOpenChange,
  role,
  modules,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  role: RoleItem;
  modules: ModuleInfo[];
}) {
  const isEditable = !role.isSystem;
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions));

  // Fetch full permission details for this role
  const { data: rolePermsData } = useQuery({
    queryKey: ["vendor-role-permissions", role.id],
    queryFn: async () => {
      const res = await fetch(`/api/vendor/roles/${role.id}/permissions`);
      if (!res.ok) return { role: { permissions: [] } };
      return res.json() as Promise<{
        role: { id: string; name: string; slug: string; description: string; isSystem: boolean; level: number; permissions: PermissionDetail[] };
      }>;
    },
    enabled: open,
  });

  const rolePermissions: PermissionDetail[] = rolePermsData?.role?.permissions || [];

  // Build set of "module:action" from fetched permissions
  const permSet = useMemo(() => {
    const s = new Set<string>();
    for (const p of rolePermissions) {
      s.add(`${p.module}:${p.action}`);
    }
    return s;
  }, [rolePermissions]);

  // Use the fetched permSet for the display
  const displaySet = rolePermissions.length > 0 ? permSet : selected;

  // Collect all unique actions across all modules
  const allActions = useMemo(() => {
    const actionSet = new Set<string>();
    for (const mod of modules) {
      for (const a of mod.actions) {
        actionSet.add(a);
      }
    }
    return Array.from(actionSet);
  }, [modules]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {role.name} — Permissions
          </DialogTitle>
          <DialogDescription>
            {isEditable
              ? "Toggle permissions to grant or revoke access for this role."
              : "View the permissions assigned to this system role."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6">
          {/* Column headers for actions */}
          <div className="overflow-x-auto">
            <div className="min-w-[500px]">
              {/* Header row */}
              <div
                className="grid gap-1 border-b border-[var(--anna-border)] pb-2 mb-1"
                style={{
                  gridTemplateColumns: `140px repeat(${allActions.length}, 1fr)`,
                }}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Module
                </div>
                {allActions.map((action) => (
                  <div key={action} className="flex items-center justify-center">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                      {action}
                    </span>
                  </div>
                ))}
              </div>

              {/* Module rows */}
              {modules.map((mod) => {
                const allModSelected = mod.actions.every((a) =>
                  displaySet.has(`${mod.module}:${a}`)
                );
                return (
                  <div
                    key={mod.module}
                    className="grid gap-1 border-b border-[var(--anna-border)]/50 py-2"
                    style={{
                      gridTemplateColumns: `140px repeat(${allActions.length}, 1fr)`,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      {isEditable && (
                        <Checkbox
                          checked={allModSelected}
                          onCheckedChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              for (const action of mod.actions) {
                                const key = `${mod.module}:${action}`;
                                if (allModSelected) {
                                  next.delete(key);
                                } else {
                                  next.add(key);
                                }
                              }
                              return next;
                            });
                          }}
                          className="h-3.5 w-3.5 rounded"
                        />
                      )}
                      <span className="text-xs font-medium text-[var(--anna-slate)] truncate">
                        {getModuleLabel(mod.module)}
                      </span>
                    </div>
                    {allActions.map((action) => {
                      const key = `${mod.module}:${action}`;
                      const has = mod.actions.includes(action);
                      const checked = displaySet.has(key);
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
              <span className="font-data text-[var(--anna-slate)]">{displaySet.size}</span>{" "}
              permissions assigned
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──

export default function VendorRolesPage() {
  const vendorCtx = useVendorUser();
  const can = vendorCtx?.can;

  // Permission dialog state
  const [permDialogOpen, setPermDialogOpen] = useState(false);
  const [permTargetRole, setPermTargetRole] = useState<RoleItem | null>(null);

  // ── Data fetching ──

  const { data: rolesData, isLoading } = useQuery({
    queryKey: ["vendor-roles-all"],
    queryFn: async () => {
      const res = await fetch("/api/vendor/roles");
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ roles: RoleItem[] }>;
    },
  });
  const roles: RoleItem[] = rolesData?.roles || [];

  const { data: modulesData } = useQuery({
    queryKey: ["vendor-permissions-modules"],
    queryFn: async () => {
      const res = await fetch("/api/vendor/permissions/modules");
      if (!res.ok) return { modules: [] };
      return res.json() as Promise<{ modules: ModuleInfo[] }>;
    },
  });
  const modules: ModuleInfo[] = modulesData?.modules || [];

  // ── Handlers ──

  function openPermViewer(role: RoleItem) {
    setPermTargetRole(role);
    setPermDialogOpen(true);
  }

  function openPermEditor(role: RoleItem) {
    setPermTargetRole(role);
    setPermDialogOpen(true);
  }

  // ── Render ──

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            Role Management
          </h2>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            Manage vendor team roles and permissions
          </p>
        </div>
      </div>

      {/* Current Role Banner */}
      {vendorCtx?.role && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <Star size={18} className="text-amber-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-800">Your Role: {vendorCtx.role.name}</p>
            <p className="text-xs text-amber-600">Slug: {vendorCtx.role.slug} · Level {vendorCtx.role.level}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-40 rounded-2xl bg-[var(--anna-border)]"
            />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && roles.length === 0 && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)]">
          <div className="text-center py-16">
            <div className="flex items-center justify-center mx-auto mb-3 w-14 h-14 rounded-2xl bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
              <Shield size={24} />
            </div>
            <p className="text-sm font-medium text-[var(--anna-slate)]">
              No roles configured
            </p>
            <p className="text-xs text-[var(--anna-muted)] mt-1">
              Roles define what your team members can access
            </p>
          </div>
        </div>
      )}

      {/* Role Grid */}
      {!isLoading && roles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {roles.map((role) => {
            const canEdit =
              !!can?.("v_roles", "edit") && !role.isSystem;

            const isCurrentUserRole = vendorCtx?.role?.id === role.id;

            return (
              <RoleCard
                key={role.id}
                role={role}
                onViewPermissions={() => openPermViewer(role)}
                onEditPermissions={() => openPermEditor(role)}
                canEdit={canEdit}
                isCurrentUserRole={isCurrentUserRole}
              />
            );
          })}
        </div>
      )}

      {/* Permissions Dialog */}
      {permTargetRole && (
        <PermissionsDialog
          key={permTargetRole.id}
          open={permDialogOpen}
          onOpenChange={setPermDialogOpen}
          role={permTargetRole}
          modules={modules}
        />
      )}
    </div>
  );
}
