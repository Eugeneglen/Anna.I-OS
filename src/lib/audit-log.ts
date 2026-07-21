import { db } from "@/lib/db";

export interface LogActionParams {
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write an entry to the AuditLog table.
 * Call from API route handlers after performing mutations.
 */
export async function logAction(params: LogActionParams): Promise<void> {
  const { userId, userName, action, entityType, entityId, metadata } = params;
  await db.auditLog.create({
    data: {
      userId,
      userName,
      action,
      entityType,
      entityId: entityId ?? null,
      metadata: metadata ?? undefined,
    },
  });
}