// Zod layer for Budgets (FRS Section 19, 22, 27, 29.9).
//
// Schemas are .strict(): an unknown key is a clean 400 rather than being
// silently dropped. `status` is never accepted on create/update -- it only
// moves through PATCH /budgets/:id/status -- and there is no field anywhere
// in this file for actual/committed/remaining/utilization, which Section 26
// rule 10 makes computed, never entered.

import { z } from "zod";
import { positiveMoney, nonNegativeMoney, currency } from "../../utils/zodMoney.js";

export const BUDGET_SCOPES = ["COMPANY", "DEPARTMENT", "PROJECT"];
export const BUDGET_STATUSES = ["DRAFT", "ACTIVE", "CLOSED"];

const uuid = (label) => z.string().uuid(`${label} must be a valid UUID.`);

const name = z.string().trim().min(1, "Budget name is required.").max(200);
const code = z.string().trim().min(1, "Budget code cannot be blank.").max(50);
// FRS 19's own example: "FY2026-Q3". Kept a free string like Department.code
// and ExpenseCategory.name -- a fiscal-year/quarter label has no single fixed
// shape across companies, so this is not parsed into structured dates.
const periodLabel = z.string().trim().min(1, "Period label is required (e.g. FY2026-Q3).").max(50);

// ---------------------------------------------------------------------------
// Allocation lines (FRS 19 "optionally broken into BudgetItem lines by category")
// ---------------------------------------------------------------------------

const itemSchema = z
  .object({
    category: z.string().trim().min(1, "Allocation category is required.").max(100),
    amount: nonNegativeMoney("Allocation amount"),
  })
  .strict();

const items = z.array(itemSchema).max(100, "A budget cannot have more than 100 allocation lines.");

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * A COMPANY budget carries neither FK; a DEPARTMENT budget carries only
 * departmentId; a PROJECT budget carries only projectId. Checked here so a
 * caller cannot create a budget whose scope disagrees with its own linkage
 * (the BudgetScope this row claims to be would silently stop meaning anything
 * once mixed FKs are allowed).
 */
const scopeShape = (body) => {
  if (body.scope === "COMPANY") return body.departmentId == null && body.projectId == null;
  if (body.scope === "DEPARTMENT") return body.departmentId != null && body.projectId == null;
  if (body.scope === "PROJECT") return body.projectId != null && body.departmentId == null;
  return true;
};
const SCOPE_SHAPE_ISSUE = {
  message:
    "A COMPANY budget must not set departmentId or projectId; a DEPARTMENT budget requires departmentId " +
    "(and no projectId); a PROJECT budget requires projectId (and no departmentId).",
  path: ["scope"],
};

export const createBudgetSchema = z
  .object({
    name,
    code: code.optional(),
    scope: z.enum(BUDGET_SCOPES),
    departmentId: uuid("departmentId").optional(),
    projectId: uuid("projectId").optional(),
    periodLabel,
    plannedAmount: positiveMoney("Planned amount"),
    currency: currency.optional(),
    items: items.optional(),
  })
  .strict()
  .refine(scopeShape, SCOPE_SHAPE_ISSUE);

// Editing is DRAFT-only (enforced in the service, same convention as vendor
// bills and invoices): once a budget is ACTIVE, changing the plan underneath
// whatever has already been measured against it would defeat the point of a
// plan. `scope` cannot be changed -- changing what a budget is FOR is a new
// budget, not an edit of this one. Sending `items` replaces the whole set,
// same as `lineItems` on a vendor bill.
export const updateBudgetSchema = z
  .object({
    name: name.optional(),
    code: code.nullable().optional(),
    departmentId: uuid("departmentId").nullable().optional(),
    projectId: uuid("projectId").nullable().optional(),
    periodLabel: periodLabel.optional(),
    plannedAmount: positiveMoney("Planned amount").optional(),
    currency: currency.optional(),
    items: items.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Provide at least one field to update." });

// FRS 27 lifecycle: DRAFT -> ACTIVE -> CLOSED. No other field belongs on this
// endpoint -- it exists purely so a caller can never smuggle a status change
// into PATCH /budgets/:id alongside a figure change.
export const setBudgetStatusSchema = z
  .object({
    status: z.enum(BUDGET_STATUSES),
    comment: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const budgetIdParamSchema = z.object({ id: uuid("Budget id") });

// Not .strict(): page/pageSize are consumed by the shared getPagination
// helper, exactly as every other list query in this codebase does.
export const listBudgetsQuerySchema = z.object({
  scope: z.enum(BUDGET_SCOPES).optional(),
  status: z.enum(BUDGET_STATUSES).optional(),
  departmentId: uuid("departmentId").optional(),
  projectId: uuid("projectId").optional(),
  periodLabel: z.string().trim().min(1).max(50).optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// FRS 22 "Budget vs Actual | Project, department, date range". There is no
// structured date range to filter on (see periodLabel above), so the summary
// is filtered the same way the list is.
export const budgetSummaryQuerySchema = z.object({
  scope: z.enum(BUDGET_SCOPES).optional(),
  status: z.enum(BUDGET_STATUSES).optional(),
  departmentId: uuid("departmentId").optional(),
  projectId: uuid("projectId").optional(),
});
