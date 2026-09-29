// Salary Structure Management (FRS Section 12.1/12.2, 26, 27, 29.3).
//
// This module is the authoritative source for SalaryStructure/SalaryComponent
// data and for "which version is in force as of a date" -- Projects (labour
// cost), Budgets (payroll run-rate) and Payroll (payslip calculation) all
// import findInForceSalaryStructure/monthlyCostFromStructures from HERE
// rather than each re-deriving the rule. These two functions used to live in
// project.service.js (written before this module existed); moved here
// verbatim, with the other three modules' imports updated to match --
// nothing about the calculation itself changed.
//
// What lives here: salary-structure versioning/history and its own
// calculation helpers. Permission gating does NOT live here -- MANAGE_SALARY
// is applied at the route layer via requirePermission (Section 30 Super Admin
// bypass), and salary VISIBILITY is applied at the route layer via
// requireSalaryAccess (Section 8), exactly as the rest of this codebase
// separates authorization from business logic.
//
// Section 26 rule 10 / FRS 12.2 governs the write side: a salary revision is
// always a NEW SalaryStructure row, never an edit of an old one -- "so a
// later salary revision doesn't rewrite history" is only true if history is
// never the thing being written to. This is also why a payslip already
// generated from an old structure is unaffected by a later revision: it holds
// its own snapshotted PayslipLine rows, not a live reference to the
// structure that produced them.

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog } from "../audit/audit.service.js";

const STRUCTURE_ENTITY_TYPE = "SalaryStructure";

const num = (value) => (value == null ? 0 : Number(value));
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function startOfUtcDay(value) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Shared calculation helpers -- FRS 12.2, Section 13.4, Section 19.
// Reused by Projects (labour cost), Budgets (payroll run-rate) and Payroll
// (payslip generation). Pure functions: no I/O, no module-specific knowledge,
// which is what makes them safe to share across four modules.
// ---------------------------------------------------------------------------

/**
 * "Which SalaryStructure version is in force as of a given date": the latest
 * one whose effectiveFrom has already arrived.
 */
export function findInForceSalaryStructure(structures, asOf) {
  return (
    structures
      .filter((s) => new Date(s.effectiveFrom) <= asOf)
      .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0] || null
  );
}

/**
 * Company monthly cost of an employee = the sum of the EARNING components of
 * the salary structure in force. Deductions (PF, tax) come *out of* those
 * earnings, so adding them would double-count.
 *
 * Used by Projects' FRS 13.4 labour-cost approximation and Budgets' FRS 19
 * DEPARTMENT/COMPANY payroll run-rate.
 */
export function monthlyCostFromStructures(structures, asOf) {
  const inForce = findInForceSalaryStructure(structures, asOf);
  if (!inForce) return { monthlyCost: 0, structureFound: false };

  const monthlyCost = inForce.components
    .filter((c) => c.type === "EARNING")
    .reduce((sum, c) => sum + num(c.amount), 0);
  return { monthlyCost, structureFound: true };
}

// ---------------------------------------------------------------------------
// Salary structure CRUD (FRS 29.3 `GET`/`PUT /employees/:id/salary-structure`)
// ---------------------------------------------------------------------------

const STRUCTURE_INCLUDE = { components: { orderBy: { type: "asc" } } };

function decorateStructure(structure) {
  const components = structure.components.map((c) => ({ ...c, amount: round2(num(c.amount)) }));
  const grossEarnings = round2(components.filter((c) => c.type === "EARNING").reduce((s, c) => s + c.amount, 0));
  const totalDeductions = round2(components.filter((c) => c.type === "DEDUCTION").reduce((s, c) => s + c.amount, 0));
  return { ...structure, components, grossEarnings, totalDeductions, netSalary: round2(grossEarnings - totalDeductions) };
}

/**
 * FRS 12.1's fields (basic/allowances/deductions/gross/net) plus FRS 12.2's
 * versioning: `current` is the version in force today, `history` is every
 * version ever created, oldest revisions included and never rewritten.
 */
export async function getSalaryStructure(employeeId) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!employee) throw new AppError(404, "Employee not found.");

  const structures = await prisma.salaryStructure.findMany({
    where: { employeeId },
    include: STRUCTURE_INCLUDE,
    orderBy: { effectiveFrom: "desc" },
  });

  const current = findInForceSalaryStructure(structures, new Date());
  return {
    employeeId,
    current: current ? decorateStructure(current) : null,
    history: structures.map(decorateStructure),
  };
}

/**
 * FRS 12.2: "Each month, Finance/Admin triggers payslip generation, which
 * snapshots the current structure ... so a later salary revision doesn't
 * rewrite history." That only holds if a revision is a NEW row, not an edit
 * of the old one -- so this always creates a new version rather than
 * updating an existing structure in place, exactly like Payslip itself never
 * being edited after generation. Payroll picks up the new version
 * automatically the next time it resolves "in force" for a date on/after
 * effectiveFrom; runs already PROCESSED/FINALIZED/PAID are untouched, because
 * their Payslip rows hold their own snapshotted lines, not a live reference
 * to this table.
 */
export async function setSalaryStructure(actingUser, employeeId, input) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError(404, "Employee not found.");

  const effectiveFrom = input.effectiveFrom || startOfUtcDay(new Date());

  const clash = await prisma.salaryStructure.findFirst({ where: { employeeId, effectiveFrom } });
  if (clash) {
    throw new AppError(
      409,
      `A salary structure for this employee is already effective ${effectiveFrom.toISOString().slice(0, 10)}. ` +
        "Use a different effective date."
    );
  }

  const grossEarnings = round2(
    input.components.filter((c) => c.type === "EARNING").reduce((s, c) => s + c.amount, 0)
  );
  const totalDeductions = round2(
    input.components.filter((c) => c.type === "DEDUCTION").reduce((s, c) => s + c.amount, 0)
  );

  const structure = await prisma.$transaction(async (tx) => {
    const row = await tx.salaryStructure.create({
      data: {
        employeeId,
        effectiveFrom,
        components: { create: input.components.map((c) => ({ label: c.label, type: c.type, amount: c.amount })) },
      },
      include: STRUCTURE_INCLUDE,
    });

    await writeAuditLog(
      {
        entityType: STRUCTURE_ENTITY_TYPE,
        entityId: row.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: {
          employeeId,
          effectiveFrom: effectiveFrom.toISOString(),
          componentCount: input.components.length,
          grossEarnings,
          totalDeductions,
          netSalary: round2(grossEarnings - totalDeductions),
        },
        note: `New salary structure version for ${employee.firstName} ${employee.lastName}.`,
      },
      tx
    );

    return row;
  });

  return decorateStructure(structure);
}
