// Thin HTTP layer: parse + delegate + respond. No business logic, no
// permission checks (those are middleware, composed in project.routes.js).

import * as projectService from "./project.service.js";
import {
  createProjectSchema,
  updateProjectSchema,
  setProjectStatusSchema,
  listProjectsQuerySchema,
  projectIdParamSchema,
  addMemberSchema,
  updateMemberSchema,
  memberIdParamSchema,
  createMilestoneSchema,
  updateMilestoneSchema,
  milestoneIdParamSchema,
} from "./project.validation.js";
import { ok, created } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjectsHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const filters = listProjectsQuerySchema.parse(req.query);
    const { rows, totalCount } = await projectService.listProjects(req.user, { ...filters, skip, take });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}

export async function getProjectHandler(req, res, next) {
  try {
    const { id } = projectIdParamSchema.parse(req.params);
    return ok(res, await projectService.getProjectOr404(req.user, id));
  } catch (err) {
    next(err);
  }
}

export async function createProjectHandler(req, res, next) {
  try {
    const body = createProjectSchema.parse(req.body);
    return created(res, await projectService.createProject(req.user, body));
  } catch (err) {
    next(err);
  }
}

export async function updateProjectHandler(req, res, next) {
  try {
    const { id } = projectIdParamSchema.parse(req.params);
    const body = updateProjectSchema.parse(req.body);
    return ok(res, await projectService.updateProject(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function setProjectStatusHandler(req, res, next) {
  try {
    const { id } = projectIdParamSchema.parse(req.params);
    const body = setProjectStatusSchema.parse(req.body);
    return ok(res, await projectService.setProjectStatus(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listMembersHandler(req, res, next) {
  try {
    const { id } = projectIdParamSchema.parse(req.params);
    return ok(res, await projectService.listMembers(req.user, id));
  } catch (err) {
    next(err);
  }
}

export async function addMemberHandler(req, res, next) {
  try {
    const { id } = projectIdParamSchema.parse(req.params);
    const body = addMemberSchema.parse(req.body);
    return created(res, await projectService.addMember(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function updateMemberHandler(req, res, next) {
  try {
    const { id, memberId } = memberIdParamSchema.parse(req.params);
    const body = updateMemberSchema.parse(req.body);
    return ok(res, await projectService.updateMember(req.user, id, memberId, body));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export async function listMilestonesHandler(req, res, next) {
  try {
    const { id } = projectIdParamSchema.parse(req.params);
    return ok(res, await projectService.listMilestones(req.user, id));
  } catch (err) {
    next(err);
  }
}

export async function addMilestoneHandler(req, res, next) {
  try {
    const { id } = projectIdParamSchema.parse(req.params);
    const body = createMilestoneSchema.parse(req.body);
    return created(res, await projectService.addMilestone(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function updateMilestoneHandler(req, res, next) {
  try {
    const { id, milestoneId } = milestoneIdParamSchema.parse(req.params);
    const body = updateMilestoneSchema.parse(req.body);
    return ok(res, await projectService.updateMilestone(req.user, id, milestoneId, body));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Profitability
// ---------------------------------------------------------------------------

export async function getProfitabilityHandler(req, res, next) {
  try {
    const { id } = projectIdParamSchema.parse(req.params);
    return ok(res, await projectService.getProjectProfitability(req.user, id));
  } catch (err) {
    next(err);
  }
}
