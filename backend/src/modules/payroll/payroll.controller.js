// Thin HTTP layer: parse -> call the service -> wrap in the standard envelope.
// No business rules and no permission/visibility checks live here (they are
// on the routes and in the service respectively), matching every other module.

import * as payrollService from "./payroll.service.js";
import {
  createPayrollRunSchema,
  payrollRunIdParamSchema,
  listPayrollRunsQuerySchema,
  runActionSchema,
  runReasonSchema,
  markPayslipPaidSchema,
  markPayslipFailedSchema,
  payslipIdParamSchema,
  employeeIdParamSchema,
  listPayslipsQuerySchema,
} from "./payroll.validation.js";
import { ok, created } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";

// ---------------------------------------------------------------------------
// Payslips (FRS 29.3, mounted under /employees and /payslips). Salary
// structure itself (GET/PUT /employees/:id/salary-structure) is owned by the
// Salaries module -- see src/modules/salaries/.
// ---------------------------------------------------------------------------

export async function listEmployeePayslipsHandler(req, res, next) {
  try {
    const { id } = employeeIdParamSchema.parse(req.params);
    const query = listPayslipsQuerySchema.parse(req.query);
    return ok(res, await payrollService.listEmployeePayslips(req.user, id, query));
  } catch (err) {
    next(err);
  }
}

export async function getPayslipHandler(req, res, next) {
  try {
    const { id } = payslipIdParamSchema.parse(req.params);
    return ok(res, await payrollService.getPayslipOr404(req.user, id));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Payroll runs (mounted under /payroll)
// ---------------------------------------------------------------------------

export async function listPayrollRunsHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const filters = listPayrollRunsQuerySchema.parse(req.query);
    const { rows, totalCount } = await payrollService.listPayrollRuns({ ...filters, skip, take });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}

export async function getPayrollRunHandler(req, res, next) {
  try {
    const { id } = payrollRunIdParamSchema.parse(req.params);
    return ok(res, await payrollService.getPayrollRunOr404(id));
  } catch (err) {
    next(err);
  }
}

export async function createPayrollRunHandler(req, res, next) {
  try {
    const body = createPayrollRunSchema.parse(req.body);
    return created(res, await payrollService.createPayrollRun(req.user, body));
  } catch (err) {
    next(err);
  }
}

export async function processPayrollRunHandler(req, res, next) {
  try {
    const { id } = payrollRunIdParamSchema.parse(req.params);
    return ok(res, await payrollService.processPayrollRun(req.user, id));
  } catch (err) {
    next(err);
  }
}

export async function finalizePayrollRunHandler(req, res, next) {
  try {
    const { id } = payrollRunIdParamSchema.parse(req.params);
    const body = runActionSchema.parse(req.body ?? {});
    return ok(res, await payrollService.finalizePayrollRun(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function rejectPayrollRunHandler(req, res, next) {
  try {
    const { id } = payrollRunIdParamSchema.parse(req.params);
    const body = runReasonSchema.parse(req.body);
    return ok(res, await payrollService.rejectPayrollRun(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function cancelPayrollRunHandler(req, res, next) {
  try {
    const { id } = payrollRunIdParamSchema.parse(req.params);
    const body = runReasonSchema.parse(req.body);
    return ok(res, await payrollService.cancelPayrollRun(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Payslip payments
// ---------------------------------------------------------------------------

export async function markPayslipPaidHandler(req, res, next) {
  try {
    const { id: runId, payslipId } = req.params;
    payrollRunIdParamSchema.parse({ id: runId });
    payslipIdParamSchema.parse({ id: payslipId });
    const body = markPayslipPaidSchema.parse(req.body);
    return ok(res, await payrollService.markPayslipPaid(req.user, runId, payslipId, body));
  } catch (err) {
    next(err);
  }
}

export async function markPayslipFailedHandler(req, res, next) {
  try {
    const { id: runId, payslipId } = req.params;
    payrollRunIdParamSchema.parse({ id: runId });
    payslipIdParamSchema.parse({ id: payslipId });
    const body = markPayslipFailedSchema.parse(req.body);
    return ok(res, await payrollService.markPayslipFailed(req.user, runId, payslipId, body));
  } catch (err) {
    next(err);
  }
}
