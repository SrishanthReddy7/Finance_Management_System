// Payroll Management (FRS Section 12, 26, 27, 29.3), extended with a
// maker-checker approval workflow the client confirmed building beyond what
// the FRS itself specifies (see Handsoff.md for that decision).
//
// What lives here: employee eligibility, the payroll calculation itself
// (reusing the exact "which structure is in force" rule the Salaries module
// owns, never re-deriving it), the DRAFT -> PROCESSED -> FINALIZED -> PAID
// lifecycle, and payslip payment recording. Salary-structure CRUD itself
// lives in the Salaries module (src/modules/salaries/) -- it was built here
// first, before that module existed, and has since been consolidated there;
// this file only ever needs the read-only "in force" lookup. Permission
// gating does NOT live here -- MANAGE_SALARY / APPROVE_PAYROLL are applied at
// the route layer via requirePermission (Section 30 Super Admin bypass), and
// salary VISIBILITY is applied at the route layer via requireSalaryAccess
// (Section 8), exactly as every other module in this codebase separates
// authorization from business logic.
//
// Section 26 rule 10 governs the whole calculation surface: gross/total
// deductions/net salary are never accepted from a client, only computed from
// the SalaryStructure in force. Section 12.2's "immutable payslip snapshot"
// governs the lifecycle: once FINALIZED, a payslip can never be edited or
// deleted -- the only way to correct a mistake is to reject the run back to
// DRAFT *before* finalization, which is the one point payslips are still
// draft calculations rather than the official record. A later salary
// revision (Salaries module) never touches an already-generated payslip: it
// creates a new SalaryStructure row, and Payslip/PayslipLine hold their own
// snapshotted values, not a live reference back to it.

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { recordApprovalStep, listApprovalSteps } from "../../utils/approvalHistory.js";
import { findInForceSalaryStructure } from "../salaries/salary.service.js";

const RUN_ENTITY_TYPE = "PayrollRun";
const PAYSLIP_ENTITY_TYPE = "Payslip";

// FRS 27's Employee/Employment states, narrowed to who gets paid this run.
// TERMINATED/RESIGNED are excluded outright (task requirement), not prorated
// -- the FRS gives no proration formula anywhere in Section 12, and Section 36
// explicitly keeps payroll a flat, manually-entered structure rather than a
// rules engine.
const ELIGIBLE_EMPLOYMENT_STATUSES = ["ACTIVE", "PROBATION", "NOTICE_PERIOD"];

// FRS 27: Draft -> Processed -> Finalized -> Paid, plus Cancelled. See the
// PayrollRunStatus schema comment for why this batch header exists at all.
const STATUS_TRANSITIONS = {
  DRAFT: ["PROCESSED", "CANCELLED"],
  PROCESSED: ["FINALIZED", "DRAFT", "CANCELLED"], // DRAFT = rejected back for correction
  FINALIZED: ["PAID"], // reachable only from markPayslipPaid -- see setRunStatus below
  PAID: [],
  CANCELLED: [],
};

const num = (value) => (value == null ? 0 : Number(value));
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/** Last calendar day of periodMonth (1-12): day 0 of the next month rolls back one day. */
function periodEndDate(periodYear, periodMonth) {
  return new Date(Date.UTC(periodYear, periodMonth, 0));
}

// ---------------------------------------------------------------------------
// Payslip reads (FRS 29.3 `GET /employees/:id/payslips`, `GET /payslips/:id`)
// ---------------------------------------------------------------------------

const PAYSLIP_INCLUDE = {
  lines: { orderBy: { type: "asc" } },
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, designation: true } },
  payrollRun: { select: { id: true, periodMonth: true, periodYear: true, status: true } },
};

function decoratePayslip(payslip) {
  return {
    ...payslip,
    grossEarnings: round2(num(payslip.grossEarnings)),
    totalDeductions: round2(num(payslip.totalDeductions)),
    netSalary: round2(num(payslip.netSalary)),
    lines: payslip.lines.map((l) => ({ ...l, amount: round2(num(l.amount)) })),
  };
}

// Only a FINALIZED/PAID run's payslip is the immutable snapshot of FRS 12.2. A
// DRAFT/PROCESSED run's payslips can still be deleted or regenerated (see
// rejectPayrollRun), so an employee -- or a manager looking at a report's pay --
// must not see them. Payroll staff (Super Admin, MANAGE_SALARY, APPROVE_PAYROLL)
// keep the full view for anyone but themselves, since they prepare and review
// those runs; nobody sees their OWN payslip early.
const VISIBLE_RUN_STATUSES = ["FINALIZED", "PAID"];

function canSeeUnfinalizedPayslips(actingUser, ownerEmployeeId) {
  if (actingUser.employee?.id === ownerEmployeeId) return false;
  if (actingUser.roleType === "SUPER_ADMIN") return true;
  const codes = actingUser.permissionCodes || [];
  return codes.includes("MANAGE_SALARY") || codes.includes("APPROVE_PAYROLL");
}

// A payslip with no run (pre-Payroll-module rows) has no lifecycle to wait on.
const finalizedOnlyWhere = {
  OR: [{ payrollRunId: null }, { payrollRun: { status: { in: VISIBLE_RUN_STATUSES } } }],
};

export async function listEmployeePayslips(actingUser, employeeId, { periodYear } = {}) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!employee) throw new AppError(404, "Employee not found.");

  const rows = await prisma.payslip.findMany({
    where: {
      employeeId,
      ...(periodYear ? { periodYear } : {}),
      ...(canSeeUnfinalizedPayslips(actingUser, employeeId) ? {} : finalizedOnlyWhere),
    },
    include: PAYSLIP_INCLUDE,
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
  });
  return rows.map(decoratePayslip);
}

export async function getPayslipOr404(actingUser, payslipId) {
  const payslip = await prisma.payslip.findUnique({ where: { id: payslipId }, include: PAYSLIP_INCLUDE });
  if (!payslip) throw new AppError(404, "Payslip not found.");

  const runStatus = payslip.payrollRun?.status;
  if (runStatus && !VISIBLE_RUN_STATUSES.includes(runStatus) && !canSeeUnfinalizedPayslips(actingUser, payslip.employeeId)) {
    throw new AppError(404, "Payslip not found.");
  }
  return decoratePayslip(payslip);
}

/** For requireSalaryAccess's getTargetEmployeeId(req) on GET /payslips/:id. */
export async function getPayslipEmployeeId(payslipId) {
  const payslip = await prisma.payslip.findUnique({ where: { id: payslipId }, select: { employeeId: true } });
  return payslip?.employeeId ?? null;
}

// ---------------------------------------------------------------------------
// Payroll runs -- reads
// ---------------------------------------------------------------------------

async function decorateRunSummary(run) {
  const [agg, paidCount] = await Promise.all([
    prisma.payslip.aggregate({
      where: { payrollRunId: run.id },
      _sum: { grossEarnings: true, totalDeductions: true, netSalary: true },
      _count: { _all: true },
    }),
    prisma.payslip.count({ where: { payrollRunId: run.id, paymentStatus: "PAID" } }),
  ]);

  return {
    ...run,
    summary: {
      employeeCount: agg._count._all,
      paidCount,
      totalGross: round2(num(agg._sum.grossEarnings)),
      totalDeductions: round2(num(agg._sum.totalDeductions)),
      totalNet: round2(num(agg._sum.netSalary)),
    },
  };
}

export async function listPayrollRuns({ status, periodMonth, periodYear, skip, take }) {
  const where = {};
  if (status) where.status = status;
  if (periodMonth) where.periodMonth = periodMonth;
  if (periodYear) where.periodYear = periodYear;

  const [rows, totalCount] = await Promise.all([
    prisma.payrollRun.findMany({ where, skip, take, orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }] }),
    prisma.payrollRun.count({ where }),
  ]);

  return { rows: await Promise.all(rows.map(decorateRunSummary)), totalCount };
}

export async function getPayrollRunOr404(runId) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError(404, "Payroll run not found.");

  const [decorated, payslips, approvalHistory] = await Promise.all([
    decorateRunSummary(run),
    prisma.payslip.findMany({
      where: { payrollRunId: runId },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } },
      orderBy: [{ employee: { employeeCode: "asc" } }],
    }),
    listApprovalSteps(RUN_ENTITY_TYPE, runId),
  ]);

  return {
    ...decorated,
    payslips: payslips.map((p) => ({
      id: p.id,
      employee: p.employee,
      grossEarnings: round2(num(p.grossEarnings)),
      totalDeductions: round2(num(p.totalDeductions)),
      netSalary: round2(num(p.netSalary)),
      paymentStatus: p.paymentStatus,
      paidAt: p.paidAt,
    })),
    approvalHistory,
  };
}

// ---------------------------------------------------------------------------
// Payroll runs -- writes / lifecycle
// ---------------------------------------------------------------------------

/**
 * FRS 19-style duplicate guard, applied to payroll periods: a CANCELLED run
 * must not permanently block a fresh attempt at that period, so the check
 * excludes it rather than relying on a DB-level unique constraint that can't
 * be conditioned on status (same reasoning as Budget's duplicate check).
 *
 * `client` lets the caller pass a transaction client so this check runs
 * against the same connection/lock as the create it guards (see
 * createPayrollRun).
 */
async function assertNoDuplicatePayrollRun(periodMonth, periodYear, client = prisma) {
  const clash = await client.payrollRun.findFirst({
    where: { periodMonth, periodYear, status: { not: "CANCELLED" } },
    select: { id: true, status: true },
  });
  if (clash) {
    throw new AppError(
      409,
      `A payroll run for ${periodMonth}/${periodYear} already exists (status ${clash.status}). Cancel it before ` +
        "creating a replacement."
    );
  }
}

export async function createPayrollRun(actingUser, input) {
  const lockKey = `payroll-run:${input.periodYear}-${input.periodMonth}`;

  const run = await prisma.$transaction(async (tx) => {
    // pg_advisory_xact_lock serializes concurrent creates for the SAME
    // period. The previous check (a plain findFirst() before create, with no
    // lock) let two concurrent requests for the same month/year both read
    // "no clash" before either had inserted, producing two active runs for
    // one period. This blocks a second request until the first's transaction
    // commits or rolls back, so the duplicate check below always sees the
    // first request's outcome -- its committed row, or its absence if it
    // rolled back -- never a stale pre-commit read. Released automatically
    // when the transaction ends.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    await assertNoDuplicatePayrollRun(input.periodMonth, input.periodYear, tx);

    const row = await tx.payrollRun.create({
      data: {
        periodMonth: input.periodMonth,
        periodYear: input.periodYear,
        notes: input.notes ?? null,
        preparedById: actingUser.id,
      },
    });
    await writeAuditLog(
      {
        entityType: RUN_ENTITY_TYPE,
        entityId: row.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: { periodMonth: row.periodMonth, periodYear: row.periodYear, status: row.status },
      },
      tx
    );
    return row;
  });

  return getPayrollRunOr404(run.id);
}

function assertStatusTransition(existing, target) {
  if (existing.status === target) {
    throw new AppError(409, `Payroll run is already ${target}.`);
  }
  const allowed = STATUS_TRANSITIONS[existing.status] || [];
  if (!allowed.includes(target)) {
    throw new AppError(
      409,
      allowed.length === 0
        ? `${existing.status} is a terminal status; no further transitions are allowed.`
        : `Cannot move a ${existing.status} payroll run to ${target}. Allowed: ${allowed.join(", ")}.`
    );
  }
}

/**
 * FRS 12.2's calculation, run per eligible employee: gross = sum of EARNING
 * components, total deductions = sum of DEDUCTION components (which is where
 * PF and any other statutory line lives -- Section 36 forbids inventing a
 * calculation engine for these, so they are just configured DEDUCTION
 * components, exactly as Section 12.2 says: "let Finance enter deduction
 * amounts manually per period"). Net salary = gross - deductions, computed
 * here and only here -- never accepted from a client (Section 26 rule 10).
 *
 * Employees with no salary structure in force are skipped, not failed --
 * mirroring how Projects/Budgets report a `membersWithoutSalary` /
 * `employeesWithoutSalary` list rather than blocking the whole calculation.
 */
export async function processPayrollRun(actingUser, runId) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError(404, "Payroll run not found.");
  assertStatusTransition(run, "PROCESSED");

  const periodEnd = periodEndDate(run.periodYear, run.periodMonth);

  const employees = await prisma.employee.findMany({
    where: {
      status: { in: ELIGIBLE_EMPLOYMENT_STATUSES },
      // Excludes anyone who joins AFTER this period ends. Someone who joins
      // mid-period still gets a full payslip for it (no day-based proration
      // -- the FRS gives no such formula anywhere in Section 12, and Section
      // 36 explicitly keeps this a flat structure, not a rules engine).
      dateOfJoining: { lte: periodEnd },
    },
    include: { salaryStructures: { include: { components: true } } },
    orderBy: { employeeCode: "asc" },
  });

  const eligible = [];
  const skipped = [];
  for (const employee of employees) {
    const structure = findInForceSalaryStructure(employee.salaryStructures, periodEnd);
    if (!structure) {
      skipped.push({
        employeeId: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        reason: "NO_SALARY_STRUCTURE",
      });
      continue;
    }
    eligible.push({ employee, structure });
  }

  if (eligible.length === 0) {
    throw new AppError(
      409,
      "No eligible employee has a salary structure on record for this period; nothing to process." +
        (skipped.length > 0 ? ` ${skipped.length} employee(s) were skipped for having no salary structure.` : "")
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const payslips = [];
    for (const { employee, structure } of eligible) {
      const grossEarnings = round2(
        structure.components.filter((c) => c.type === "EARNING").reduce((s, c) => s + num(c.amount), 0)
      );
      const totalDeductions = round2(
        structure.components.filter((c) => c.type === "DEDUCTION").reduce((s, c) => s + num(c.amount), 0)
      );
      const netSalary = round2(grossEarnings - totalDeductions);

      const payslip = await tx.payslip.create({
        data: {
          employeeId: employee.id,
          periodMonth: run.periodMonth,
          periodYear: run.periodYear,
          grossEarnings,
          totalDeductions,
          netSalary,
          // status omitted so the schema default PENDING applies.
          payrollRunId: run.id,
          lines: {
            create: structure.components.map((c) => ({
              label: c.label,
              type: c.type,
              amount: round2(num(c.amount)),
            })),
          },
        },
      });
      payslips.push(payslip);
    }

    await tx.payrollRun.update({
      where: { id: runId },
      data: { status: "PROCESSED", processedById: actingUser.id, processedAt: new Date() },
    });

    await recordApprovalStep(
      { entityType: RUN_ENTITY_TYPE, entityId: runId, actorUserId: actingUser.id, fromStatus: "DRAFT", toStatus: "PROCESSED" },
      tx
    );
    await writeAuditLog(
      {
        entityType: RUN_ENTITY_TYPE,
        entityId: runId,
        action: "UPDATE",
        performedById: actingUser.id,
        previousValue: { status: "DRAFT" },
        newValue: {
          status: "PROCESSED",
          payslipCount: payslips.length,
          skippedCount: skipped.length,
          totalGross: round2(payslips.reduce((s, p) => s + num(p.grossEarnings), 0)),
          totalNet: round2(payslips.reduce((s, p) => s + num(p.netSalary), 0)),
        },
      },
      tx
    );

    return payslips;
  });

  const result = await getPayrollRunOr404(runId);
  return { ...result, generatedCount: created.length, skipped };
}

/**
 * FRS Section 26 rule 5's maker-checker principle, mirrored onto payroll per
 * the client's confirmed decision to build this beyond the FRS: whoever
 * prepared the run cannot finalize it. Enforced for everyone, including
 * SUPER_ADMIN -- the Section 30 bypass inside requirePermission answers "may
 * this person finalize payroll at all", not "are they exempt from
 * segregation of duties", and for money going out to every employee that
 * separation is the control that matters most.
 *
 * This is also the point payslips stop being draft calculations and become
 * the immutable official record FRS 12.2 describes -- there is no route back
 * from here.
 */
export async function finalizePayrollRun(actingUser, runId, { comment } = {}) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError(404, "Payroll run not found.");
  assertStatusTransition(run, "FINALIZED");

  if (run.preparedById === actingUser.id) {
    throw new AppError(
      409,
      "You prepared this payroll run, so you cannot finalize it. Finalization requires a different user holding " +
        "APPROVE_PAYROLL."
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.payrollRun.update({
      where: { id: runId },
      data: { status: "FINALIZED", finalizedById: actingUser.id, finalizedAt: new Date() },
    });
    await recordApprovalStep(
      { entityType: RUN_ENTITY_TYPE, entityId: runId, actorUserId: actingUser.id, fromStatus: "PROCESSED", toStatus: "FINALIZED", comment },
      tx
    );
    await writeAuditLog(
      {
        entityType: RUN_ENTITY_TYPE,
        entityId: runId,
        action: "APPROVE",
        performedById: actingUser.id,
        previousValue: { status: "PROCESSED" },
        newValue: { status: "FINALIZED" },
        note: comment || null,
      },
      tx
    );
  });

  return getPayrollRunOr404(runId);
}

/**
 * PROCESSED -> DRAFT: the reviewer found a problem before finalization.
 * Payslips generated by processPayrollRun() are draft calculations up to
 * this point -- not yet the immutable snapshot FRS 12.2 describes -- so they
 * are deleted here rather than left to accumulate as orphaned, wrong rows.
 * This is the ONLY point payslips are ever removed; once FINALIZED there is
 * no way back (see finalizePayrollRun).
 */
export async function rejectPayrollRun(actingUser, runId, { reason }) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError(404, "Payroll run not found.");
  if (run.status !== "PROCESSED") {
    throw new AppError(409, `Only a PROCESSED payroll run can be sent back for correction; this one is ${run.status}.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.payslipLine.deleteMany({ where: { payslip: { payrollRunId: runId } } });
    const deleted = await tx.payslip.deleteMany({ where: { payrollRunId: runId } });

    await tx.payrollRun.update({
      where: { id: runId },
      data: { status: "DRAFT", processedById: null, processedAt: null },
    });
    await recordApprovalStep(
      { entityType: RUN_ENTITY_TYPE, entityId: runId, actorUserId: actingUser.id, fromStatus: "PROCESSED", toStatus: "DRAFT", comment: reason },
      tx
    );
    await writeAuditLog(
      {
        entityType: RUN_ENTITY_TYPE,
        entityId: runId,
        action: "REJECT",
        performedById: actingUser.id,
        previousValue: { status: "PROCESSED", payslipCount: deleted.count },
        newValue: { status: "DRAFT" },
        note: reason,
      },
      tx
    );
  });

  return getPayrollRunOr404(runId);
}

/**
 * DRAFT/PROCESSED -> CANCELLED (Section 26 rule 6: no hard delete, a run is
 * retired by status, not removed). A PROCESSED run's draft payslips are
 * deleted along with it, same reasoning as rejectPayrollRun -- they were
 * never the final record.
 */
export async function cancelPayrollRun(actingUser, runId, { reason }) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError(404, "Payroll run not found.");
  if (!["DRAFT", "PROCESSED"].includes(run.status)) {
    throw new AppError(409, `A ${run.status} payroll run cannot be cancelled.`);
  }

  await prisma.$transaction(async (tx) => {
    let deletedCount = 0;
    if (run.status === "PROCESSED") {
      await tx.payslipLine.deleteMany({ where: { payslip: { payrollRunId: runId } } });
      deletedCount = (await tx.payslip.deleteMany({ where: { payrollRunId: runId } })).count;
    }

    await tx.payrollRun.update({ where: { id: runId }, data: { status: "CANCELLED" } });
    await recordApprovalStep(
      { entityType: RUN_ENTITY_TYPE, entityId: runId, actorUserId: actingUser.id, fromStatus: run.status, toStatus: "CANCELLED", comment: reason },
      tx
    );
    await writeAuditLog(
      {
        entityType: RUN_ENTITY_TYPE,
        entityId: runId,
        action: "CANCEL",
        performedById: actingUser.id,
        previousValue: { status: run.status, payslipCount: deletedCount },
        newValue: { status: "CANCELLED" },
        note: reason,
      },
      tx
    );
  });

  return getPayrollRunOr404(runId);
}

// ---------------------------------------------------------------------------
// Payslip payments (FRS Section 20's payment shape, applied to payroll)
// ---------------------------------------------------------------------------

/**
 * `externalTx` (Payout Subsystem Step 2): lets a caller that already owns an
 * open Prisma transaction -- PayoutService's atomic payout-completion flow --
 * run the write portion inside it, so "payslip marked paid" and "Payout
 * marked PROCESSED" commit or roll back together. Default behavior (no
 * `externalTx`) is unchanged: same precheck reads, same FINALIZED-run
 * requirement, same writes, wrapped in its own `prisma.$transaction` exactly
 * as before. When `externalTx` IS supplied, the final `getPayslipOr404`
 * re-read is skipped (it would read via a different connection than the
 * still-open caller transaction, and so could not see writes this same call
 * just made) -- the caller gets `undefined` back and is responsible for its
 * own post-commit read if it needs the decorated payslip.
 */
export async function markPayslipPaid(actingUser, runId, payslipId, input, externalTx = null) {
  const client = externalTx || prisma;
  const run = await client.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError(404, "Payroll run not found.");
  if (run.status !== "FINALIZED" && run.status !== "PAID") {
    throw new AppError(409, `Payslips can only be marked paid once the payroll run is FINALIZED (currently ${run.status}).`);
  }

  const payslip = await client.payslip.findUnique({ where: { id: payslipId } });
  if (!payslip || payslip.payrollRunId !== runId) throw new AppError(404, "Payslip not found in this payroll run.");
  if (payslip.paymentStatus === "PAID") throw new AppError(409, "This payslip is already marked paid.");

  const paidAt = input.paymentDate || new Date();

  const execute = async (tx) => {
    await tx.payslip.update({
      where: { id: payslipId },
      data: { paymentStatus: "PAID", paidAt, paymentMethod: input.method, paymentReferenceNo: input.referenceNo ?? null },
    });
    await writeAuditLog(
      {
        entityType: PAYSLIP_ENTITY_TYPE,
        entityId: payslipId,
        action: "UPDATE",
        performedById: actingUser.id,
        previousValue: { paymentStatus: payslip.paymentStatus },
        newValue: { paymentStatus: "PAID", method: input.method, referenceNo: input.referenceNo ?? null, netSalary: round2(num(payslip.netSalary)) },
      },
      tx
    );

    // Section 26 rule 9's shape, mirrored onto payroll: the run's PAID status
    // is derived from its payslips, never set directly by any endpoint.
    const outstanding = await tx.payslip.count({ where: { payrollRunId: runId, paymentStatus: { not: "PAID" } } });
    if (outstanding === 0 && run.status !== "PAID") {
      await tx.payrollRun.update({ where: { id: runId }, data: { status: "PAID" } });
      await writeAuditLog(
        {
          entityType: RUN_ENTITY_TYPE,
          entityId: runId,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue: { status: run.status },
          newValue: { status: "PAID" },
          note: "All payslips in this run are now marked paid.",
        },
        tx
      );
    }
  };

  if (externalTx) {
    await execute(externalTx);
    return undefined;
  }

  await prisma.$transaction(execute);
  return getPayslipOr404(actingUser, payslipId);
}

/** A failed payout stays FINALIZED at the run level until corrected -- there is no invented retry engine here. */
export async function markPayslipFailed(actingUser, runId, payslipId, { reason }) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError(404, "Payroll run not found.");
  // Same lifecycle guard as markPayslipPaid: a payslip is still a draft
  // calculation before FINALIZED (rejectPayrollRun can delete it outright),
  // so payment outcomes -- paid or failed -- only make sense once it is the
  // immutable official record.
  if (run.status !== "FINALIZED" && run.status !== "PAID") {
    throw new AppError(409, `Payslips can only be marked failed once the payroll run is FINALIZED (currently ${run.status}).`);
  }

  const payslip = await prisma.payslip.findUnique({ where: { id: payslipId } });
  if (!payslip || payslip.payrollRunId !== runId) throw new AppError(404, "Payslip not found in this payroll run.");
  if (payslip.paymentStatus === "PAID") {
    throw new AppError(409, "This payslip is already marked paid; it cannot be marked failed.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.payslip.update({ where: { id: payslipId }, data: { paymentStatus: "FAILED" } });
    await writeAuditLog(
      {
        entityType: PAYSLIP_ENTITY_TYPE,
        entityId: payslipId,
        action: "UPDATE",
        performedById: actingUser.id,
        previousValue: { paymentStatus: payslip.paymentStatus },
        newValue: { paymentStatus: "FAILED" },
        note: reason,
      },
      tx
    );
  });

  return getPayslipOr404(actingUser, payslipId);
}
