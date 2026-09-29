// Project Management (FRS Section 13.2/13.3/13.4, 27, 29.5, 31 "Projects").
//
// What lives here: everything that needs the record itself -- relationship
// validation, status-transition rules, allocation rules, and the financial
// rollups. Permission gating does NOT live here: MANAGE_PROJECTS is applied at
// the route layer via requirePermission (which carries the Super Admin bypass),
// exactly as expenses and clients do.
//
// The one authorization concept that *is* here is visibility scoping, because
// it needs the data: FRS 29.5 gates /projects on MANAGE_PROJECTS, but an
// allocated employee still has to see the project they are booking expenses
// against. Scoping follows the shape expenses already uses (listClaims):
// full visibility for the permission holders, own-projects-only for everyone
// else. Nothing is hard-deleted (Section 26 rule 6).

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { ACTUAL_BILL_STATUSES, PENDING_BILL_STATUSES } from "../vendors/vendorBill.constants.js";
import { ACTUAL_EXPENSE_STATUSES, PENDING_EXPENSE_STATUSES } from "../expenses/expense.constants.js";
import { REVENUE_INVOICE_STATUSES } from "../invoice/invoice.constants.js";
import { writeAuditLog, diffChangedFields } from "../audit/audit.service.js";
import { assertClientExists } from "../clients/client.service.js";
import { getReviewableEmployeeIds, getSuperAdminEmployeeIds } from "../../utils/hierarchy.js";
import { monthlyCostFromStructures } from "../salaries/salary.service.js";

const ENTITY_TYPE = "Project";
const MEMBER_ENTITY_TYPE = "ProjectMember";
const MILESTONE_ENTITY_TYPE = "ProjectMilestone";

// Audit snapshots carry changed fields only (Section 24).
const PROJECT_FIELDS = [
  "name",
  "clientId",
  "projectManagerId",
  "contractValue",
  "billingModel",
  "startDate",
  "endDate",
  "status",
];
const MEMBER_FIELDS = ["allocationPercent", "startDate", "endDate"];
const MILESTONE_FIELDS = ["name", "description", "amount", "dueDate", "sequence", "status"];

// FRS Section 27 lifecycle for Project. COMPLETED and CANCELLED are terminal
// -- a finished project is corrected by editing its fields, not by reopening
// it, which would silently rewrite historical profitability.
const STATUS_TRANSITIONS = {
  PLANNED: ["ACTIVE", "ON_HOLD", "CANCELLED"],
  ACTIVE: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

// A project in one of these is closed for new spend/allocation.
const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED"];

// Average Gregorian month, used to prorate a partial month of allocation.
const MS_PER_MONTH = 30.4375 * 24 * 60 * 60 * 1000;

/**
 * Allocation windows are floored to whole UTC days. Without this the cost side
 * accrues per-millisecond, so two calls to /profitability seconds apart return
 * different numbers and nothing downstream can be reconciled. Salary accrues
 * daily at the finest, so a day is the honest resolution.
 */
function startOfUtcDay(value) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Employment states in which a person can still be newly allocated to work.
const ALLOCATABLE_EMPLOYMENT = ["ACTIVE", "PROBATION", "NOTICE_PERIOD"];

// FRS 13.4 "Project Revenue = sum of Paid + Sent invoice amounts": imported
// from invoice/invoice.constants.js so the Reports module classifies the same
// statuses the same way, rather than a second copy that could drift.

// FRS 19 lists vendor bills alongside expenses and salary allocations as the
// three things that make up "actual spending" for a scope. Imported from the
// vendors module rather than restated here, so approving a bill and costing it
// to a project can never disagree about which statuses count.
// (From vendorBill.constants.js, not the service, to avoid an import cycle.)

// Section 26 rule 10: "actual spend" is computed, never entered. A claim is
// actual spend once Finance has approved it; anything earlier is a commitment.
// (Imported from expenses/expense.constants.js so the Budgets module classifies
// the same statuses the same way, rather than a second copy that could drift.)

const CLIENT_SELECT = { id: true, name: true, status: true, currency: true };
const EMPLOYEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  designation: true,
  status: true,
};

const PROJECT_INCLUDE = {
  client: { select: CLIENT_SELECT },
  projectManager: { select: EMPLOYEE_SELECT },
  _count: { select: { members: true, milestones: true, invoices: true, expenseClaims: true, budgets: true } },
};

// ---------------------------------------------------------------------------
// Small numeric helpers -- Prisma hands back Decimal, not Number.
// ---------------------------------------------------------------------------

const num = (value) => (value == null ? 0 : Number(value));
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Visibility scoping
// ---------------------------------------------------------------------------

/**
 * Who sees every project: Super Admin (Section 30 bypass), MANAGE_PROJECTS
 * holders (the Section 29.5 gate), and VIEW_FINANCIAL_REPORTS holders (Finance,
 * who must be able to reconcile spend against any project).
 */
export function canSeeAllProjects(actingUser) {
  if (actingUser.roleType === "SUPER_ADMIN") return true;
  const codes = actingUser.permissionCodes || [];
  return codes.includes("MANAGE_PROJECTS") || codes.includes("VIEW_FINANCIAL_REPORTS");
}

/** The `where` fragment limiting a non-privileged user to their own projects. */
function ownProjectsWhere(employeeId) {
  return {
    OR: [{ projectManagerId: employeeId }, { members: { some: { employeeId } } }],
  };
}

/**
 * FRS 29.5: profitability is for "`VIEW_FINANCIAL_REPORTS` or assigned PM".
 * The assigned-PM half is why Project carries projectManagerId at all.
 */
export function isAssignedProjectManager(actingUser, project) {
  return Boolean(actingUser.employee?.id) && project.projectManagerId === actingUser.employee.id;
}

/**
 * FRS 29.5 gates profitability on "`VIEW_FINANCIAL_REPORTS` or assigned PM".
 * requirePermission cannot express the "or assigned PM" half on its own, so the
 * route composes this instead -- authorization still resolved at the route
 * layer, just with the one database lookup the rule genuinely needs.
 *
 * Note this is deliberately stricter than Section 31's looser "Admin/PM"
 * wording for the Projects *page*: these figures expose implied salary cost,
 * which Section 8 treats as the most sensitive data in the system, so the
 * narrower Section 29.5 API rule wins.
 */
/**
 * The "privileged" half of assertCanViewProjectFinancials -- exported so the
 * Reports module's project-profitability LIST (FRS 22) can apply the exact
 * same narrow rule at query time across many projects, instead of the looser
 * canSeeAllProjects (which also grants plain MANAGE_PROJECTS holders, not
 * appropriate here since these figures expose implied salary cost).
 */
export function canViewAllProjectFinancials(actingUser) {
  return actingUser.roleType === "SUPER_ADMIN" || Boolean(actingUser.permissionCodes?.includes("VIEW_FINANCIAL_REPORTS"));
}

export async function assertCanViewProjectFinancials(actingUser, projectId) {
  if (canViewAllProjectFinancials(actingUser)) return;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { projectManagerId: true },
  });
  if (!project) throw new AppError(404, "Project not found.");
  if (isAssignedProjectManager(actingUser, project)) return;

  throw new AppError(
    403,
    "Missing required permission: VIEW_FINANCIAL_REPORTS (or be the project's assigned manager)."
  );
}

// ---------------------------------------------------------------------------
// Relationship validation (all IDs are checked server-side, FRS 8.3)
// ---------------------------------------------------------------------------

async function assertEmployeeAllocatable(employeeId, { requireActive = true } = {}) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { ...EMPLOYEE_SELECT, userId: true },
  });
  if (!employee) throw new AppError(400, "The specified employee does not exist.");
  if (requireActive && !ALLOCATABLE_EMPLOYMENT.includes(employee.status)) {
    throw new AppError(400, `${employee.firstName} ${employee.lastName} is ${employee.status} and cannot be allocated.`);
  }
  return employee;
}

/**
 * Shared guard for any module that writes a Project foreign key -- currently
 * the expenses module, which previously had its own local copy that only
 * checked existence. A CANCELLED project must not accrue new spend, or its
 * profitability figure stops meaning anything. COMPLETED is deliberately still
 * allowed: invoices and reimbursements legitimately arrive after delivery.
 */
export async function assertProjectAssignable(projectId) {
  if (!projectId) return null;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, status: true },
  });
  if (!project) throw new AppError(400, "The specified project does not exist.");
  if (project.status === "CANCELLED") {
    throw new AppError(400, `Project "${project.name}" is cancelled and cannot be assigned new records.`);
  }
  return project;
}

// ---------------------------------------------------------------------------
// Derived, non-financial project facts
// ---------------------------------------------------------------------------

/**
 * FRS 13.2 asks for progress and deadlines but the schema stores neither as a
 * column. Rather than invent a hand-maintained percentage that immediately
 * goes stale, progress is derived from milestone completion (Section 13.3's
 * "each invoiced on completion" makes milestones the unit of delivery).
 * Returns null when a project has no milestones -- an honest "unknown" beats
 * a fabricated 0%.
 */
export function summariseProgress(project, milestones = []) {
  const counted = milestones.filter((m) => m.status !== "CANCELLED");
  const completed = counted.filter((m) => m.status === "COMPLETED");

  const now = new Date();
  const endDate = project.endDate ? new Date(project.endDate) : null;
  const isOpen = !TERMINAL_STATUSES.includes(project.status);

  return {
    milestoneCount: counted.length,
    completedMilestoneCount: completed.length,
    progressPercent: counted.length === 0 ? null : round2((completed.length / counted.length) * 100),
    // Deadline tracking (FRS 13.2 "start/end date"): both only mean anything
    // while the project is still open.
    daysToDeadline: endDate && isOpen ? Math.ceil((endDate - now) / (24 * 60 * 60 * 1000)) : null,
    isOverdue: Boolean(endDate && isOpen && endDate < now),
    overdueMilestoneCount: counted.filter(
      (m) => m.status !== "COMPLETED" && m.dueDate && new Date(m.dueDate) < now
    ).length,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listProjects(actingUser, { status, billingModel, clientId, projectManagerId, employeeId, search, skip, take }) {
  const filters = [];

  if (!canSeeAllProjects(actingUser)) {
    // No employee profile and no permission means no project is in scope --
    // an empty page, not everything.
    if (!actingUser.employee) return { rows: [], totalCount: 0 };
    filters.push(ownProjectsWhere(actingUser.employee.id));
  }

  if (status) filters.push({ status });
  if (billingModel) filters.push({ billingModel });
  if (clientId) filters.push({ clientId });
  if (projectManagerId) filters.push({ projectManagerId });
  if (employeeId) filters.push({ members: { some: { employeeId } } });
  if (search) {
    filters.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  const where = filters.length > 0 ? { AND: filters } : {};

  const [rows, totalCount] = await Promise.all([
    prisma.project.findMany({
      where,
      skip,
      take,
      orderBy: [{ status: "asc" }, { startDate: "desc" }],
      include: PROJECT_INCLUDE,
    }),
    prisma.project.count({ where }),
  ]);

  return { rows, totalCount };
}

/**
 * 404 rather than 403 for a project outside the caller's scope, matching the
 * convention expenses uses for out-of-hierarchy claims (Section 8.3): don't
 * confirm a record exists to someone who may not see it.
 */
export async function getProjectOr404(actingUser, projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      ...PROJECT_INCLUDE,
      members: {
        orderBy: [{ startDate: "asc" }],
        include: { employee: { select: EMPLOYEE_SELECT } },
      },
      milestones: { orderBy: [{ sequence: "asc" }, { dueDate: "asc" }] },
    },
  });
  if (!project) throw new AppError(404, "Project not found.");

  if (!canSeeAllProjects(actingUser)) {
    const employeeId = actingUser.employee?.id;
    const isMine =
      employeeId && (project.projectManagerId === employeeId || project.members.some((m) => m.employeeId === employeeId));
    if (!isMine) throw new AppError(404, "Project not found.");
  }

  // Money rollups are deliberately NOT included here -- they carry implied
  // salary information and live behind the Section 29.5 profitability gate.
  return { ...project, progress: summariseProgress(project, project.milestones) };
}

/** Same scoping as getProjectOr404, but without loading the whole graph. */
async function getScopedProjectOr404(actingUser, projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { members: { select: { employeeId: true } } },
  });
  if (!project) throw new AppError(404, "Project not found.");

  if (!canSeeAllProjects(actingUser)) {
    const employeeId = actingUser.employee?.id;
    const isMine =
      employeeId && (project.projectManagerId === employeeId || project.members.some((m) => m.employeeId === employeeId));
    if (!isMine) throw new AppError(404, "Project not found.");
  }
  return project;
}

// ---------------------------------------------------------------------------
// Writes -- project
// ---------------------------------------------------------------------------

export async function createProject(actingUser, input) {
  // Both FKs validated before the write so the caller gets a readable 400
  // rather than a raw Prisma foreign-key error (Section 32).
  const client = await assertClientExists(input.clientId);
  if (client.status === "INACTIVE") {
    throw new AppError(400, `Client "${client.name}" is inactive; reactivate it before opening a project.`);
  }
  if (input.projectManagerId) await assertEmployeeAllocatable(input.projectManagerId);

  const project = await prisma.$transaction(async (tx) => {
    const row = await tx.project.create({
      data: {
        name: input.name,
        clientId: input.clientId,
        projectManagerId: input.projectManagerId ?? null,
        contractValue: input.contractValue ?? null,
        billingModel: input.billingModel,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        ...(input.status ? { status: input.status } : {}),
      },
    });

    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: row.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: {
          name: row.name,
          clientId: row.clientId,
          projectManagerId: row.projectManagerId,
          billingModel: row.billingModel,
          contractValue: row.contractValue,
          status: row.status,
        },
      },
      tx
    );

    return row;
  });

  return getProjectOr404(actingUser, project.id);
}

/**
 * The single source of truth for the FRS Section 27 project lifecycle. Both
 * mutation routes run through it -- PATCH /projects/:id (the endpoint Section
 * 29.5 actually documents) and PATCH /projects/:id/status -- so neither can
 * move a project into a state the other would reject.
 */
function assertStatusTransition(existing, status, comment) {
  if (existing.status === status) {
    throw new AppError(409, `Project is already ${status}.`);
  }
  const allowed = STATUS_TRANSITIONS[existing.status] || [];
  if (!allowed.includes(status)) {
    throw new AppError(
      409,
      allowed.length === 0
        ? `${existing.status} is a terminal status; no further transitions are allowed.`
        : `Cannot move a ${existing.status} project to ${status}. Allowed: ${allowed.join(", ")}.`
    );
  }
  // Section 24 wants a reason recorded against a cancellation, wherever it
  // was triggered from.
  if (status === "CANCELLED" && !comment) {
    throw new AppError(400, "A reason is required to cancel a project. Send it as `comment`.");
  }
}

export async function updateProject(actingUser, projectId, input) {
  const existing = await prisma.project.findUnique({ where: { id: projectId } });
  if (!existing) throw new AppError(404, "Project not found.");

  if (TERMINAL_STATUSES.includes(existing.status)) {
    throw new AppError(409, `A ${existing.status} project can no longer be edited.`);
  }

  // `comment` is the audit note for a cancellation, not a column -- it must not
  // reach Prisma. `status` is validated separately against the lifecycle.
  const { comment, status, ...fields } = input;
  if (status) assertStatusTransition(existing, status, comment);

  if (input.clientId) {
    const client = await assertClientExists(input.clientId);
    if (client.status === "INACTIVE") {
      throw new AppError(400, `Client "${client.name}" is inactive and cannot take on a project.`);
    }
  }
  if (input.projectManagerId) await assertEmployeeAllocatable(input.projectManagerId);

  // The date pair must stay consistent even when only one half is patched --
  // the Zod refine only sees the fields present in the body.
  const startDate = input.startDate ?? existing.startDate;
  const endDate = input.endDate === undefined ? existing.endDate : input.endDate;
  if (endDate && new Date(endDate) < new Date(startDate)) {
    throw new AppError(400, "endDate must be on or after startDate.");
  }

  await prisma.$transaction(async (tx) => {
    const row = await tx.project.update({
      where: { id: projectId },
      data: { ...fields, ...(status ? { status } : {}) },
    });

    const { previousValue, newValue, changed } = diffChangedFields(
      { ...existing, ...normaliseForDiff(existing) },
      { ...row, ...normaliseForDiff(row) },
      PROJECT_FIELDS
    );
    if (changed) {
      await writeAuditLog(
        {
          entityType: ENTITY_TYPE,
          entityId: projectId,
          // Same vocabulary as PATCH /:id/status, so the trail reads the same
          // no matter which route retired the project (Section 26 rule 7).
          action: status === "CANCELLED" ? "CANCEL" : "UPDATE",
          performedById: actingUser.id,
          previousValue,
          newValue,
          note: comment || null,
        },
        tx
      );
    }
  });

  return getProjectOr404(actingUser, projectId);
}

/**
 * diffChangedFields compares with !==, which treats two equal Date or Decimal
 * objects as different (they are distinct instances). Flattening them to
 * primitives first keeps a no-op PATCH out of the audit trail.
 */
function normaliseForDiff(row) {
  return {
    contractValue: row.contractValue == null ? null : String(row.contractValue),
    startDate: row.startDate == null ? null : new Date(row.startDate).toISOString(),
    endDate: row.endDate == null ? null : new Date(row.endDate).toISOString(),
  };
}

/**
 * FRS Section 27 lifecycle + Section 26 rule 7 (every status transition writes
 * an audit entry). This is the only way a project's status ever changes.
 */
export async function setProjectStatus(actingUser, projectId, { status, comment }) {
  const existing = await prisma.project.findUnique({ where: { id: projectId } });
  if (!existing) throw new AppError(404, "Project not found.");

  assertStatusTransition(existing, status, comment);

  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { status } });
    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: projectId,
        // Matches the vocabulary expenses already uses for a withdrawal.
        action: status === "CANCELLED" ? "CANCEL" : "UPDATE",
        performedById: actingUser.id,
        previousValue: { status: existing.status },
        newValue: { status },
        note: comment || null,
      },
      tx
    );
  });

  return getProjectOr404(actingUser, projectId);
}

// ---------------------------------------------------------------------------
// Members -- FRS 13.2 "employee allocation", 29.5 POST /projects/:id/members
// ---------------------------------------------------------------------------

export async function listMembers(actingUser, projectId) {
  await getScopedProjectOr404(actingUser, projectId);
  return prisma.projectMember.findMany({
    where: { projectId },
    orderBy: [{ startDate: "asc" }],
    include: { employee: { select: EMPLOYEE_SELECT } },
  });
}

/**
 * Warns when an employee's allocations across all open projects exceed 100%.
 * Over-allocation is a real planning problem but a legitimate temporary state
 * during a handover, so this warns rather than blocks -- the same shape
 * expenses uses for soft limits and clients uses for duplicate names.
 */
async function buildAllocationWarnings(employeeId, projectId, allocationPercent) {
  const others = await prisma.projectMember.findMany({
    where: {
      employeeId,
      projectId: { not: projectId },
      project: { status: { notIn: TERMINAL_STATUSES } },
      OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
    },
    select: { allocationPercent: true, project: { select: { id: true, name: true } } },
  });

  const otherTotal = others.reduce((sum, m) => sum + m.allocationPercent, 0);
  const total = otherTotal + allocationPercent;
  if (total <= 100) return [];

  return [
    {
      code: "OVER_ALLOCATED",
      message: `This employee is now allocated ${total}% across active projects (over 100%).`,
      totalAllocationPercent: total,
      otherProjects: others.map((m) => ({ ...m.project, allocationPercent: m.allocationPercent })),
    },
  ];
}

export async function addMember(actingUser, projectId, input) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, "Project not found.");
  if (TERMINAL_STATUSES.includes(project.status)) {
    throw new AppError(409, `Cannot allocate people to a ${project.status} project.`);
  }

  await assertEmployeeAllocatable(input.employeeId);

  // @@unique([projectId, employeeId]) means re-adding is an update, not a
  // second row. Say so explicitly instead of surfacing a 409 from Postgres.
  const existing = await prisma.projectMember.findUnique({
    where: { projectId_employeeId: { projectId, employeeId: input.employeeId } },
  });
  if (existing) {
    throw new AppError(
      409,
      "This employee is already allocated to the project. PATCH the existing allocation instead."
    );
  }

  const allocationPercent = input.allocationPercent ?? 100;
  // An allocation cannot start before the project it belongs to.
  const startDate = input.startDate ?? project.startDate;
  if (new Date(startDate) < new Date(project.startDate)) {
    throw new AppError(400, "An allocation cannot start before the project start date.");
  }
  if (input.endDate && new Date(input.endDate) < new Date(startDate)) {
    throw new AppError(400, "endDate must be on or after startDate.");
  }

  const member = await prisma.$transaction(async (tx) => {
    const row = await tx.projectMember.create({
      data: {
        projectId,
        employeeId: input.employeeId,
        allocationPercent,
        startDate,
        endDate: input.endDate ?? null,
      },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });

    await writeAuditLog(
      {
        entityType: MEMBER_ENTITY_TYPE,
        entityId: row.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: {
          projectId,
          employeeId: row.employeeId,
          allocationPercent: row.allocationPercent,
          startDate: row.startDate,
          endDate: row.endDate,
        },
        note: `Allocated to project ${project.name}.`,
      },
      tx
    );

    return row;
  });

  return { ...member, warnings: await buildAllocationWarnings(input.employeeId, projectId, allocationPercent) };
}

/**
 * The only way an allocation ends: PATCH endDate. There is no DELETE, because
 * removing the row would erase the cost the project already incurred
 * (Section 26 rule 6 + the Section 13.4 cost formula).
 */
export async function updateMember(actingUser, projectId, memberId, input) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, "Project not found.");

  const existing = await prisma.projectMember.findUnique({ where: { id: memberId } });
  if (!existing || existing.projectId !== projectId) {
    throw new AppError(404, "Project member not found.");
  }

  const startDate = input.startDate ?? existing.startDate;
  const endDate = input.endDate === undefined ? existing.endDate : input.endDate;
  if (new Date(startDate) < new Date(project.startDate)) {
    throw new AppError(400, "An allocation cannot start before the project start date.");
  }
  if (endDate && new Date(endDate) < new Date(startDate)) {
    throw new AppError(400, "endDate must be on or after startDate.");
  }

  const member = await prisma.$transaction(async (tx) => {
    const row = await tx.projectMember.update({
      where: { id: memberId },
      data: input,
      include: { employee: { select: EMPLOYEE_SELECT } },
    });

    const flatten = (m) => ({
      allocationPercent: m.allocationPercent,
      startDate: m.startDate == null ? null : new Date(m.startDate).toISOString(),
      endDate: m.endDate == null ? null : new Date(m.endDate).toISOString(),
    });
    const { previousValue, newValue, changed } = diffChangedFields(flatten(existing), flatten(row), MEMBER_FIELDS);
    if (changed) {
      await writeAuditLog(
        {
          entityType: MEMBER_ENTITY_TYPE,
          entityId: memberId,
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

  return { ...member, warnings: await buildAllocationWarnings(member.employeeId, projectId, member.allocationPercent) };
}

// ---------------------------------------------------------------------------
// Milestones -- FRS 13.3 (Milestone is the live billing model, Section 38 Q22)
// ---------------------------------------------------------------------------

export async function listMilestones(actingUser, projectId) {
  await getScopedProjectOr404(actingUser, projectId);
  return prisma.projectMilestone.findMany({
    where: { projectId },
    orderBy: [{ sequence: "asc" }, { dueDate: "asc" }],
  });
}

/**
 * Warns when the milestone amounts stop adding up to the contract value. For a
 * MILESTONE-billed project the milestones *are* the billing plan, so a gap is
 * worth surfacing -- but a plan is legitimately incomplete while being drafted.
 */
async function buildMilestoneWarnings(project) {
  if (project.contractValue == null) return [];

  const rows = await prisma.projectMilestone.findMany({
    where: { projectId: project.id, status: { not: "CANCELLED" } },
    select: { amount: true },
  });
  const total = rows.reduce((sum, m) => sum + num(m.amount), 0);
  const contract = num(project.contractValue);
  if (round2(total) === round2(contract)) return [];

  return [
    {
      code: "MILESTONE_TOTAL_MISMATCH",
      message: `Milestone amounts total ${round2(total)} against a contract value of ${round2(contract)}.`,
      milestoneTotal: round2(total),
      contractValue: round2(contract),
      difference: round2(contract - total),
    },
  ];
}

export async function addMilestone(actingUser, projectId, input) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, "Project not found.");
  if (TERMINAL_STATUSES.includes(project.status)) {
    throw new AppError(409, `Cannot add milestones to a ${project.status} project.`);
  }
  if (input.dueDate && new Date(input.dueDate) < new Date(project.startDate)) {
    throw new AppError(400, "A milestone cannot fall due before the project starts.");
  }

  const milestone = await prisma.$transaction(async (tx) => {
    const row = await tx.projectMilestone.create({
      data: {
        projectId,
        name: input.name,
        description: input.description ?? null,
        amount: input.amount ?? null,
        dueDate: input.dueDate ?? null,
        ...(input.sequence != null ? { sequence: input.sequence } : {}),
      },
    });

    await writeAuditLog(
      {
        entityType: MILESTONE_ENTITY_TYPE,
        entityId: row.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: { projectId, name: row.name, amount: row.amount, dueDate: row.dueDate, status: row.status },
      },
      tx
    );

    return row;
  });

  return { ...milestone, warnings: await buildMilestoneWarnings(project) };
}

export async function updateMilestone(actingUser, projectId, milestoneId, input) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, "Project not found.");

  const existing = await prisma.projectMilestone.findUnique({ where: { id: milestoneId } });
  if (!existing || existing.projectId !== projectId) {
    throw new AppError(404, "Milestone not found.");
  }

  const data = { ...input };
  // completedAt is derived, never supplied: it is what "invoiced on completion"
  // (Section 13.3) will key off once the invoicing module lands.
  if (input.status === "COMPLETED" && existing.status !== "COMPLETED") {
    data.completedAt = new Date();
  } else if (input.status && input.status !== "COMPLETED" && existing.status === "COMPLETED") {
    data.completedAt = null;
  }

  const milestone = await prisma.$transaction(async (tx) => {
    const row = await tx.projectMilestone.update({ where: { id: milestoneId }, data });

    const flatten = (m) => ({
      name: m.name,
      description: m.description,
      amount: m.amount == null ? null : String(m.amount),
      dueDate: m.dueDate == null ? null : new Date(m.dueDate).toISOString(),
      sequence: m.sequence,
      status: m.status,
    });
    const { previousValue, newValue, changed } = diffChangedFields(flatten(existing), flatten(row), MILESTONE_FIELDS);
    if (changed) {
      await writeAuditLog(
        {
          entityType: MILESTONE_ENTITY_TYPE,
          entityId: milestoneId,
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

  return { ...milestone, warnings: await buildMilestoneWarnings(project) };
}

// ---------------------------------------------------------------------------
// Profitability -- FRS 13.4, 29.5 GET /projects/:id/profitability
// ---------------------------------------------------------------------------

/**
 * FRS 13.4, using the percentage-based approximation the FRS itself proposes
 * (confirmed in place of timesheets). For each allocation:
 *
 *   cost = allocationPercent% x monthly salary cost x months allocated
 *
 * The window is clipped to the project's own dates and to today, so a project
 * running until next year is only charged for the months already elapsed.
 */
async function computeLabourCost(project) {
  const members = await prisma.projectMember.findMany({
    where: { projectId: project.id },
    include: { employee: { select: EMPLOYEE_SELECT } },
  });
  if (members.length === 0) {
    return { labourCost: 0, breakdown: [], membersWithoutSalary: [] };
  }

  const structures = await prisma.salaryStructure.findMany({
    where: { employeeId: { in: members.map((m) => m.employeeId) } },
    include: { components: true },
  });
  const byEmployee = new Map();
  for (const s of structures) {
    if (!byEmployee.has(s.employeeId)) byEmployee.set(s.employeeId, []);
    byEmployee.get(s.employeeId).push(s);
  }

  const now = startOfUtcDay(new Date());
  const projectStart = startOfUtcDay(project.startDate);
  const projectEnd = project.endDate ? startOfUtcDay(project.endDate) : null;

  const breakdown = [];
  const membersWithoutSalary = [];
  let labourCost = 0;

  for (const member of members) {
    const windowStart = new Date(Math.max(startOfUtcDay(member.startDate).getTime(), projectStart.getTime()));
    const candidates = [now.getTime()];
    if (member.endDate) candidates.push(startOfUtcDay(member.endDate).getTime());
    if (projectEnd) candidates.push(projectEnd.getTime());
    const windowEnd = new Date(Math.min(...candidates));

    const months = windowEnd > windowStart ? (windowEnd - windowStart) / MS_PER_MONTH : 0;
    const { monthlyCost, structureFound } = monthlyCostFromStructures(byEmployee.get(member.employeeId) || [], windowEnd);

    if (!structureFound) {
      membersWithoutSalary.push({
        employeeId: member.employeeId,
        name: `${member.employee.firstName} ${member.employee.lastName}`,
      });
    }

    const cost = round2((monthlyCost * months * member.allocationPercent) / 100);
    labourCost += cost;

    breakdown.push({
      memberId: member.id,
      employeeId: member.employeeId,
      employeeName: `${member.employee.firstName} ${member.employee.lastName}`,
      allocationPercent: member.allocationPercent,
      monthsAllocated: round2(months),
      monthlySalaryCost: round2(monthlyCost),
      allocatedCost: cost,
      hasSalaryStructure: structureFound,
    });
  }

  return { labourCost: round2(labourCost), breakdown, membersWithoutSalary };
}

/**
 * FRS Section 8 governs salary visibility, and the per-employee figures in the
 * cost breakdown ARE salary data: monthlySalaryCost is exactly what Section 8
 * restricts to self / downward hierarchy / an explicit override. Passing the
 * Section 29.5 profitability gate does not by itself grant that -- an assigned
 * PM is not necessarily anyone's manager.
 *
 * So the breakdown is redacted per employee using the same rule canViewSalary
 * encodes (Section 0.1 Q5's Team-Lead-vs-Manager depth and Q9's Super-Admin-
 * peer carve-out included, via the same shared hierarchy helpers), while the
 * AGGREGATE labour figure stays intact: Section 13.4 needs the project total,
 * and a total over several people discloses no individual salary.
 */
async function buildSalaryVisibility(actingUser, employeeIds) {
  if (actingUser.roleType === "SUPER_ADMIN") {
    // Q9: a Super Admin does not see another Super Admin's salary, even in an
    // aggregate breakdown like this one -- an unusual case (a Super Admin
    // allocated to a project as a member), but the rule applies regardless.
    const superAdminIds = new Set(await getSuperAdminEmployeeIds(employeeIds));
    return new Set(employeeIds.filter((id) => id === actingUser.employee?.id || !superAdminIds.has(id)));
  }
  if (actingUser.permissionCodes?.includes("VIEW_COMPANY_SALARY")) return new Set(employeeIds);
  if (!actingUser.employee) return new Set();

  // Q5: Team Lead depth-1 vs Manager full downward chain -- reused from the
  // same helper canViewSalary and expense-review scoping use, not
  // re-implemented a third time.
  const reviewableIds = await getReviewableEmployeeIds(actingUser);
  const visible = new Set(employeeIds.filter((id) => reviewableIds.includes(id)));
  // Rule 1: a user can always see their own figures.
  if (employeeIds.includes(actingUser.employee.id)) visible.add(actingUser.employee.id);
  return visible;
}

/**
 * Revenue, cost, margin, plus the budget-vs-actual rollup FRS Section 22 asks
 * for on the same screen. Everything here is READ-ONLY against tables that
 * already exist -- invoices and budgets are owned by modules that are not
 * built yet, so these figures are simply zero until those modules populate
 * them. Nothing is stubbed or faked.
 */
export async function getProjectProfitability(actingUser, projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { client: { select: CLIENT_SELECT }, projectManager: { select: EMPLOYEE_SELECT } },
  });
  if (!project) throw new AppError(404, "Project not found.");

  const [invoiceGroups, paymentsAgg, expenseGroups, billGroups, budgets, labour, milestones] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["status"],
      where: { projectId },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.clientPayment.aggregate({ where: { invoice: { projectId } }, _sum: { amount: true } }),
    prisma.expenseClaim.groupBy({
      by: ["status"],
      where: { projectId },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    // FRS 19: vendor bills tagged to this project are part of its actual spend.
    prisma.vendorBill.groupBy({
      by: ["status"],
      where: { projectId },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.budget.findMany({
      // Section 26 rule 10: planned budget comes from the Budget table, which
      // the Budgets module owns. DRAFT rows are not committed spend plans.
      where: { projectId, scope: "PROJECT", status: { in: ["ACTIVE", "CLOSED"] } },
      select: { id: true, periodLabel: true, plannedAmount: true, status: true },
    }),
    computeLabourCost(project),
    prisma.projectMilestone.findMany({ where: { projectId } }),
  ]);

  const sumWhere = (groups, statuses, field) =>
    round2(groups.filter((g) => statuses.includes(g.status)).reduce((s, g) => s + num(g._sum[field]), 0));

  const billedRevenue = sumWhere(invoiceGroups, REVENUE_INVOICE_STATUSES, "totalAmount");
  const amountReceived = round2(num(paymentsAgg._sum.amount));

  const actualExpenses = sumWhere(expenseGroups, ACTUAL_EXPENSE_STATUSES, "amount");
  const pendingExpenses = sumWhere(expenseGroups, PENDING_EXPENSE_STATUSES, "amount");

  const actualVendorBills = sumWhere(billGroups, ACTUAL_BILL_STATUSES, "totalAmount");
  const pendingVendorBills = sumWhere(billGroups, PENDING_BILL_STATUSES, "totalAmount");

  // Section 8: redact per-employee salary figures the caller may not see. The
  // aggregate below is unaffected.
  const salaryVisible = await buildSalaryVisibility(
    actingUser,
    labour.breakdown.map((b) => b.employeeId)
  );
  const breakdown = labour.breakdown.map((b) =>
    salaryVisible.has(b.employeeId)
      ? { ...b, salaryRedacted: false }
      : {
          ...b,
          monthlySalaryCost: null,
          allocatedCost: null,
          salaryRedacted: true,
        }
  );

  const totalCost = round2(labour.labourCost + actualExpenses + actualVendorBills);
  const profit = round2(billedRevenue - totalCost);
  const plannedBudget = round2(budgets.reduce((s, b) => s + num(b.plannedAmount), 0));

  return {
    projectId: project.id,
    name: project.name,
    status: project.status,
    billingModel: project.billingModel,
    currency: project.client.currency,
    client: project.client,
    projectManager: project.projectManager,
    contractValue: project.contractValue == null ? null : round2(num(project.contractValue)),

    // FRS 13.4 revenue side, plus actual cash collected (Section 38 Q26
    // confirms partial payments, so billed and received genuinely differ).
    revenue: {
      billed: billedRevenue,
      received: amountReceived,
      outstanding: round2(billedRevenue - amountReceived),
      invoiceCountsByStatus: Object.fromEntries(invoiceGroups.map((g) => [g.status, g._count._all])),
    },

    // FRS 13.4 cost side.
    cost: {
      labour: labour.labourCost,
      expenses: actualExpenses,
      // FRS 19's third component of actual spend. Section 13.4's formula names
      // only labour and expenses, so this is broken out as its own line rather
      // than folded into "expenses" -- the two are different ledgers and the
      // client asked to be able to see them apart.
      vendorBills: actualVendorBills,
      total: totalCost,
      pendingExpenses,
      pendingVendorBills,
      allocationBreakdown: breakdown,
    },

    profitability: {
      profit,
      // Undefined rather than Infinity when nothing has been billed yet.
      marginPercent: billedRevenue === 0 ? null : round2((profit / billedRevenue) * 100),
      contractMarginPercent:
        project.contractValue == null || num(project.contractValue) === 0
          ? null
          : round2(((num(project.contractValue) - totalCost) / num(project.contractValue)) * 100),
    },

    // FRS Section 22 "Budget vs Actual", computed not entered (rule 10).
    budget: {
      planned: plannedBudget,
      actual: totalCost,
      variance: round2(plannedBudget - totalCost),
      utilizationPercent: plannedBudget === 0 ? null : round2((totalCost / plannedBudget) * 100),
      sources: budgets.map((b) => ({ ...b, plannedAmount: round2(num(b.plannedAmount)) })),
    },

    progress: summariseProgress(project, milestones),

    // Section 19 honesty: say which figures are approximations or incomplete
    // rather than presenting them as exact.
    caveats: buildCaveats(labour, invoiceGroups, budgets, breakdown.filter((b) => b.salaryRedacted).length, {
      pendingVendorBills,
    }),
  };
}

function buildCaveats(labour, invoiceGroups, budgets, redactedCount = 0, { pendingVendorBills = 0 } = {}) {
  const caveats = [];

  if (redactedCount > 0) {
    caveats.push(
      `Per-employee salary figures are hidden for ${redactedCount} allocated employee(s) outside your Section 8 salary visibility; the aggregate labour cost still includes them.`
    );
  }

  caveats.push(
    "Labour cost is the FRS 13.4 approximation (allocationPercent x monthly salary x months allocated), not timesheet-accurate."
  );
  if (labour.membersWithoutSalary.length > 0) {
    caveats.push(
      `${labour.membersWithoutSalary.length} allocated employee(s) have no salary structure on record and contribute 0 to labour cost: ` +
        labour.membersWithoutSalary.map((m) => m.name).join(", ") +
        "."
    );
  }
  if (invoiceGroups.length === 0) {
    caveats.push("No invoices exist for this project yet, so billed revenue is 0.");
  }
  if (budgets.length === 0) {
    caveats.push("No ACTIVE or CLOSED project budget has been defined, so budget variance is not meaningful.");
  }
  if (pendingVendorBills > 0) {
    caveats.push(
      "A further " + pendingVendorBills + " of vendor bills tagged to this project are still in " +
        "verification or approval and are NOT included in cost."
    );
  }
  return caveats;
}

// ---------------------------------------------------------------------------
// Actual spend, for callers that don't need the full profitability view
// ---------------------------------------------------------------------------

/**
 * The cost side of getProjectProfitability (labour + expenses + vendor bills),
 * without the revenue/margin rollup or the Section 8 salary-redaction pass a
 * permission-gated HTTP response needs. Exported for the Budgets module
 * (FRS 19: "actual spending ... the sum of approved expenses + vendor bills +
 * salary allocations tagged to that scope"), so a PROJECT-scope budget's
 * utilization is computed from the exact same three components and the exact
 * same status classifications as project profitability, rather than a second
 * calculation system that could silently disagree with it.
 */
export async function getProjectActualSpend(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, startDate: true, endDate: true },
  });
  if (!project) throw new AppError(400, "The specified project does not exist.");

  const [expenseGroups, billGroups, labour] = await Promise.all([
    prisma.expenseClaim.groupBy({ by: ["status"], where: { projectId }, _sum: { amount: true } }),
    prisma.vendorBill.groupBy({ by: ["status"], where: { projectId }, _sum: { totalAmount: true } }),
    computeLabourCost(project),
  ]);

  const sumWhere = (groups, statuses, field) =>
    round2(groups.filter((g) => statuses.includes(g.status)).reduce((s, g) => s + num(g._sum[field]), 0));

  const expenses = sumWhere(expenseGroups, ACTUAL_EXPENSE_STATUSES, "amount");
  const pendingExpenses = sumWhere(expenseGroups, PENDING_EXPENSE_STATUSES, "amount");
  const vendorBills = sumWhere(billGroups, ACTUAL_BILL_STATUSES, "totalAmount");
  const pendingVendorBills = sumWhere(billGroups, PENDING_BILL_STATUSES, "totalAmount");

  return {
    labourCost: labour.labourCost,
    expenses,
    vendorBills,
    actual: round2(labour.labourCost + expenses + vendorBills),
    committed: round2(pendingExpenses + pendingVendorBills),
    pendingExpenses,
    pendingVendorBills,
    membersWithoutSalary: labour.membersWithoutSalary,
  };
}
