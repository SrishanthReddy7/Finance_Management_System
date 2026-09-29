import { z } from "zod";
import { positiveMoney } from "../../utils/zodMoney.js";

// FRS Section 27: the statuses a claim can be listed/filtered by.
const EXPENSE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "MANAGER_APPROVED",
  "MANAGER_REJECTED",
  "RETURNED",
  "FINANCE_APPROVED",
  "FINANCE_REJECTED",
  "REIMBURSEMENT_PENDING",
  "PAID",
  "CANCELLED",
];

export const createClaimSchema = z.object({
  categoryId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  amount: z.number().positive(),
  expenseDate: z.string().datetime(),
  purpose: z.string().min(3),
  paymentMethod: z.string().min(1),
  receiptMissing: z.boolean().optional(),
  // FRS 11.3: mandatory justification when the claim carries no receipt.
  // Cross-field enforcement lives in the service, where the *merged* state of
  // an edited claim is known (see assertReceiptJustification).
  receiptMissingReason: z.string().min(1).max(500).optional(),
});

// FRS 11.3, "Returned ... so the employee can fix and resubmit the same claim
// thread". Every field optional; nullable where clearing is meaningful.
export const updateClaimSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    projectId: z.string().uuid().nullable().optional(),
    amount: z.number().positive().optional(),
    expenseDate: z.string().datetime().optional(),
    purpose: z.string().min(3).optional(),
    paymentMethod: z.string().min(1).optional(),
    receiptMissing: z.boolean().optional(),
    receiptMissingReason: z.string().min(1).max(500).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  });

export const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "RETURN"]),
  comment: z.string().optional(),
});

// FRS Section 38 Q14 (answered): bank transfer and petty cash.
export const reimburseSchema = z.object({
  method: z.enum(["BANK_TRANSFER", "PETTY_CASH"]),
  referenceNo: z.string().min(1).max(100).optional(),
});

// FRS 11.4 / 27: cancellation. Section 24 keeps `note` optional, and 11.3
// makes a reason mandatory only for rejection -- so this stays optional.
export const cancelClaimSchema = z
  .object({
    comment: z.string().min(1).max(500).optional(),
  })
  .optional();

// FRS Section 31, "Expense Approvals: queue of pending claims to review".
export const listClaimsQuerySchema = z.object({
  status: z.enum(EXPENSE_STATUSES).optional(),
  // FRS 13.2 "project expenses": the drill-down behind a project's expenditure
  // figure. Still subject to the same per-user scoping as any other claim list.
  projectId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Categories (FRS 11.2 -- Finance can add/rename/deactivate; 11.3 -- limits)
// ---------------------------------------------------------------------------

const categoryName = z.string().trim().min(1, "Category name is required.").max(100);
const categoryLimit = positiveMoney("Limit");

// softLimit warns the approver; hardLimit blocks submission (FRS 11.3). A soft
// limit above the hard one could never fire, so reject that combination.
const softBelowHard = (body) =>
  body.softLimit == null || body.hardLimit == null || body.softLimit <= body.hardLimit;
const SOFT_BELOW_HARD = { message: "The soft limit cannot exceed the hard limit.", path: ["softLimit"] };

export const createCategorySchema = z
  .object({
    name: categoryName,
    softLimit: categoryLimit.optional(),
    hardLimit: categoryLimit.optional(),
  })
  .strict()
  .refine(softBelowHard, SOFT_BELOW_HARD);

// null clears a limit; there is no DELETE -- a category is retired by
// isActive=false so historical claims keep pointing at it (Section 26 rule 6).
export const updateCategorySchema = z
  .object({
    name: categoryName.optional(),
    isActive: z.boolean().optional(),
    softLimit: categoryLimit.nullable().optional(),
    hardLimit: categoryLimit.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Provide at least one field to update." })
  .refine(softBelowHard, SOFT_BELOW_HARD);

export const listCategoriesQuerySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const categoryIdParamSchema = z.object({ id: z.string().uuid("Category id must be a valid UUID.") });
