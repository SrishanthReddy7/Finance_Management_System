import { Router } from "express";
import { getSalaryStructureHandler, setSalaryStructureHandler } from "./salary.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission, requireSalaryAccess } from "../../middleware/role.middleware.js";

// FRS 29.3 nests salary-structure under /employees/:id/... -- mounted at
// "/employees" alongside the employees module's own router, same convention
// as apReportRoutes/arReportRoutes being mounted at "/reports" alongside
// their owning module. (Previously mounted from the Payroll module, before
// this one existed -- consolidated here, not duplicated: payroll.routes.js no
// longer registers these paths.)
const router = Router();
router.use(authenticate);

// FRS 29.3: viewing salary structure follows the Section 8 hierarchy
// (self / subordinate-of-requester / VIEW_COMPANY_SALARY override) -- the
// same requireSalaryAccess gate every salary-shaped endpoint in this codebase
// uses, not a bespoke check.
router.get("/:id/salary-structure", requireSalaryAccess((req) => req.params.id), getSalaryStructureHandler);

// FRS 29.3 `PUT /employees/:id/salary-structure | Update structure |
// MANAGE_SALARY`. A write, not visibility-gated -- MANAGE_SALARY holders are
// exactly Section 38 Q10's "HR and Finance dept" answer. Always creates a new
// effective-dated version; there is deliberately no PATCH/DELETE on an
// existing version (Section 26 rule 6 applied to salary history: a past
// version is never edited or removed, only superseded).
router.put("/:id/salary-structure", requirePermission("MANAGE_SALARY"), setSalaryStructureHandler);

export default router;
