import { Router } from "express";
import {
  configHandler,
  listTransactionsHandler,
  getTransactionHandler,
  createAdjustmentHandler,
  listPeriodsHandler,
  createPeriodHandler,
  getPeriodSummaryHandler,
  preparePeriodHandler,
  markFiledHandler,
  acknowledgeHandler,
  filingDataHandler,
  gstSummaryHandler,
  filingHistoryHandler,
} from "./gst.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

// --- Reads (FRS 17.3 "View GST information | Finance Admin, Super Admin") ----
//
// VIEW_GST alone, with no wider composite gate of the kind /vendors and
// /invoices needed. Those two have operational roles -- a verifier, an approver
// -- who must be able to read a record in order to act on it. GST has no such
// role: Section 17.3 lists exactly two audiences for reading, and both of them
// hold VIEW_GST or bypass permissions entirely. Section 31 agrees ("GST |
// Finance Admin, Super Admin"). Widening it would expose company-wide tax
// position to people the FRS deliberately excludes, including every regular
// employee (Section 17.3's last row).
// FRS Section 31 "Settings ... GST registration details" -- read-only here.
// Changing the registration means changing COMPANY_GSTIN in the environment,
// which is deliberate: it is deployment configuration, not a record a user
// edits, and the client has not supplied the real value yet.
router.get("/config", requirePermission("VIEW_GST"), configHandler);
router.get("/transactions", requirePermission("VIEW_GST"), listTransactionsHandler);
router.get("/transactions/:id", requirePermission("VIEW_GST"), getTransactionHandler);
router.get("/summary", requirePermission("VIEW_GST"), gstSummaryHandler);
router.get("/periods", requirePermission("VIEW_GST"), listPeriodsHandler);
// FRS 29.8 names this exact path. It doubles as the period detail endpoint:
// a filing period stripped of its numbers is just a status.
router.get("/periods/:periodId/summary", requirePermission("VIEW_GST"), getPeriodSummaryHandler);

// --- Preparation ------------------------------------------------------------
//
// Section 17.3 puts "create GST records ... manual adjustment entries" and
// "modify GST records" with Finance Admin, and Section 30 seeds exactly three
// GST permissions. Posting an adjustment is part of getting a period right
// before it goes out, so it sits with PREPARE_GST_FILING rather than inventing
// a fourth code the FRS never lists.
//
// There is deliberately no PATCH and no DELETE on a GST transaction. An
// auto-generated row must keep matching the invoice or bill it came from, or
// the reconciliation block in the period summary stops meaning anything; a
// wrong figure is corrected by posting a signed adjustment against it. That
// also satisfies Section 26 rule 6, which forbids hard-deleting financial
// records outright.
router.post("/transactions/adjustments", requirePermission("PREPARE_GST_FILING"), createAdjustmentHandler);
router.post("/periods", requirePermission("PREPARE_GST_FILING"), createPeriodHandler);
router.patch("/periods/:periodId/prepare", requirePermission("PREPARE_GST_FILING"), preparePeriodHandler);
// The exportable working papers from Section 17.2's "Filing Preparation" step.
router.get("/periods/:periodId/filing-data", requirePermission("PREPARE_GST_FILING"), filingDataHandler);

// --- Filing -----------------------------------------------------------------
//
// Section 17.3 offers prepare and submit as either the same permission or a
// stricter split; Section 29.8 resolves it by putting mark-filed on
// SUBMIT_GST_FILING, so that is what is implemented. The maker-checker half of
// it -- the preparer of a period may not also record it as filed -- is in the
// service, because it compares the caller against the period's own
// preparedById and so cannot be expressed as a permission code.
//
// Nothing below submits anything to a government portal (FRS Section 18).
// "Filed" records that a human filed it elsewhere.
router.patch("/periods/:periodId/mark-filed", requirePermission("SUBMIT_GST_FILING"), markFiledHandler);
// Section 17.2's optional final state, for the portal's ARN.
router.patch("/periods/:periodId/acknowledge", requirePermission("SUBMIT_GST_FILING"), acknowledgeHandler);

// --- Reports (FRS 22 "GST report / Filing report / Tax summary") -------------
//
// Exported separately because Section 22 mounts reports under /reports, and
// gated on VIEW_FINANCIAL_REPORTS because Section 22's own access column for
// these rows reads "Super Admin, Finance Admin" -- the same gate the AR and AP
// reports use. Mirrors arReportRoutes and apReportRoutes.
export const gstReportRoutes = Router();
gstReportRoutes.use(authenticate);
gstReportRoutes.get("/summary", requirePermission("VIEW_FINANCIAL_REPORTS"), gstSummaryHandler);
gstReportRoutes.get("/filing-history", requirePermission("VIEW_FINANCIAL_REPORTS"), filingHistoryHandler);

export default router;
