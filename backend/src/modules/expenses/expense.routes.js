import { Router } from "express";
import {
  listCategoriesHandler,
  createCategoryHandler,
  updateCategoryHandler,
  createClaimHandler,
  updateClaimHandler,
  submitClaimHandler,
  cancelClaimHandler,
  guardReceiptUpload,
  addReceiptHandler,
  downloadReceiptHandler,
  getClaimHandler,
  listClaimsHandler,
  managerReviewHandler,
  financeReviewHandler,
  reimburseHandler,
} from "./expense.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";
import { receiptUpload, singleFileAnyField } from "../../middleware/upload.middleware.js";

const router = Router();

router.use(authenticate);

// FRS 11.2: categories are a configurable table, so a client has to be able to
// read the current active list. Declared before "/:id" so it isn't swallowed.
router.get("/categories", listCategoriesHandler);

// FRS 11.2: "Finance can add/rename/deactivate categories". Finance is the
// VERIFY_EXPENSE holder; SUPER_ADMIN bypasses via requirePermission. No DELETE:
// a category is retired with isActive=false so past claims keep their category.
router.post("/categories", requirePermission("VERIFY_EXPENSE"), createCategoryHandler);
router.patch("/categories/:id", requirePermission("VERIFY_EXPENSE"), updateCategoryHandler);

// --- Employee-owned lifecycle (ownership enforced in the service) ----------
router.post("/", createClaimHandler);
router.get("/", listClaimsHandler);
router.get("/:id", getClaimHandler);
router.patch("/:id", updateClaimHandler);
router.post("/:id/submit", submitClaimHandler);
router.patch("/:id/cancel", cancelClaimHandler);

// guardReceiptUpload runs *before* multer so an unauthorized upload never
// touches the disk (FRS Section 32). The file may be sent under any field
// name -- see singleFileAnyField.
router.post("/:id/receipts", guardReceiptUpload, singleFileAnyField(receiptUpload), addReceiptHandler);
router.get("/:id/receipts/:receiptId", downloadReceiptHandler);

// --- Review workflow -------------------------------------------------------
// Section 30: the permission gate belongs on the route (and gives Super Admin
// the documented bypass); the hierarchy/status rules stay in the service.
router.patch("/:id/manager-review", requirePermission("APPROVE_EXPENSE"), managerReviewHandler);
router.patch("/:id/finance-review", requirePermission("VERIFY_EXPENSE"), financeReviewHandler);
router.post("/:id/reimbursement", requirePermission("PROCESS_REIMBURSEMENT"), reimburseHandler);

export default router;
