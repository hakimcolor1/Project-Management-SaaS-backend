import type { Prisma } from "../generated/prisma/client.js";

/** Every audited action. Stored as plain strings so new actions need no migration. */
export const AuditAction = {
  ORGANIZATION_CREATED: "ORGANIZATION_CREATED",
  ORGANIZATION_UPDATED: "ORGANIZATION_UPDATED",
  ORGANIZATION_STATUS_CHANGED: "ORGANIZATION_STATUS_CHANGED",
  MEMBER_ADDED: "MEMBER_ADDED",
  MEMBER_UPDATED: "MEMBER_UPDATED",
  MEMBER_REMOVED: "MEMBER_REMOVED",
  PROJECT_CREATED: "PROJECT_CREATED",
  PROJECT_UPDATED: "PROJECT_UPDATED",
  PROJECT_DELETED: "PROJECT_DELETED",
  TASK_CREATED: "TASK_CREATED",
  TASK_UPDATED: "TASK_UPDATED",
  TASK_STATUS_CHANGED: "TASK_STATUS_CHANGED",
  TASK_ASSIGNED: "TASK_ASSIGNED",
  TASK_DELETED: "TASK_DELETED",
  PAYMENT_INITIATED: "PAYMENT_INITIATED",
  PAYMENT_SUCCEEDED: "PAYMENT_SUCCEEDED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  SUBSCRIPTION_ACTIVATED: "SUBSCRIPTION_ACTIVATED",
  PLAN_UPDATED: "PLAN_UPDATED",
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditEntity = {
  ORGANIZATION: "Organization",
  MEMBER: "OrganizationMember",
  PROJECT: "Project",
  TASK: "Task",
  PAYMENT: "Payment",
  SUBSCRIPTION: "Subscription",
  PLAN: "SubscriptionPlan",
} as const;
export type AuditEntity = (typeof AuditEntity)[keyof typeof AuditEntity];

export interface AuditEntry {
  /** null for system actions (e.g. a gateway IPN). */
  userId: string | null;
  organizationId: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Records an audit entry. Pass the transaction client so the log entry is
 * written atomically with the change it describes.
 */
export const recordAuditLog = (db: Prisma.TransactionClient, entry: AuditEntry) =>
  db.auditLog.create({
    data: {
      userId: entry.userId,
      organizationId: entry.organizationId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      ...(entry.metadata !== undefined && { metadata: entry.metadata }),
    },
    select: { id: true },
  });
