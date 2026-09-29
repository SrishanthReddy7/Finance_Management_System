// Full expense workflow (FRS Section 11 + the Section 40 vertical slice):
//   Employee drafts -> submits -> Manager review -> Finance review
//   -> Reimbursement -> Paid
// Every transition writes an ApprovalStep (history) and an AuditLog entry,
// inside the same transaction as the status change (Section 26, rule 7).
//
// Permission gating (APPROVE_EXPENSE / VERIFY_EXPENSE / PROCESS_REIMBURSEMENT)
// lives in expense.routes.js via requirePermission, matching Section 30 and
// the rest of the codebase. What stays here is everything that needs the
// record itself: ownership, hierarchy scope, and status-transition rules.

import path from "path";
import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { canReviewExpenseOf, getReviewableEmployeeIds } from "../../utils/hierarchy.js";
import { recordApprovalStep, listApprovalSteps } from "../../utils/approvalHistory.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { assertProjectAssignable } from "../projects/project.service.js";
import { getProjectBudgetWarnings } from "../budgets/budget.service.js";
import { resolveUploadPath } from "../../middleware/upload.middleware.js";

const ENTITY_TYPE = "ExpenseClaim";
const RECEIPT_SUBFOLDER = "receipts";

// Statuses in which the claim is still the employee's to change (FRS 11.4).
const EMPLOYEE_EDITABLE = ["DRAFT", "RETURNED"];
// FRS 11.4: "Cancelled is also allowed if the employee withdraws before any
// approval." RETURNED has had no approval either -- it is back with the owner.
const CANCELLABLE = ["DRAFT", "SUBMITTED", "RETURNED"];
// Receipts may be attached while the claim is still with the employee, and
// while it sits in review (FRS 11.1 step 2 runs alongside submission).
const RECEIPT_ATTACHABLE = ["DRAFT", "SUBMITTED", "RETURNED"];

// Only these ever go into an audit snapshot for a claim edit.
const CLAIM_FIELDS = [
  "categoryId",
  "projectId",
  "amount",
  "expenseDate",
  "purpose",
  "paymentMethod",
  "receiptMissing",
  "receiptMissingReason",
];

// Receipts are returned without `storageKey` -- clients address a receipt by
// its id and download it through the authorized endpoint, never by filename.
const RECEIPT_SELECT = {
  id: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
  uploadedAt: true,
  uploadedById: true,
};

// ---------------------------------------------------------------------------
// Categories (FRS 11.2)
// ---------------------------------------------------------------------------

/**
 * FRS 11.2 stores categories in a table "so Finance can add/rename/deactivate
 * categories ... without a code deployment" -- which only works if a client can
 * read the current list back. Active categories only; limits included so the
 * UI can warn before submitting.
 */
export async function listCategories({ includeInactive = false } = {}) {
  return prisma.expenseCategory.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true, softLimit: true, hardLimit: true },
  });
}

const CATEGORY_ENTITY_TYPE = "ExpenseCategory";

async function assertCategoryNameFree(name, exceptId = null) {
  // The column is case-sensitively unique, but "cab" next to "Cab" is a
  // duplicate to any human reader, so compare case-insensitively.
  const clash = await prisma.expenseCategory.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true },
  });
  if (clash) throw new AppError(409, `An expense category named "${clash.name}" already exists.`);
}

/** FRS 11.2: Finance can add a category without a deployment. */
export async function createCategory(actingUser, { name, softLimit, hardLimit }) {
  await assertCategoryNameFree(name);

  return prisma.$transaction(async (tx) => {
    const row = await tx.expenseCategory.create({
      data: { name, softLimit: softLimit ?? null, hardLimit: hardLimit ?? null },
      select: { id: true, name: true, isActive: true, softLimit: true, hardLimit: true },
    });
    await writeAuditLog(
      {
        entityType: CATEGORY_ENTITY_TYPE,
        entityId: row.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: { name: row.name, softLimit, hardLimit },
      },
      tx
    );
    return row;
  });
}

/**
 * FRS 11.2: rename / deactivate / re-limit. Deactivating only stops NEW claims
 * (assertCategoryClaimable); claims already filed keep their category.
 */
export async function updateCategory(actingUser, categoryId, input) {
  const existing = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!existing) throw new AppError(404, "Expense category not found.");

  if (input.name && input.name !== existing.name) await assertCategoryNameFree(input.name, categoryId);

  // The schema only sees the fields in this PATCH, so re-check the soft<=hard
  // rule against the values that will actually be stored.
  const nextSoft = input.softLimit !== undefined ? input.softLimit : existing.softLimit != null ? Number(existing.softLimit) : null;
  const nextHard = input.hardLimit !== undefined ? input.hardLimit : existing.hardLimit != null ? Number(existing.hardLimit) : null;
  if (nextSoft != null && nextHard != null && nextSoft > nextHard) {
    throw new AppError(400, "The soft limit cannot exceed the hard limit.");
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.expenseCategory.update({
      where: { id: categoryId },
      data: input,
      select: { id: true, name: true, isActive: true, softLimit: true, hardLimit: true },
    });
    await writeAuditLog(
      {
        entityType: CATEGORY_ENTITY_TYPE,
        entityId: categoryId,
        action: "UPDATE",
        performedById: actingUser.id,
        previousValue: {
          name: existing.name,
          isActive: existing.isActive,
          softLimit: existing.softLimit != null ? Number(existing.softLimit) : null,
          hardLimit: existing.hardLimit != null ? Number(existing.hardLimit) : null,
        },
        newValue: input,
      },
      tx
    );
    return row;
  });
}

/**
 * A well-formed UUID is not enough: the category must exist and still be
 * active, or Section 11.2's "deactivate a category" has no effect.
 */
export async function assertCategoryClaimable(categoryId) {
  const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new AppError(400, "The specified expense category does not exist.");
  if (!category.isActive) {
    throw new AppError(400, `Expense category "${category.name}" is inactive and cannot be claimed against.`);
  }
  return category;
}

/**
 * FRS 11.3, "Project/client association -- optional field on the claim".
 * Now that the Projects module exists, the rule lives there (it also rejects a
 * CANCELLED project, which must not accrue new spend) instead of being a local
 * existence check duplicated here.
 */

/**
 * FRS 11.3, "Missing receipt": the flag requires "a mandatory justification
 * note". Checked against the merged state so an edit can't strip the reason
 * while leaving the flag set.
 */
function assertReceiptJustification(receiptMissing, receiptMissingReason) {
  if (receiptMissing && !String(receiptMissingReason || "").trim()) {
    throw new AppError(400, "A justification is required when the claim is submitted without a receipt.");
  }
}

// ---------------------------------------------------------------------------
// Warnings (FRS 11.3 -- these warn, they never block)
// ---------------------------------------------------------------------------

/**
 * FRS 11.3, "Duplicate expense": another claim by the same employee with the
 * same amount + same category + same date (+/-1 day). Warns, does not block.
 */
async function findDuplicateClaims(claim) {
  const from = new Date(claim.expenseDate);
  from.setDate(from.getDate() - 1);
  const to = new Date(claim.expenseDate);
  to.setDate(to.getDate() + 1);

  return prisma.expenseClaim.findMany({
    where: {
      id: { not: claim.id },
      employeeId: claim.employeeId,
      categoryId: claim.categoryId,
      amount: claim.amount,
      expenseDate: { gte: from, lte: to },
    },
    select: { id: true, expenseDate: true, status: true },
  });
}

/**
 * Both FRS 11.3 warnings, assembled for whoever is reviewing the claim:
 * the duplicate check and the per-category *soft* limit (which "warns
 * approver" -- the hard limit is the one that blocks, at submission).
 */
export async function buildClaimWarnings(claim, category) {
  const warnings = [];

  const cat = category || (await prisma.expenseCategory.findUnique({ where: { id: claim.categoryId } }));
  if (cat?.softLimit != null && Number(claim.amount) > Number(cat.softLimit)) {
    warnings.push({
      code: "SOFT_LIMIT_EXCEEDED",
      message: `Amount ${claim.amount} exceeds the ${cat.name} soft limit of ${cat.softLimit}.`,
      softLimit: cat.softLimit,
      amount: claim.amount,
    });
  }

  const duplicates = await findDuplicateClaims(claim);
  if (duplicates.length > 0) {
    warnings.push({
      code: "POSSIBLE_DUPLICATE",
      message: `${duplicates.length} other claim(s) by this employee match the same category, amount and date (+/-1 day).`,
      claims: duplicates,
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Claim lifecycle
// ---------------------------------------------------------------------------

async function getClaimOr404(claimId) {
  const claim = await prisma.expenseClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new AppError(404, "Expense claim not found.");
  return claim;
}

function assertOwner(actingUser, claim) {
  if (claim.employeeId !== actingUser.employee?.id) {
    throw new AppError(403, "You can only act on your own expense claim.");
  }
}

/**
 * FRS 11.1 step 1. The claim starts in DRAFT (Section 11.4's lifecycle and the
 * schema default) so the employee can attach receipts at step 2 *before* it
 * enters review -- which is what makes Section 26 rule 4 enforceable at all.
 * Submission is the separate `submitClaim` call.
 */
export async function createClaim(actingUser, input) {
  if (!actingUser.employee) throw new AppError(403, "Only employees can submit expense claims.");

  await assertCategoryClaimable(input.categoryId);
  await assertProjectAssignable(input.projectId);
  assertReceiptJustification(input.receiptMissing, input.receiptMissingReason);

  return prisma.$transaction(async (tx) => {
    const claim = await tx.expenseClaim.create({
      data: {
        employeeId: actingUser.employee.id,
        categoryId: input.categoryId,
        projectId: input.projectId || null,
        amount: input.amount,
        expenseDate: new Date(input.expenseDate),
        purpose: input.purpose,
        paymentMethod: input.paymentMethod,
        receiptMissing: input.receiptMissing || false,
        receiptMissingReason: input.receiptMissingReason || null,
        status: "DRAFT",
      },
    });

    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: claim.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: { amount: input.amount, categoryId: input.categoryId, status: "DRAFT" },
      },
      tx
    );

    return claim;
  });
}

/**
 * FRS 11.3, "Resubmission: a Returned claim keeps its original ID and claim
 * history". Editing is the owner's, and only while the claim is theirs to
 * change -- an approved, rejected, paid or cancelled claim is frozen.
 */
export async function updateClaim(actingUser, claimId, input) {
  const existing = await getClaimOr404(claimId);
  assertOwner(actingUser, existing);

  if (!EMPLOYEE_EDITABLE.includes(existing.status)) {
    throw new AppError(409, `A claim in status ${existing.status} can no longer be edited.`);
  }

  if (input.categoryId) await assertCategoryClaimable(input.categoryId);
  if (input.projectId) await assertProjectAssignable(input.projectId);

  const merged = { ...existing, ...input };
  assertReceiptJustification(merged.receiptMissing, merged.receiptMissingReason);

  const data = { ...input };
  if (input.expenseDate) data.expenseDate = new Date(input.expenseDate);
  // Clearing the flag clears the justification with it -- a stale reason on a
  // claim that now has a receipt would be misleading in the audit trail.
  if (input.receiptMissing === false) data.receiptMissingReason = null;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.expenseClaim.update({ where: { id: claimId }, data });

    // Section 24: snapshot the changed fields only.
    const previousValue = {};
    const newValue = {};
    for (const field of CLAIM_FIELDS) {
      if (String(existing[field]) !== String(updated[field])) {
        previousValue[field] = existing[field];
        newValue[field] = updated[field];
      }
    }

    if (Object.keys(newValue).length > 0) {
      await writeAuditLog(
        {
          entityType: ENTITY_TYPE,
          entityId: claimId,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue,
          newValue,
        },
        tx
      );
    }

    return updated;
  });
}

/**
 * FRS 11.1 step 2->3 (first submission) and 11.3 resubmission of a RETURNED
 * claim. Same endpoint, same claim id, history preserved.
 *
 * This is where the two blocking rules apply:
 *   - Section 26 rule 4: at least one receipt unless receiptMissing is flagged
 *     with a justification.
 *   - Section 11.3: the per-category hard limit "blocks submission".
 */
export async function submitClaim(actingUser, claimId) {
  const claim = await prisma.expenseClaim.findUnique({
    where: { id: claimId },
    include: { category: true, _count: { select: { receipts: true } } },
  });
  if (!claim) throw new AppError(404, "Expense claim not found.");
  assertOwner(actingUser, claim);

  if (!EMPLOYEE_EDITABLE.includes(claim.status)) {
    throw new AppError(409, `Only a DRAFT or RETURNED claim can be submitted (currently ${claim.status}).`);
  }

  await assertCategoryClaimable(claim.categoryId);
  assertReceiptJustification(claim.receiptMissing, claim.receiptMissingReason);

  if (!claim.receiptMissing && claim._count.receipts === 0) {
    throw new AppError(
      400,
      "Attach at least one receipt, or flag the claim as receiptMissing with a justification."
    );
  }

  if (claim.category.hardLimit != null && Number(claim.amount) > Number(claim.category.hardLimit)) {
    throw new AppError(
      400,
      `Amount ${claim.amount} exceeds the ${claim.category.name} claim limit of ${claim.category.hardLimit}.`
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.expenseClaim.update({ where: { id: claimId }, data: { status: "SUBMITTED" } });
    await recordApprovalStep(
      {
        entityType: ENTITY_TYPE,
        entityId: claimId,
        actorUserId: actingUser.id,
        fromStatus: claim.status,
        toStatus: "SUBMITTED",
      },
      tx
    );
    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: claimId,
        action: "UPDATE",
        performedById: actingUser.id,
        previousValue: { status: claim.status },
        newValue: { status: "SUBMITTED" },
      },
      tx
    );
    return next;
  });

  // FRS 11.3: the duplicate check runs "on submission" and warns the reviewer.
  const warnings = await buildClaimWarnings(updated, claim.category);
  return { ...updated, warnings };
}

/**
 * FRS 11.4: "Cancelled is also allowed if the employee withdraws before any
 * approval." Status change only -- never a delete (Section 26, rule 6).
 */
export async function cancelClaim(actingUser, claimId, { comment } = {}) {
  const claim = await getClaimOr404(claimId);
  assertOwner(actingUser, claim);

  if (!CANCELLABLE.includes(claim.status)) {
    throw new AppError(409, `A claim in status ${claim.status} can no longer be cancelled.`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.expenseClaim.update({ where: { id: claimId }, data: { status: "CANCELLED" } });
    await recordApprovalStep(
      {
        entityType: ENTITY_TYPE,
        entityId: claimId,
        actorUserId: actingUser.id,
        fromStatus: claim.status,
        toStatus: "CANCELLED",
        comment: comment || null,
      },
      tx
    );
    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: claimId,
        action: "CANCEL",
        performedById: actingUser.id,
        previousValue: { status: claim.status },
        newValue: { status: "CANCELLED" },
        note: comment || null,
      },
      tx
    );
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Receipts (FRS 11.1 step 2, Section 32)
// ---------------------------------------------------------------------------

/**
 * Ownership + status check that runs *before* multer, so an unauthorized
 * upload never reaches the disk at all. addReceipt re-checks after the write.
 */
export async function assertCanAttachReceipt(actingUser, claimId) {
  const claim = await getClaimOr404(claimId);
  if (claim.employeeId !== actingUser.employee?.id) {
    throw new AppError(403, "You can only add receipts to your own claim.");
  }
  if (!RECEIPT_ATTACHABLE.includes(claim.status)) {
    throw new AppError(409, `Cannot add a receipt while claim is in status ${claim.status}.`);
  }
  return claim;
}

/**
 * Persists an already-uploaded file against the claim. `file` is multer's
 * object; `storageKey` is its generated filename (the UUID), which is what the
 * download endpoint resolves back to a path. No filesystem path is ever stored
 * in or returned from the database.
 */
export async function addReceipt(actingUser, claimId, file) {
  // Re-check rather than trusting the pre-multer guard: the claim could have
  // changed status during the upload, and this is the write path.
  await assertCanAttachReceipt(actingUser, claimId);

  const receipt = await prisma.expenseReceipt.create({
    data: {
      expenseClaimId: claimId,
      storageKey: path.basename(file.filename),
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedById: actingUser.id,
    },
    select: RECEIPT_SELECT,
  });

  // Section 24 names expenses as an audited entity; an attached receipt is
  // evidence for an approval decision, so it belongs in the trail.
  await writeAuditLog({
    entityType: ENTITY_TYPE,
    entityId: claimId,
    action: "UPDATE",
    performedById: actingUser.id,
    newValue: { receiptAdded: receipt.id, originalFileName: receipt.originalFileName },
  });

  return receipt;
}

/**
 * FRS Section 31, "receipt viewer" for the approvals queue. Authorization is
 * exactly the claim's own view rule, so a receipt is never more visible than
 * the claim it belongs to.
 */
export async function getReceiptForDownload(actingUser, claimId, receiptId) {
  const claim = await prisma.expenseClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new AppError(404, "Expense claim not found.");
  if (!(await assertCanViewClaim(actingUser, claim))) {
    throw new AppError(403, "You are not permitted to view this claim.");
  }

  const receipt = await prisma.expenseReceipt.findUnique({ where: { id: receiptId } });
  // Scoped to the claim in the URL, so a receipt id alone can't be walked.
  if (!receipt || receipt.expenseClaimId !== claimId) {
    throw new AppError(404, "Receipt not found.");
  }

  return {
    absolutePath: resolveUploadPath(RECEIPT_SUBFOLDER, receipt.storageKey),
    mimeType: receipt.mimeType,
    originalFileName: receipt.originalFileName,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function assertCanViewClaim(actingUser, claim) {
  const isOwner = claim.employeeId === actingUser.employee?.id;
  if (isOwner) return true;
  if (actingUser.roleType === "SUPER_ADMIN") return true;
  if (actingUser.permissionCodes?.includes("VERIFY_EXPENSE")) return true;
  if (actingUser.permissionCodes?.includes("APPROVE_EXPENSE")) {
    // Team Leads are scoped to direct reports here too (Section 0.1, Q5).
    return canReviewExpenseOf(actingUser, claim.employeeId);
  }
  return false;
}

export async function getClaim(actingUser, claimId) {
  const claim = await prisma.expenseClaim.findUnique({
    where: { id: claimId },
    include: {
      category: true,
      receipts: { select: RECEIPT_SELECT, orderBy: { uploadedAt: "asc" } },
      reimbursement: true,
      employee: true,
    },
  });
  if (!claim) throw new AppError(404, "Expense claim not found.");
  if (!(await assertCanViewClaim(actingUser, claim))) {
    throw new AppError(403, "You are not permitted to view this claim.");
  }

  // FRS 11.3: the approval history is part of the claim thread.
  const approvalHistory = await listApprovalSteps(ENTITY_TYPE, claimId);
  const warnings = await buildClaimWarnings(claim, claim.category);

  return { ...claim, approvalHistory, warnings };
}

/**
 * FRS Section 8's pattern applied to expense/reimbursement visibility:
 * Finance/Super Admin see everything, an approving manager sees their
 * reviewable hierarchy (Section 0.1 Q5's Team-Lead-vs-Manager depth), anyone
 * else sees only their own. Exported so the Reports module's Employee
 * Reimbursement report (FRS 22, "role-scoped like expenses") scopes claims
 * exactly the same way listClaims does, rather than a second copy of this
 * branching that could drift from it.
 *
 * Returns a Prisma `where` fragment scoping ExpenseClaim.employeeId, or
 * `null` for a caller with no employee profile and no override permission --
 * nothing is in scope for them (an empty result, not "everything").
 */
export async function resolveClaimVisibilityWhere(actingUser) {
  if (actingUser.roleType === "SUPER_ADMIN" || actingUser.permissionCodes?.includes("VERIFY_EXPENSE")) {
    return {};
  }
  if (actingUser.permissionCodes?.includes("APPROVE_EXPENSE") && actingUser.employee) {
    const reviewableIds = await getReviewableEmployeeIds(actingUser);
    return { employeeId: { in: [...reviewableIds, actingUser.employee.id] } };
  }
  if (actingUser.employee) {
    return { employeeId: actingUser.employee.id };
  }
  return null;
}

export async function listClaims(actingUser, { skip, take, status, projectId }) {
  const scopeWhere = await resolveClaimVisibilityWhere(actingUser);
  if (scopeWhere === null) return { rows: [], totalCount: 0 };
  let where = scopeWhere;

  // Section 31: lets an approver pull "the queue of pending claims to review".
  if (status) where = { ...where, status };
  // FRS 11.3, "Project/client association ... lets Finance later compute how
  // much did we spend on Project X". The project-side rollup in
  // projects/project.service.js aggregates the same data; this is the
  // drill-down to the individual claims behind that number.
  if (projectId) where = { ...where, projectId };

  const [rows, totalCount] = await Promise.all([
    prisma.expenseClaim.findMany({
      where,
      skip,
      take,
      include: { category: true, employee: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.expenseClaim.count({ where }),
  ]);
  return { rows, totalCount };
}

// ---------------------------------------------------------------------------
// Review workflow
// ---------------------------------------------------------------------------

export async function managerReview(actingUser, claimId, { decision, comment }) {
  const claim = await getClaimOr404(claimId);

  if (claim.status !== "SUBMITTED") {
    throw new AppError(409, `Claim must be SUBMITTED for manager review (currently ${claim.status}).`);
  }

  // Section 29.4: APPROVE_EXPENSE (gated on the route) *and* must be the
  // requester's manager. Super Admin bypasses the permission gate but is still
  // subject to the hierarchy rule -- and, sitting at the top of the chain,
  // satisfies it for everyone below.
  if (!actingUser.employee || !(await canReviewExpenseOf(actingUser, claim.employeeId))) {
    // 404, not 403: don't confirm the claim exists to a manager outside this
    // reporting line (and, for a Team Lead, outside their direct team).
    throw new AppError(404, "Expense claim not found.");
  }

  if (decision === "REJECT" || decision === "RETURN") {
    if (!comment) throw new AppError(400, "A comment/reason is required to reject or return a claim.");
  }

  const toStatus =
    decision === "APPROVE" ? "MANAGER_APPROVED" : decision === "REJECT" ? "MANAGER_REJECTED" : "RETURNED";
  const action = decision === "APPROVE" ? "APPROVE" : decision === "REJECT" ? "REJECT" : "RETURN";

  return prisma.$transaction(async (tx) => {
    const updated = await tx.expenseClaim.update({ where: { id: claimId }, data: { status: toStatus } });
    await recordApprovalStep(
      { entityType: ENTITY_TYPE, entityId: claimId, actorUserId: actingUser.id, fromStatus: claim.status, toStatus, comment },
      tx
    );
    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: claimId,
        action,
        performedById: actingUser.id,
        previousValue: { status: claim.status },
        newValue: { status: toStatus },
        note: comment,
      },
      tx
    );
    return updated;
  });
}

export async function financeReview(actingUser, claimId, { decision, comment }) {
  const claim = await getClaimOr404(claimId);

  if (claim.status !== "MANAGER_APPROVED") {
    throw new AppError(409, `Claim must be MANAGER_APPROVED for finance review (currently ${claim.status}).`);
  }
  if (decision === "REJECT" || decision === "RETURN") {
    if (!comment) throw new AppError(400, "A comment/reason is required to reject or return a claim.");
  }

  const toStatus =
    decision === "APPROVE" ? "REIMBURSEMENT_PENDING" : decision === "REJECT" ? "FINANCE_REJECTED" : "RETURNED";
  const action = decision === "APPROVE" ? "APPROVE" : decision === "REJECT" ? "REJECT" : "RETURN";

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.expenseClaim.update({ where: { id: claimId }, data: { status: toStatus } });

    // FRS 11.1 step 6: approval creates the reimbursement record.
    if (decision === "APPROVE") {
      await tx.reimbursement.create({
        data: { expenseClaimId: claimId, amount: claim.amount, paymentStatus: "PENDING" },
      });
    }

    await recordApprovalStep(
      { entityType: ENTITY_TYPE, entityId: claimId, actorUserId: actingUser.id, fromStatus: claim.status, toStatus, comment },
      tx
    );
    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: claimId,
        action,
        performedById: actingUser.id,
        previousValue: { status: claim.status },
        newValue: { status: toStatus },
        note: comment,
      },
      tx
    );
    return next;
  });

  // FRS 19 budget control: warn (never block -- see Handsoff.md) when this
  // claim's project has an ACTIVE budget at or over the utilization threshold.
  if (decision === "APPROVE" && claim.projectId) {
    const warnings = await getProjectBudgetWarnings(claim.projectId);
    return { ...updated, warnings };
  }
  return updated;
}

/**
 * FRS 11.1 steps 7-8: Finance records the payout and the claim becomes PAID.
 * One payment for the full amount (confirmed with the client) -- the schema's
 * ReimbursementPayment/totalPaid columns stay dormant, as they are not part of
 * the FRS Section 28.2 model.
 *
 * `externalTx` (Payout Subsystem Step 2): lets a caller that already owns an
 * open Prisma transaction -- PayoutService's atomic payout-completion flow --
 * run the write portion inside it, so "reimbursement marked paid" and "Payout
 * marked PROCESSED" commit or roll back together. Default behavior (no
 * `externalTx`) is unchanged: same precheck reads, same validation, same
 * writes, wrapped in its own `prisma.$transaction` exactly as before.
 */
export async function processReimbursement(actingUser, claimId, { method, referenceNo }, externalTx = null) {
  const claim = await getClaimOr404(claimId);

  if (claim.status !== "REIMBURSEMENT_PENDING") {
    throw new AppError(409, `Claim must be REIMBURSEMENT_PENDING (currently ${claim.status}).`);
  }

  const reimbursement = await prisma.reimbursement.findUnique({ where: { expenseClaimId: claimId } });
  if (!reimbursement) throw new AppError(409, "No reimbursement record exists for this claim.");
  if (reimbursement.paymentStatus === "PAID") {
    throw new AppError(409, "This reimbursement has already been paid.");
  }

  const run = async (tx) => {
    await tx.reimbursement.update({
      where: { expenseClaimId: claimId },
      data: {
        paymentStatus: "PAID",
        paidAt: new Date(),
        method,
        referenceNo: referenceNo || null,
        totalPaid: reimbursement.amount,
      },
    });
    const updated = await tx.expenseClaim.update({ where: { id: claimId }, data: { status: "PAID" } });

    await recordApprovalStep(
      {
        entityType: ENTITY_TYPE,
        entityId: claimId,
        actorUserId: actingUser.id,
        fromStatus: claim.status,
        toStatus: "PAID",
      },
      tx
    );
    await writeAuditLog(
      {
        entityType: "Reimbursement",
        entityId: reimbursement.id,
        action: "UPDATE",
        performedById: actingUser.id,
        previousValue: { paymentStatus: reimbursement.paymentStatus },
        newValue: { paymentStatus: "PAID", method, referenceNo: referenceNo || null },
      },
      tx
    );
    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: claimId,
        action: "UPDATE",
        performedById: actingUser.id,
        previousValue: { status: claim.status },
        newValue: { status: "PAID" },
      },
      tx
    );
    return updated;
  };

  return externalTx ? run(externalTx) : prisma.$transaction(run);
}
