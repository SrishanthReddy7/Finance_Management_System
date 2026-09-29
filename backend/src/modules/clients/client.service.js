// Client Management (FRS Section 13.1, 29.5, 31 "Clients").
//
// Clients are company-level master data, not per-employee data, so there is no
// hierarchy scoping here -- authorization is a flat permission gate applied at
// the route layer (MANAGE_CLIENTS for writes, authenticated for reads, per
// FRS 29.5 "read: broader"). Nothing in this file re-checks permissions.
//
// A client is never hard-deleted (Section 26 rule 6): it is retired by moving
// status to INACTIVE via PATCH, because Project and Invoice rows keep pointing
// at it.

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog, diffChangedFields } from "../audit/audit.service.js";

const ENTITY_TYPE = "Client";

// The mutable columns, in the order FRS 13.1 lists them. Used for the audit
// diff so a snapshot only ever contains fields that actually changed.
const AUDITED_FIELDS = [
  "name",
  "contactEmail",
  "contactPhone",
  "billingAddress",
  "gstin",
  "paymentTerms",
  "currency",
  "status",
];

// Counts only -- the rows themselves belong to the Projects and Invoicing
// modules, which are not built yet and must not be leaked through this one.
const RELATION_COUNT = { select: { projects: true, invoices: true } };

// ---------------------------------------------------------------------------
// Warnings (non-blocking)
// ---------------------------------------------------------------------------

/**
 * The FRS never asks for client-name uniqueness and the Client table has no
 * unique constraint on `name`, so a duplicate is reported rather than blocked
 * -- the same "warn, don't block" shape the expenses module uses for duplicate
 * claims. Two real clients can legitimately share a name.
 */
async function findClientsWithSameName(name, excludeId = null) {
  if (!name) return [];

  return prisma.client.findMany({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true, status: true },
  });
}

async function buildClientWarnings(name, excludeId = null) {
  const warnings = [];

  const duplicates = await findClientsWithSameName(name, excludeId);
  if (duplicates.length > 0) {
    warnings.push({
      code: "DUPLICATE_CLIENT_NAME",
      message: `${duplicates.length} other client(s) already use the name "${name}".`,
      clients: duplicates,
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listClients({ status, search, skip, take }) {
  const where = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { contactEmail: { contains: search, mode: "insensitive" } },
      { gstin: { contains: search, mode: "insensitive" } },
    ];
  }

  const [rows, totalCount] = await Promise.all([
    prisma.client.findMany({
      where,
      skip,
      take,
      orderBy: { name: "asc" },
      include: { _count: RELATION_COUNT },
    }),
    prisma.client.count({ where }),
  ]);

  return { rows, totalCount };
}

export async function getClientOr404(clientId) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { _count: RELATION_COUNT },
  });
  if (!client) throw new AppError(404, "Client not found.");
  return client;
}

/**
 * Guard for any future module that writes a Client foreign key (Projects,
 * Invoices). Exported now so those modules reuse it instead of re-deriving the
 * rule, mirroring departments.assertDepartmentAssignable. Nothing calls it yet.
 */
export async function assertClientExists(clientId) {
  if (!clientId) return null;

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new AppError(400, "The specified client does not exist.");
  return client;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createClient(actingUser, input) {
  const client = await prisma.$transaction(async (tx) => {
    const row = await tx.client.create({
      data: {
        name: input.name,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        billingAddress: input.billingAddress ?? null,
        gstin: input.gstin ?? null,
        paymentTerms: input.paymentTerms ?? null,
        // currency and status are omitted when not supplied so the schema
        // defaults ("INR" / ACTIVE) apply rather than being overwritten.
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });

    // Section 26 rule 7 / Section 24: the audit row commits with the change it
    // records, never separately.
    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: row.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: {
          name: row.name,
          gstin: row.gstin,
          currency: row.currency,
          status: row.status,
        },
      },
      tx
    );

    return row;
  });

  return { ...client, warnings: await buildClientWarnings(client.name, client.id) };
}

export async function updateClient(actingUser, clientId, input) {
  const existing = await getClientOr404(clientId);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.client.update({
      where: { id: clientId },
      data: input,
      include: { _count: RELATION_COUNT },
    });

    const { previousValue, newValue, changed } = diffChangedFields(existing, row, AUDITED_FIELDS);

    // A PATCH that sets every field to the value it already had is a no-op:
    // recording it would pad the trail with empty diffs.
    if (changed) {
      await writeAuditLog(
        {
          entityType: ENTITY_TYPE,
          entityId: clientId,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue,
          newValue,
        },
        tx
      );
    }

    return row;
  });

  return { ...updated, warnings: await buildClientWarnings(updated.name, updated.id) };
}
