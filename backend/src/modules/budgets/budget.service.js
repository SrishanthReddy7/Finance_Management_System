// Budget Management (FRS Section 19, 22, 27, 29.9, 31 "Budgets").
//
// What lives here: relationship validation, the Section 27 DRAFT -> ACTIVE ->
// CLOSED lifecycle, the allocation (BudgetItem) lines, and the Section 19
// actual/committed/remaining/utilization computation. Permission gating does
// NOT live here -- MANAGE_BUDGETS / VIEW_FINANCIAL_REPORTS are applied at the
// route layer via requirePermission (which carries the Section 30 Super Admin
// bypass), exactly as every other module in this codebase does it.
//
// Section 26 rule 10 ("actual spend is computed, never entered") governs this
// whole module: there is no column anywhere for actual/committed/remaining/
// utilization -- they are derived on every read from the same sources the
// Projects module already uses (expenses, vendor bills, salary structures),
// reusing that module's own cost logic rather than re-deriving it here.
//
// Nothing is hard-deleted (Section 26 rule 6). A budget is retired by moving
// it to CLOSED.

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog, diffChangedFields } from "../audit/audit.service.js";
import { assertDepartmentAssignable } from "../departments/department.service.js";
import { assertProjectAssignable, isAssignedProjectManager, getProjectActualSpend } from "../projects/project.service.js";
import { monthlyCostFromStructures } from "../salaries/salary.service.js";
import { ACTUAL_EXPENSE_STATUSES, PENDING_EXPENSE_STATUSES } from "../expenses/expense.constants.js";
import { ACTUAL_BILL_STATUSES, PENDING_BILL_STATUSES } from "../vendors/vendorBill.constants.js";
import { buildCurrencyCaveats } from "../../utils/currency.js";

const ENTITY_TYPE = "Budget";

// Audit snapshots carry changed fields only (Section 24).
const BUDGET_FIELDS = ["name", "code", "departmentId", "projectId", "periodLabel", "plannedAmount", "currency"];

// FRS Section 27: Draft -> Active -> Closed. A DRAFT that was never activated
// can also close directly (the plan was abandoned before it ever measured
// anything). CLOSED is terminal -- a closed budget is historical; a revised
// plan for the same scope/period is a new budget, not a reopened old one.
const STATUS_TRANSITIONS = {
  DRAFT: ["ACTIVE", "CLOSED"],
  ACTIVE: ["CLOSED"],
  CLOSED: [],
};

// A budget's figures can only be edited while it is still a plan. Once ACTIVE,
// changing the planned amount underneath whatever has already been measured
// against it would rewrite the very number utilization is being tracked
// against.
const EDITABLE_STATUSES = ["DRAFT"];

// FRS Section 23's own assumed convention: "Budget utilization crosses
// threshold (e.g., 80%)". Reused here rather than inventing a different
// number, since the FRS gives none for the control itself (Section 19's open
// question) but does give one for the notification it describes.
const APPROACHING_THRESHOLD_PERCENT = 80;

const DEPARTMENT_SELECT = { id: true, name: true, code: true, isActive: true };
const PROJECT_SELECT = { id: true, name: true, status: true, projectManagerId: true, clientId: true };
const ITEM_SELECT = { id: true, category: true, amount: true };

const BUDGET_INCLUDE = {
  department: { select: DEPARTMENT_SELECT },
  project: { select: PROJECT_SELECT },
  items: { select: ITEM_SELECT, orderBy: { category: "asc" } },
};

// ---------------------------------------------------------------------------
// Small numeric helpers -- Prisma hands back Decimal, not Number.
// ---------------------------------------------------------------------------

const num = (value) => (value == null ? 0 : Number(value));
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const sumWhere = (groups, statuses, field) =>
  round2(groups.filter((g) => statuses.includes(g.status)).reduce((s, g) => s + num(g._sum[field]), 0));

// ---------------------------------------------------------------------------
// Visibility scoping
// ---------------------------------------------------------------------------

/** Who sees every budget: Super Admin, MANAGE_BUDGETS holders, and Finance's reporting override. */
export function canSeeAllBudgets(actingUser) {
  if (actingUser.roleType === "SUPER_ADMIN") return true;
  const codes = actingUser.permissionCodes || [];
  return codes.includes("MANAGE_BUDGETS") || codes.includes("VIEW_FINANCIAL_REPORTS");
}

/**
 * FRS Section 31: "Budgets | Super Admin, Dept/Project owners". There is no
 * "owner" concept on a Department in this schema, so the narrower rule that
 * actually applies is the same one project profitability already uses: the
 * assigned manager of the PROJECT this budget belongs to.
 */
function canViewBudget(actingUser, budget) {
  if (canSeeAllBudgets(actingUser)) return true;
  return budget.scope === "PROJECT" && Boolean(budget.project) && isAssignedProjectManager(actingUser, budget.project);
}

// ---------------------------------------------------------------------------
// Relationship validation / duplicate prevention (server-side, FRS 8.3)
// ---------------------------------------------------------------------------

async function assertCodeFree(code, excludeId = null) {
  if (!code) return;
  const clash = await prisma.budget.findFirst({
    where: { code, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true },
  });
  if (clash) throw new AppError(409, `Budget code "${code}" is already used by "${clash.name}".`);
}

/**
 * FRS 19 business rule: "Prevent invalid duplicate budgets". Two DRAFT/ACTIVE
 * budgets for the same scope + linkage + period would leave "the" planned
 * amount for that scope/period ambiguous, which is exactly what utilization
 * is supposed to be measured against. A CLOSED budget does not clash -- it is
 * history, and a new budget for the same period is how it gets superseded.
 */
async function assertNoDuplicateBudget({ scope, departmentId, projectId, periodLabel }, excludeId = null) {
  const clash = await prisma.budget.findFirst({
    where: {
      scope,
      departmentId: departmentId ?? null,
      projectId: projectId ?? null,
      periodLabel,
      status: { in: ["DRAFT", "ACTIVE"] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true, status: true },
  });
  if (clash) {
    throw new AppError(
      409,
      `A ${scope.toLowerCase()} budget for period "${periodLabel}" already exists ("${clash.name}", status ` +
        `${clash.status}). Close it before creating a replacement, or edit it directly.`
    );
  }
}

// ---------------------------------------------------------------------------
// Actual / committed spend, by scope (FRS 19)
// ---------------------------------------------------------------------------

/**
 * DEPARTMENT/COMPANY payroll run-rate: sum of the currently in-force salary
 * structure's EARNING components, across the employees in scope. This is a
 * monthly run-rate, not prorated to the budget's period -- periodLabel is a
 * free string (FY2026-Q3, a quarter, a year...) with no parseable start/end
 * date in this schema, so there is nothing to prorate against. Reuses
 * monthlyCostFromStructures from the Salaries module rather than re-deriving
 * "which structure is in force" a second time.
 */
async function computeMonthlyPayrollRunRate({ departmentId } = {}) {
  const employees = await prisma.employee.findMany({
    where: {
      status: { in: ["ACTIVE", "PROBATION", "NOTICE_PERIOD"] },
      ...(departmentId ? { departmentId } : {}),
    },
    select: { id: true, salaryStructures: { include: { components: true } } },
  });

  const now = new Date();
  let monthlyPayroll = 0;
  let employeesWithoutSalary = 0;
  for (const employee of employees) {
    const { monthlyCost, structureFound } = monthlyCostFromStructures(employee.salaryStructures, now);
    if (!structureFound) employeesWithoutSalary += 1;
    monthlyPayroll += monthlyCost;
  }

  return { monthlyPayroll: round2(monthlyPayroll), employeeCount: employees.length, employeesWithoutSalary };
}

/**
 * FRS 19: "Actual spending is computed ... the sum of approved expenses +
 * vendor bills + salary allocations tagged to that scope." What "tagged to
 * that scope" resolves to differs by scope, because only Project carries a
 * direct FK on ExpenseClaim/VendorBill -- Employee.departmentId is the only
 * link a Department has, and nothing links a VendorBill to a department at
 * all, which is called out as a caveat rather than silently ignored.
 */
async function computeBudgetActuals(budget) {
  if (budget.scope === "PROJECT") {
    const spend = await getProjectActualSpend(budget.projectId);
    const caveats = [
      "Actual spend follows the FRS 13.4 approximation: allocationPercent x monthly salary x months allocated " +
        "for labour, plus approved expenses and approved vendor bills tagged to this project.",
    ];
    if (spend.membersWithoutSalary.length > 0) {
      caveats.push(`${spend.membersWithoutSalary.length} allocated employee(s) have no salary structure on record.`);
    }
    return {
      actual: spend.actual,
      committed: spend.committed,
      breakdown: { labour: spend.labourCost, expenses: spend.expenses, vendorBills: spend.vendorBills },
      caveats,
    };
  }

  if (budget.scope === "DEPARTMENT") {
    const [expenseGroups, payroll] = await Promise.all([
      prisma.expenseClaim.groupBy({
        by: ["status"],
        where: { employee: { departmentId: budget.departmentId } },
        _sum: { amount: true },
      }),
      computeMonthlyPayrollRunRate({ departmentId: budget.departmentId }),
    ]);
    const expenses = sumWhere(expenseGroups, ACTUAL_EXPENSE_STATUSES, "amount");
    const committed = sumWhere(expenseGroups, PENDING_EXPENSE_STATUSES, "amount");

    const caveats = [
      "Department actual spend combines approved employee expenses (by the employee's assigned department) with " +
        "the department's current monthly payroll run-rate. Vendor bills are not tagged to a department in this " +
        "system, so vendor spend is not included at DEPARTMENT scope.",
    ];
    if (payroll.employeesWithoutSalary > 0) {
      caveats.push(`${payroll.employeesWithoutSalary} employee(s) in this department have no salary structure on record.`);
    }

    return {
      actual: round2(expenses + payroll.monthlyPayroll),
      committed,
      breakdown: { expenses, payroll: payroll.monthlyPayroll },
      caveats,
    };
  }

  // COMPANY
  const [expenseGroups, billGroups, payroll] = await Promise.all([
    prisma.expenseClaim.groupBy({ by: ["status"], _sum: { amount: true } }),
    prisma.vendorBill.groupBy({ by: ["status"], _sum: { totalAmount: true } }),
    computeMonthlyPayrollRunRate(),
  ]);
  const expenses = sumWhere(expenseGroups, ACTUAL_EXPENSE_STATUSES, "amount");
  const pendingExpenses = sumWhere(expenseGroups, PENDING_EXPENSE_STATUSES, "amount");
  const vendorBills = sumWhere(billGroups, ACTUAL_BILL_STATUSES, "totalAmount");
  const pendingVendorBills = sumWhere(billGroups, PENDING_BILL_STATUSES, "totalAmount");

  const caveats = [
    "Company actual spend combines all approved expenses, all approved vendor bills, and the company's current " +
      "monthly payroll run-rate, none of which are prorated to this budget's period.",
  ];
  if (payroll.employeesWithoutSalary > 0) {
    caveats.push(`${payroll.employeesWithoutSalary} employee(s) have no salary structure on record.`);
  }

  return {
    actual: round2(expenses + vendorBills + payroll.monthlyPayroll),
    committed: round2(pendingExpenses + pendingVendorBills),
    breakdown: { expenses, vendorBills, payroll: payroll.monthlyPayroll },
    caveats,
  };
}

// ---------------------------------------------------------------------------
// Budget controls (FRS 19's own open question -- resolved as warn, not block;
// see Handsoff.md) -- utilization thresholds, computed, never entered.
// ---------------------------------------------------------------------------

function buildBudgetControlWarnings({ plannedAmount, actual, committed, remaining, utilizationPercent }) {
  const warnings = [];

  if (utilizationPercent != null) {
    if (actual > plannedAmount) {
      warnings.push({
        code: "BUDGET_EXCEEDED",
        message: `Actual spend (${actual}) exceeds the planned budget (${plannedAmount}) by ${round2(actual - plannedAmount)}.`,
      });
    } else if (utilizationPercent >= APPROACHING_THRESHOLD_PERCENT) {
      warnings.push({
        code: "BUDGET_APPROACHING_LIMIT",
        message: `Utilization is at ${utilizationPercent}% of the planned budget (threshold: ${APPROACHING_THRESHOLD_PERCENT}%).`,
      });
    }
  }

  if (committed > 0 && remaining >= 0 && committed > remaining) {
    warnings.push({
      code: "INSUFFICIENT_REMAINING_BUDGET",
      message: `${committed} of pending expenses/vendor bills are committed against only ${remaining} of remaining budget.`,
    });
  }

  return warnings;
}

/**
 * Non-blocking warning for any module that approves spend against a PROJECT
 * (expense.financeReview, vendorBill.approveVendorBill). Warn-only, per the
 * client's confirmed choice recorded in Handsoff.md: budget overruns notify,
 * they do not block the approval that would otherwise go through.
 */
export async function getProjectBudgetWarnings(projectId) {
  if (!projectId) return [];

  const budgets = await prisma.budget.findMany({
    where: { projectId, scope: "PROJECT", status: "ACTIVE" },
    select: { id: true, name: true, periodLabel: true, plannedAmount: true, currency: true },
  });
  if (budgets.length === 0) return [];

  const spend = await getProjectActualSpend(projectId);
  const warnings = [];
  for (const budget of budgets) {
    const plannedAmount = round2(num(budget.plannedAmount));
    if (plannedAmount <= 0) continue;
    const utilizationPercent = round2((spend.actual / plannedAmount) * 100);

    if (spend.actual > plannedAmount) {
      warnings.push({
        code: "PROJECT_BUDGET_EXCEEDED",
        message:
          `This project's "${budget.name}" budget (${budget.periodLabel}) is exceeded: actual spend ` +
          `${spend.actual} ${budget.currency} vs planned ${plannedAmount} ${budget.currency}.`,
        budgetId: budget.id,
      });
    } else if (utilizationPercent >= APPROACHING_THRESHOLD_PERCENT) {
      warnings.push({
        code: "PROJECT_BUDGET_APPROACHING_LIMIT",
        message: `This project's "${budget.name}" budget (${budget.periodLabel}) is at ${utilizationPercent}% utilization.`,
        budgetId: budget.id,
      });
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

async function decorateBudget(budget) {
  const plannedAmount = round2(num(budget.plannedAmount));
  const items = (budget.items || []).map((item) => ({ ...item, amount: round2(num(item.amount)) }));
  const itemsTotal = round2(items.reduce((sum, item) => sum + item.amount, 0));

  const { actual, committed, breakdown, caveats } = await computeBudgetActuals(budget);
  const remaining = round2(plannedAmount - actual);
  const utilizationPercent = plannedAmount === 0 ? null : round2((actual / plannedAmount) * 100);

  const warnings = buildBudgetControlWarnings({ plannedAmount, actual, committed, remaining, utilizationPercent });
  if (items.length > 0 && itemsTotal !== plannedAmount) {
    warnings.push({
      code: "ALLOCATION_TOTAL_MISMATCH",
      message: `Allocation lines total ${itemsTotal} against a planned amount of ${plannedAmount}.`,
      itemsTotal,
      plannedAmount,
    });
  }

  return {
    ...budget,
    plannedAmount,
    items,
    utilization: {
      plannedAmount,
      actual,
      committed,
      remaining,
      utilizationPercent,
      isExceeded: actual > plannedAmount,
      isApproachingLimit: utilizationPercent != null && utilizationPercent >= APPROACHING_THRESHOLD_PERCENT && actual <= plannedAmount,
      breakdown,
    },
    warnings,
    caveats,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listBudgets(actingUser, { scope, status, departmentId, projectId, periodLabel, search, skip, take }) {
  const filters = [];

  if (!canSeeAllBudgets(actingUser)) {
    // Section 31 "Dept/Project owners": an assigned project manager sees the
    // PROJECT-scope budgets for the projects they manage. No employee profile
    // and no privileged permission means no budget is in scope.
    if (!actingUser.employee) return { rows: [], totalCount: 0 };
    filters.push({ scope: "PROJECT", project: { projectManagerId: actingUser.employee.id } });
  }

  if (scope) filters.push({ scope });
  if (status) filters.push({ status });
  if (departmentId) filters.push({ departmentId });
  if (projectId) filters.push({ projectId });
  if (periodLabel) filters.push({ periodLabel });
  if (search) {
    filters.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  const where = filters.length > 0 ? { AND: filters } : {};

  const [rows, totalCount] = await Promise.all([
    prisma.budget.findMany({
      where,
      skip,
      take,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: BUDGET_INCLUDE,
    }),
    prisma.budget.count({ where }),
  ]);

  return { rows: await Promise.all(rows.map((row) => decorateBudget(row))), totalCount };
}

/**
 * 404 rather than 403 for a budget outside the caller's scope, matching the
 * convention expenses and projects use (Section 8.3): don't confirm a record
 * exists to someone who may not see it.
 */
export async function getBudgetOr404(actingUser, budgetId) {
  const budget = await prisma.budget.findUnique({ where: { id: budgetId }, include: BUDGET_INCLUDE });
  if (!budget) throw new AppError(404, "Budget not found.");
  if (!canViewBudget(actingUser, budget)) throw new AppError(404, "Budget not found.");

  return decorateBudget(budget);
}

/** FRS 29.9 `GET /budgets/:id/utilization` -- the same figures, as their own view. */
export async function getBudgetUtilization(actingUser, budgetId) {
  const budget = await getBudgetOr404(actingUser, budgetId);
  return {
    budgetId: budget.id,
    name: budget.name,
    code: budget.code,
    scope: budget.scope,
    departmentId: budget.departmentId,
    projectId: budget.projectId,
    periodLabel: budget.periodLabel,
    status: budget.status,
    currency: budget.currency,
    ...budget.utilization,
    warnings: budget.warnings,
    caveats: budget.caveats,
  };
}

// ---------------------------------------------------------------------------
// Writes -- budget master + allocation lines
// ---------------------------------------------------------------------------

export async function createBudget(actingUser, input) {
  if (input.departmentId) await assertDepartmentAssignable(input.departmentId);
  if (input.projectId) await assertProjectAssignable(input.projectId);
  if (input.code) await assertCodeFree(input.code);
  await assertNoDuplicateBudget({
    scope: input.scope,
    departmentId: input.departmentId ?? null,
    projectId: input.projectId ?? null,
    periodLabel: input.periodLabel,
  });

  const budget = await prisma.$transaction(async (tx) => {
    const row = await tx.budget.create({
      data: {
        name: input.name,
        code: input.code ?? null,
        scope: input.scope,
        departmentId: input.departmentId ?? null,
        projectId: input.projectId ?? null,
        periodLabel: input.periodLabel,
        plannedAmount: input.plannedAmount,
        currency: input.currency || "INR",
        // status omitted so the schema default DRAFT applies.
        ...(input.items && input.items.length > 0
          ? { items: { create: input.items.map((item) => ({ category: item.category, amount: item.amount })) } }
          : {}),
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
          code: row.code,
          scope: row.scope,
          departmentId: row.departmentId,
          projectId: row.projectId,
          periodLabel: row.periodLabel,
          plannedAmount: round2(num(row.plannedAmount)),
          currency: row.currency,
          status: row.status,
          itemCount: input.items?.length || 0,
        },
      },
      tx
    );

    return row;
  });

  return getBudgetOr404(actingUser, budget.id);
}

export async function updateBudget(actingUser, budgetId, input) {
  const existing = await prisma.budget.findUnique({ where: { id: budgetId }, include: { items: true } });
  if (!existing) throw new AppError(404, "Budget not found.");

  if (!EDITABLE_STATUSES.includes(existing.status)) {
    throw new AppError(
      409,
      `Only a DRAFT budget can be edited; this one is ${existing.status}. Close it and create a replacement if ` +
        "the figures are wrong."
    );
  }

  // Validate against the MERGED linkage, not just the supplied keys -- `scope`
  // itself is immutable, so the merged departmentId/projectId must still match
  // the scope this row was created with.
  const departmentId = input.departmentId === undefined ? existing.departmentId : input.departmentId;
  const projectId = input.projectId === undefined ? existing.projectId : input.projectId;
  if (existing.scope === "COMPANY" && (departmentId || projectId)) {
    throw new AppError(400, "A COMPANY budget cannot have a departmentId or projectId.");
  }
  if (existing.scope === "DEPARTMENT" && (!departmentId || projectId)) {
    throw new AppError(400, "A DEPARTMENT budget requires departmentId and must not have a projectId.");
  }
  if (existing.scope === "PROJECT" && (!projectId || departmentId)) {
    throw new AppError(400, "A PROJECT budget requires projectId and must not have a departmentId.");
  }

  if (input.departmentId) await assertDepartmentAssignable(input.departmentId);
  if (input.projectId) await assertProjectAssignable(input.projectId);
  if (input.code) await assertCodeFree(input.code, budgetId);

  const periodLabel = input.periodLabel ?? existing.periodLabel;
  if (input.periodLabel !== undefined || input.departmentId !== undefined || input.projectId !== undefined) {
    await assertNoDuplicateBudget({ scope: existing.scope, departmentId, projectId, periodLabel }, budgetId);
  }

  await prisma.$transaction(async (tx) => {
    if (input.items) {
      // Replaced as a set, same convention as VendorBill.items/InvoiceLineItem:
      // this is an edit of a DRAFT that has never been activated, not a
      // deletion of a committed financial record (Section 26 rule 6).
      await tx.budgetItem.deleteMany({ where: { budgetId } });
      if (input.items.length > 0) {
        await tx.budgetItem.createMany({
          data: input.items.map((item) => ({ budgetId, category: item.category, amount: item.amount })),
        });
      }
    }

    const row = await tx.budget.update({
      where: { id: budgetId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.periodLabel !== undefined ? { periodLabel: input.periodLabel } : {}),
        ...(input.plannedAmount !== undefined ? { plannedAmount: input.plannedAmount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
      },
    });

    const { previousValue, newValue, changed } = diffChangedFields(
      normaliseForDiff(existing),
      normaliseForDiff(row),
      BUDGET_FIELDS
    );
    if (input.items) {
      previousValue.itemCount = existing.items.length;
      newValue.itemCount = input.items.length;
    }

    if (changed || input.items) {
      await writeAuditLog(
        {
          entityType: ENTITY_TYPE,
          entityId: budgetId,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue,
          newValue,
        },
        tx
      );
    }
  });

  return getBudgetOr404(actingUser, budgetId);
}

/** Dates/Decimals flattened so the audit diff doesn't report unchanged fields. */
function normaliseForDiff(row) {
  return { ...row, plannedAmount: round2(num(row.plannedAmount)) };
}

// ---------------------------------------------------------------------------
// Writes -- the Section 27 lifecycle
// ---------------------------------------------------------------------------

export async function setBudgetStatus(actingUser, budgetId, { status, comment }) {
  const existing = await prisma.budget.findUnique({ where: { id: budgetId } });
  if (!existing) throw new AppError(404, "Budget not found.");

  if (existing.status === status) {
    throw new AppError(409, `Budget is already ${status}.`);
  }
  const allowed = STATUS_TRANSITIONS[existing.status] || [];
  if (!allowed.includes(status)) {
    throw new AppError(
      409,
      allowed.length === 0
        ? `${existing.status} is a terminal status; no further transitions are allowed.`
        : `Cannot move a ${existing.status} budget to ${status}. Allowed: ${allowed.join(", ")}.`
    );
  }

  // Activating a zero-amount plan would make every utilization figure a
  // division by (or against) nothing meaningful.
  if (status === "ACTIVE" && round2(num(existing.plannedAmount)) <= 0) {
    throw new AppError(409, "A budget with a zero planned amount cannot be activated.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.budget.update({ where: { id: budgetId }, data: { status } });
    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: budgetId,
        action: "UPDATE",
        performedById: actingUser.id,
        previousValue: { status: existing.status },
        newValue: { status },
        note: comment || null,
      },
      tx
    );
  });

  return getBudgetOr404(actingUser, budgetId);
}

// ---------------------------------------------------------------------------
// Summary / reporting (FRS 22 "Budget vs Actual", 29.9)
// ---------------------------------------------------------------------------

/**
 * Every ACTIVE/CLOSED budget (a DRAFT plan is not yet a committed spend plan,
 * same reasoning project profitability already applies), reduced to the
 * Section 19 derived figures and rolled up by scope/department/project/period
 * -- the breakdowns Section 22 asks a "Budget vs Actual" report for.
 */
export async function getBudgetSummary(actingUser, { scope, status, departmentId, projectId }) {
  const filters = [];
  if (!canSeeAllBudgets(actingUser)) {
    if (!actingUser.employee) return emptySummary();
    filters.push({ scope: "PROJECT", project: { projectManagerId: actingUser.employee.id } });
  }

  filters.push({ status: status ? status : { in: ["ACTIVE", "CLOSED"] } });
  if (scope) filters.push({ scope });
  if (departmentId) filters.push({ departmentId });
  if (projectId) filters.push({ projectId });

  const where = { AND: filters };
  const budgets = await prisma.budget.findMany({
    where,
    include: BUDGET_INCLUDE,
    orderBy: [{ scope: "asc" }, { periodLabel: "asc" }],
  });

  const rows = [];
  for (const budget of budgets) {
    const { actual, committed } = await computeBudgetActuals(budget);
    const plannedAmount = round2(num(budget.plannedAmount));
    const remaining = round2(plannedAmount - actual);
    const utilizationPercent = plannedAmount === 0 ? null : round2((actual / plannedAmount) * 100);

    rows.push({
      id: budget.id,
      name: budget.name,
      code: budget.code,
      scope: budget.scope,
      status: budget.status,
      periodLabel: budget.periodLabel,
      currency: budget.currency,
      department: budget.department,
      project: budget.project ? { id: budget.project.id, name: budget.project.name } : null,
      plannedAmount,
      actual,
      committed,
      remaining,
      utilizationPercent,
      isExceeded: actual > plannedAmount,
    });
  }

  return { ...buildSummary(rows), budgets: rows };
}

function emptySummary() {
  return { ...buildSummary([]), budgets: [] };
}

function buildSummary(rows) {
  const totals = rows.reduce(
    (acc, r) => ({
      plannedAmount: round2(acc.plannedAmount + r.plannedAmount),
      actual: round2(acc.actual + r.actual),
      committed: round2(acc.committed + r.committed),
    }),
    { plannedAmount: 0, actual: 0, committed: 0 }
  );

  const rollup = (keyFn) => {
    const byKey = new Map();
    for (const row of rows) {
      const key = keyFn(row);
      if (key == null) continue;
      const entry = byKey.get(key.id) || { ...key, budgetCount: 0, plannedAmount: 0, actual: 0 };
      entry.budgetCount += 1;
      entry.plannedAmount = round2(entry.plannedAmount + row.plannedAmount);
      entry.actual = round2(entry.actual + row.actual);
      byKey.set(key.id, entry);
    }
    return [...byKey.values()];
  };

  return {
    summary: {
      budgetCount: rows.length,
      plannedAmount: totals.plannedAmount,
      actual: totals.actual,
      committed: totals.committed,
      remaining: round2(totals.plannedAmount - totals.actual),
      utilizationPercent: totals.plannedAmount === 0 ? null : round2((totals.actual / totals.plannedAmount) * 100),
      exceededCount: rows.filter((r) => r.isExceeded).length,
    },
    byScope: ["COMPANY", "DEPARTMENT", "PROJECT"].map((s) => {
      const matched = rows.filter((r) => r.scope === s);
      return {
        scope: s,
        budgetCount: matched.length,
        plannedAmount: round2(matched.reduce((sum, r) => sum + r.plannedAmount, 0)),
        actual: round2(matched.reduce((sum, r) => sum + r.actual, 0)),
      };
    }),
    byDepartment: rollup((r) => (r.department ? { id: r.department.id, department: r.department } : null)),
    byProject: rollup((r) => (r.project ? { id: r.project.id, project: r.project } : null)),
    byPeriod: rollup((r) => ({ id: r.periodLabel, periodLabel: r.periodLabel })),
    caveats: [
      "Actual spend for each budget follows the same per-scope approximations documented on that budget " +
        "(see GET /budgets/:id).",
      ...buildCurrencyCaveats(rows),
    ],
  };
}
