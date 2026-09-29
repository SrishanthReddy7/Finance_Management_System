// Generic audit-log writer (FRS Section 24). Every module that mutates a
// financial/user record calls this ONE function -- never write to the
// AuditLog table directly from a service, so the shape stays consistent.

import { prisma } from "../../config/db.js";

/**
 * `client` lets a caller pass a Prisma transaction client, so the audit row
 * commits or rolls back together with the change it records. FRS Section 26,
 * rule 7 requires every status transition to have an audit entry -- writing
 * it outside the transaction would let the two drift apart on failure.
 */
export async function writeAuditLog(
  { entityType, entityId, action, performedById, previousValue = null, newValue = null, note = null },
  client = prisma
) {
  return client.auditLog.create({
    data: { entityType, entityId, action, performedById, previousValue, newValue, note },
  });
}

/**
 * FRS Section 29.9 `GET /audit-logs`, Section 31 "filterable by entity/user/date".
 */
export async function listAuditLogs({ entityType, entityId, performedById, from, to, skip, take }) {
  const where = {};
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (performedById) where.performedById = performedById;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [rows, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: { performedBy: { select: { id: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, totalCount };
}

/**
 * Section 24 stores "JSON snapshots of the changed fields only (not the whole
 * row, to keep entries small)". Shared so every module diffs the same way.
 */
export function diffChangedFields(before, after, fields) {
  const previousValue = {};
  const newValue = {};
  for (const field of fields) {
    if (before[field] !== after[field]) {
      previousValue[field] = before[field];
      newValue[field] = after[field];
    }
  }
  return { previousValue, newValue, changed: Object.keys(newValue).length > 0 };
}
