import * as userService from "./user.service.js";
import { createUserSchema, setStatusSchema, listUsersQuerySchema } from "./user.validation.js";
import { ok, created } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";

export async function createUserHandler(req, res, next) {
  try {
    const body = createUserSchema.parse(req.body);
    const user = await userService.createUser(req.user, body);
    return created(res, user);
  } catch (err) {
    next(err);
  }
}

export async function setStatusHandler(req, res, next) {
  try {
    const body = setStatusSchema.parse(req.body);
    const updated = await userService.setUserStatus(req.user, req.params.id, body.status);
    return ok(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function listUsersHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const { departmentId } = listUsersQuerySchema.parse(req.query);
    const { rows, totalCount } = await userService.listUsers(req.user, { skip, take, departmentId });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}
