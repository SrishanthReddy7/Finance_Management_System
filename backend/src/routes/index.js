// Central route mount point. Only modules that are actually implemented
// are wired in here -- importing an empty module file would crash the app,
// so add each remaining module's import as it gets built out (same pattern
// every time: see expenses/* as the reference implementation).

import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import userRoutes from "../modules/users/user.routes.js";
import employeeRoutes from "../modules/employees/employee.routes.js";
import salaryRoutes from "../modules/salaries/salary.routes.js";
import payrollRoutes, { employeePayrollRoutes, payslipRoutes } from "../modules/payroll/payroll.routes.js";
import departmentRoutes from "../modules/departments/department.routes.js";
import expenseRoutes from "../modules/expenses/expense.routes.js";
import clientRoutes from "../modules/clients/client.routes.js";
import projectRoutes from "../modules/projects/project.routes.js";
import invoiceRoutes, { arReportRoutes } from "../modules/invoice/invoice.routes.js";
import vendorRoutes from "../modules/vendors/vendor.routes.js";
import vendorBillRoutes, { apReportRoutes } from "../modules/vendors/vendorBill.routes.js";
import gstRoutes, { gstReportRoutes } from "../modules/gst/gst.routes.js";
import auditRoutes from "../modules/audit/audit.routes.js";
import budgetRoutes, { budgetReportRoutes } from "../modules/budgets/budget.routes.js";
import reportRoutes from "../modules/reports/report.routes.js";
import paymentRoutes, { paymentWebhookRoutes } from "../modules/payments/payment.routes.js";
import payoutRoutes, { employeePayoutAccountRoutes, payoutWebhookRoutes } from "../modules/payouts/payout.routes.js";
import notificationRoutes from "../modules/notifications/notification.routes.js";

const router = Router();

router.use("/notifications", notificationRoutes);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/employees", employeeRoutes);
// FRS 29.3 "Salary & Payroll" nests salary-structure and payslip-list under
// /employees/:id/... -- mounted as their own routers at the same prefix as
// the employees module's, same convention as the /reports sub-mounts below.
// Salary structure is owned by the Salaries module; payslip listing stays
// with Payroll, which generates payslips.
router.use("/employees", salaryRoutes);
router.use("/employees", employeePayrollRoutes);
router.use("/payslips", payslipRoutes);
router.use("/departments", departmentRoutes);
router.use("/expenses", expenseRoutes);
router.use("/clients", clientRoutes);
router.use("/projects", projectRoutes);
router.use("/invoices", invoiceRoutes);
// FRS 29.6 documents the AR reports under /reports, not /invoices, so they are
// mounted at their documented path. They live in the invoices module because
// they are pure invoice/payment aggregation; the generic Reports module
// (mounted last, below) never re-implements these -- it only adds the report
// names not already served by another module.
router.use("/reports/ar", arReportRoutes);
router.use("/vendors", vendorRoutes);
// FRS 29.7 mounts vendor bills at their own top-level path, not under
// /vendors/:id/bills -- a bill is queried by status and due date across all
// vendors far more often than it is browsed vendor by vendor.
router.use("/vendor-bills", vendorBillRoutes);
// FRS 22 "Vendor Payable", mounted under /reports for the same reason the AR
// reports are.
router.use("/reports/ap", apReportRoutes);
router.use("/gst", gstRoutes);
// FRS 22 lists "GST report / Filing report / Tax summary" among the reports, so
// the reporting views of the GST data are mounted under /reports alongside AR
// and AP. They are gated on VIEW_FINANCIAL_REPORTS rather than VIEW_GST, which
// is Section 22's own access column for those rows.
router.use("/reports/gst", gstReportRoutes);
router.use("/audit-logs", auditRoutes);
router.use("/budgets", budgetRoutes);
// FRS 22 "Budget vs Actual", mounted under /reports for the same reason the
// AR/AP/GST reports are.
router.use("/reports/budgets", budgetReportRoutes);
router.use("/payroll", payrollRoutes);
// Generic Reports module (FRS 22, 29.9): Revenue, Expense, Profit & Loss,
// Salary Expense, Employee Reimbursement, Project Profitability (list),
// Payment Transaction, Financial/Monthly Summary, Cash Flow. Mounted LAST at
// "/reports" so the more specific /reports/ar, /reports/ap, /reports/gst and
// /reports/budgets mounts above keep matching their own paths first.
router.use("/reports", reportRoutes);
// Payment Gateway Stage 7: POST /payments/webhook/razorpay. A SEPARATE
// router (see payment.routes.js) with no authenticate()/requirePermission()
// -- Razorpay's own webhook signature is this route's entire trust boundary,
// not a JWT. The raw-body capture this route depends on for signature
// verification is registered in app.js, scoped to this exact path, ahead of
// the app-wide express.json().
//
// MUST be mounted BEFORE the general "/payments" prefix below: paymentRoutes
// applies `authenticate` unconditionally to every request reaching it
// (router.use(authenticate), no path filter), and authenticate() responds
// directly with 401 rather than calling next() on failure -- so if the
// broader "/payments" mount were registered first, an unauthenticated
// webhook request would never even reach this router. Express tries
// registered middleware in order, so the more specific path has to come
// first.
router.use("/payments/webhook", paymentWebhookRoutes);
// Payment Gateway Stage 5/6: online payment initiation and verification
// (POST /payments/invoices/:invoiceId/initiate, POST /payments/verify).
// Mounted at its own top-level prefix, not under /invoices, because it's a
// distinct capability with its own module, the same reasoning vendor-bills
// got its own top-level prefix instead of nesting under /vendors.
// Authenticated (Stage 5 Section 1) -- unlike the webhook mount above.
router.use("/payments", paymentRoutes);
// Payout Subsystem Step 3C: the RazorpayX payout webhook. MUST be mounted
// BEFORE the general "/payouts" prefix below -- payoutRoutes applies
// `authenticate` unconditionally to every request reaching it
// (router.use(authenticate), no path filter), and authenticate() responds
// directly with 401 rather than calling next() on failure, so if the
// broader "/payouts" mount were registered first, an unauthenticated
// webhook request would never even reach this router. Exact same ordering
// rule already applied to "/payments/webhook" vs "/payments" above. The
// raw-body capture this route depends on for signature verification is
// registered in app.js, scoped to this exact path, ahead of the app-wide
// express.json().
router.use("/payouts/webhook", payoutWebhookRoutes);
// Payout Subsystem Step 2: money-OUT domain, deliberately separate from the
// "/payments" (money-IN, Razorpay) prefix above -- same reasoning that gave
// vendor-bills and the payments module their own top-level prefixes instead
// of nesting under an existing one.
router.use("/payouts", payoutRoutes);
router.use("/employees", employeePayoutAccountRoutes);

export default router;
