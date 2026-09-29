import * as employeeService from "./employee.service.js";
import { updateEmployeeSchema } from "./employee.validation.js";
import { ok } from "../../utils/apiResponse.js";

export async function getProfileHandler(req, res, next) {
  try {
    const employee = await employeeService.getEmployeeProfile(req.user, req.params.id);
    return ok(res, employee);
  } catch (err) {
    next(err);
  }
}

export async function getSubordinatesHandler(req, res, next) {
  try {
    const subordinates = await employeeService.getSubordinates(req.user, req.params.id);
    return ok(res, subordinates);
  } catch (err) {
    next(err);
  }
}

export async function updateEmployeeHandler(req, res, next) {
  try {
    const body = updateEmployeeSchema.parse(req.body);
    const employee = await employeeService.updateEmployee(req.user, req.params.id, body);
    return ok(res, employee);
  } catch (err) {
    next(err);
  }
}
