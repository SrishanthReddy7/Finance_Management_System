// Zod layer for Project Management (FRS Section 13.2/13.3, 27, 29.5).
//
// Schemas are .strict() so an unknown key (or an attempt to PATCH `id` /
// `createdAt` / `updatedAt`) is a clean 400 instead of being silently dropped
// -- the same convention the clients module established.

import { z } from "zod";

// FRS Section 27 status table / the live Prisma enums.
export const PROJECT_STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];
export const BILLING_MODELS = ["FIXED_PRICE", "MILESTONE", "TIME_AND_MATERIAL", "RETAINER"];
export const MILESTONE_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

// Accepts either a plain date ("2026-01-15") or a full ISO timestamp, and
// hands the service a real Date. Expenses only accept .datetime(), which
// rejects the date-only form a date picker usually sends.
const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Must be a valid ISO date (YYYY-MM-DD or full ISO timestamp).")
  .transform((v) => new Date(v));

const uuid = (label) => z.string().uuid(`${label} must be a valid UUID.`);

// Money: Decimal(14,2) in the schema, so reject more than 2 decimal places
// rather than letting Postgres silently round a caller's third digit away.
const money = z
  .number()
  .nonnegative("Must not be negative.")
  .max(9_999_999_999.99, "Exceeds the maximum storable amount.")
  .refine((v) => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: "Must have at most 2 decimal places.",
  });

const name = z.string().trim().min(1, "Project name is required.").max(200);
const description = z.string().trim().max(1000);

// FRS 13.4: the allocation percentage is the whole basis of the cost side, so
// it has to be a sane 1-100 integer -- 0% is not an allocation, it is a gap.
const allocationPercent = z
  .number()
  .int("Allocation must be a whole number of percent.")
  .min(1, "Allocation must be at least 1%.")
  .max(100, "Allocation cannot exceed 100%.");

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

// `endDate` is the project deadline (FRS 13.2 "start/end date"). Checked
// against startDate here rather than in the service: it needs no database.
const endAfterStart = (body) => {
  if (!body.startDate || !body.endDate) return true;
  return body.endDate >= body.startDate;
};
const END_AFTER_START = { message: "endDate must be on or after startDate.", path: ["endDate"] };

export const createProjectSchema = z
  .object({
    name,
    clientId: uuid("clientId"),
    projectManagerId: uuid("projectManagerId").optional(),
    contractValue: money.optional(),
    billingModel: z.enum(BILLING_MODELS),
    startDate: isoDate,
    endDate: isoDate.optional(),
    // Omitted -> the schema default PLANNED applies. Allowed at creation so a
    // project already under way can be entered directly; later changes go
    // through the Section 27 transition guard either way.
    status: z.enum(PROJECT_STATUSES).optional(),
  })
  .strict()
  .refine(endAfterStart, END_AFTER_START);

// FRS 29.5 documents exactly one mutation endpoint for a project --
// PATCH /projects/:id -- so `status` has to be settable here. It does NOT get a
// free pass around the Section 27 lifecycle: the service runs it through the
// same transition guard PATCH /:id/status uses, so neither route can put a
// project into a state the other would refuse.
//
// `comment` is the cancellation reason (Section 24 `note`), not a column; the
// service strips it before the write.
export const updateProjectSchema = z
  .object({
    name: name.optional(),
    clientId: uuid("clientId").optional(),
    projectManagerId: uuid("projectManagerId").nullable().optional(),
    contractValue: money.nullable().optional(),
    billingModel: z.enum(BILLING_MODELS).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.nullable().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    comment: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).filter((k) => k !== "comment").length > 0, {
    message: "Provide at least one field to update.",
  })
  .refine(endAfterStart, END_AFTER_START);

// FRS Section 26 rule 6: a project is retired by status, never deleted.
export const setProjectStatusSchema = z
  .object({
    status: z.enum(PROJECT_STATUSES),
    comment: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const listProjectsQuerySchema = z
  .object({
    status: z.enum(PROJECT_STATUSES).optional(),
    billingModel: z.enum(BILLING_MODELS).optional(),
    clientId: uuid("clientId").optional(),
    projectManagerId: uuid("projectManagerId").optional(),
    // "Which projects is this employee allocated to?" -- FRS 13.2 employee
    // allocation, read from the projects side so the employees module is
    // left untouched.
    employeeId: uuid("employeeId").optional(),
    search: z.string().trim().min(1).max(200).optional(),
    // Pagination keys are consumed by getPagination, so this is not .strict().
  });

export const projectIdParamSchema = z.object({
  id: uuid("Project id"),
});

// ---------------------------------------------------------------------------
// Members (FRS 13.2 "employee allocation", 29.5 POST /projects/:id/members)
// ---------------------------------------------------------------------------

export const addMemberSchema = z
  .object({
    employeeId: uuid("employeeId"),
    allocationPercent: allocationPercent.optional(),
    // Defaults to the project's own startDate in the service when omitted.
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .strict()
  .refine(endAfterStart, END_AFTER_START);

// There is no DELETE for an allocation: ending it sets endDate, which keeps
// the historical cost contribution intact for profitability (Section 26 r6).
export const updateMemberSchema = z
  .object({
    allocationPercent: allocationPercent.optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  })
  .refine(endAfterStart, END_AFTER_START);

export const memberIdParamSchema = z.object({
  id: uuid("Project id"),
  memberId: uuid("Member id"),
});

// ---------------------------------------------------------------------------
// Milestones (FRS 13.3 -- Milestone is the billing model actually in use,
// per Section 38 Q22)
// ---------------------------------------------------------------------------

export const createMilestoneSchema = z
  .object({
    name,
    description: description.optional(),
    amount: money.optional(),
    dueDate: isoDate.optional(),
    sequence: z.number().int().min(0).max(999).optional(),
  })
  .strict();

export const updateMilestoneSchema = z
  .object({
    name: name.optional(),
    description: description.nullable().optional(),
    amount: money.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    sequence: z.number().int().min(0).max(999).optional(),
    // completedAt is derived from this, never set by the caller.
    status: z.enum(MILESTONE_STATUSES).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  });

export const milestoneIdParamSchema = z.object({
  id: uuid("Project id"),
  milestoneId: uuid("Milestone id"),
});
