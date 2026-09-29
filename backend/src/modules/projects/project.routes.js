import { Router } from "express";
import {
  listProjectsHandler,
  getProjectHandler,
  createProjectHandler,
  updateProjectHandler,
  setProjectStatusHandler,
  listMembersHandler,
  addMemberHandler,
  updateMemberHandler,
  listMilestonesHandler,
  addMilestoneHandler,
  updateMilestoneHandler,
  getProfitabilityHandler,
} from "./project.controller.js";
import { assertCanViewProjectFinancials } from "./project.service.js";
import { projectIdParamSchema } from "./project.validation.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

/**
 * FRS 29.5 gates profitability on "VIEW_FINANCIAL_REPORTS or assigned PM".
 * requirePermission handles a single code; the "or assigned PM" half needs the
 * record, so it is delegated to the service guard -- which still leaves the
 * decision here at the route layer rather than buried inside a handler.
 */
async function requireProjectFinancialAccess(req, res, next) {
  try {
    const { id } = projectIdParamSchema.parse(req.params);
    await assertCanViewProjectFinancials(req.user, id);
    return next();
  } catch (err) {
    return next(err);
  }
}

// --- Reads -----------------------------------------------------------------
// Authenticated, then scoped in the service: MANAGE_PROJECTS /
// VIEW_FINANCIAL_REPORTS / Super Admin see every project, everyone else sees
// only the projects they manage or are allocated to. Section 29.5 gates
// /projects on MANAGE_PROJECTS, but an allocated employee still has to be able
// to read the project they book expenses against (Section 11.3), and Section 8.3
// requires that narrowing to happen server-side.
router.get("/", listProjectsHandler);
router.get("/:id", getProjectHandler);
router.get("/:id/members", listMembersHandler);
router.get("/:id/milestones", listMilestonesHandler);

// --- Financial rollup (Section 29.5) ---------------------------------------
router.get("/:id/profitability", requireProjectFinancialAccess, getProfitabilityHandler);

// --- Writes ----------------------------------------------------------------
// MANAGE_PROJECTS on the route, never inside the service, so SUPER_ADMIN keeps
// the Section 30 bypass built into requirePermission.
//
// There is deliberately no DELETE anywhere in this file (Section 26 rule 6 /
// FR-18). A project is retired by setting status to CANCELLED, and an
// allocation by setting its endDate -- both preserve the cost history the
// Section 13.4 profitability formula depends on.
//
// Status can be set through either PATCH /:id (the endpoint Section 29.5
// documents) or PATCH /:id/status. They share one Section 27 transition
// guard in the service, so the route chosen never changes what is allowed.
router.post("/", requirePermission("MANAGE_PROJECTS"), createProjectHandler);
router.patch("/:id", requirePermission("MANAGE_PROJECTS"), updateProjectHandler);
router.patch("/:id/status", requirePermission("MANAGE_PROJECTS"), setProjectStatusHandler);

router.post("/:id/members", requirePermission("MANAGE_PROJECTS"), addMemberHandler);
router.patch("/:id/members/:memberId", requirePermission("MANAGE_PROJECTS"), updateMemberHandler);

router.post("/:id/milestones", requirePermission("MANAGE_PROJECTS"), addMilestoneHandler);
router.patch("/:id/milestones/:milestoneId", requirePermission("MANAGE_PROJECTS"), updateMilestoneHandler);

export default router;
