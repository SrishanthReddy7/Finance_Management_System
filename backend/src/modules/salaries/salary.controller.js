// Thin HTTP layer: parse -> call the service -> wrap in the standard envelope.
// No business rules and no permission/visibility checks live here (they are
// on the routes and in the service respectively), matching every other module.

import * as salaryService from "./salary.service.js";
import { setSalaryStructureSchema, employeeIdParamSchema } from "./salary.validation.js";
import { ok, created } from "../../utils/apiResponse.js";

export async function getSalaryStructureHandler(req, res, next) {
  try {
    const { id } = employeeIdParamSchema.parse(req.params);
    return ok(res, await salaryService.getSalaryStructure(id));
  } catch (err) {
    next(err);
  }
}

export async function setSalaryStructureHandler(req, res, next) {
  try {
    const { id } = employeeIdParamSchema.parse(req.params);
    const body = setSalaryStructureSchema.parse(req.body);
    return created(res, await salaryService.setSalaryStructure(req.user, id, body));
  } catch (err) {
    next(err);
  }
}
