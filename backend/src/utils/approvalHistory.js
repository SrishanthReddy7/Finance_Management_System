// Generic approval-history writer, reused by ExpenseClaim, Invoice, and
// VendorBill status transitions (FRS Section 28.1 -- ApprovalStep is
// deliberately a single shared table, not one per entity).

import { prisma } from "../config/db.js";

/**
 * `client` lets a caller pass a Prisma transaction client so the history row
 * commits or rolls back together with the status change it describes
 * (FRS Section 26, rule 7). Defaults to the normal client.
 */
export async function recordApprovalStep(
  { entityType, entityId, actorUserId, fromStatus, toStatus, comment = null },
  client = prisma
) {
  return client.approvalStep.create({
    data: { entityType, entityId, actorUserId, fromStatus, toStatus, comment },
  });
}

/**
 * FRS Section 11.3, "Approval history": who acted, when, from-status,
 * to-status, comment -- in order.
 *
 * ApprovalStep is polymorphic, so `actorUserId` is a plain column with no FK
 * and Prisma cannot `include` the actor. Resolve the handful of distinct
 * actors in one follow-up query instead of leaving the caller with bare ids.
 */
export async function listApprovalSteps(entityType, entityId) {
  const steps = await prisma.approvalStep.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "asc" },
  });
  if (steps.length === 0) return [];

  const actors = await prisma.user.findMany({
    where: { id: { in: [...new Set(steps.map((s) => s.actorUserId))] } },
    select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
  });
  const byId = new Map(actors.map((a) => [a.id, a]));

  return steps.map((step) => ({
    id: step.id,
    fromStatus: step.fromStatus,
    toStatus: step.toStatus,
    comment: step.comment,
    createdAt: step.createdAt,
    actor: byId.get(step.actorUserId) || { id: step.actorUserId },
  }));
}
