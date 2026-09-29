import * as departmentService from "./department.service.js";
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  setDepartmentStatusSchema,
  listDepartmentsQuerySchema,
} from "./department.validation.js";
import { ok, created } from "../../utils/apiResponse.js";

export async function listDepartmentsHandler(req, res, next) {
  try {
    const query = listDepartmentsQuerySchema.parse(req.query);
    const departments = await departmentService.listDepartments({
      includeInactive: query.includeInactive === "true",
    });
    return ok(res, departments);
  } catch (err) {
    next(err);
  }
}

export async function getDepartmentHandler(req, res, next) {
  try {
    const department = await departmentService.getDepartmentOr404(req.params.id);
    return ok(res, department);
  } catch (err) {
    next(err);
  }
}

export async function createDepartmentHandler(req, res, next) {
  try {
    const body = createDepartmentSchema.parse(req.body);
    const department = await departmentService.createDepartment(req.user, body);
    return created(res, department);
  } catch (err) {
    next(err);
  }
}

export async function updateDepartmentHandler(req, res, next) {
  try {
    const body = updateDepartmentSchema.parse(req.body);
    const department = await departmentService.updateDepartment(req.user, req.params.id, body);
    return ok(res, department);
  } catch (err) {
    next(err);
  }
}

export async function setDepartmentStatusHandler(req, res, next) {
  try {
    const body = setDepartmentStatusSchema.parse(req.body);
    const department = await departmentService.setDepartmentStatus(req.user, req.params.id, body.isActive);
    return ok(res, department);
  } catch (err) {
    next(err);
  }
}
