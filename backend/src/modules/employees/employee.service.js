import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { getAllSubordinateIds } from "../../utils/hierarchy.js";
import { assertDepartmentAssignable } from "../departments/department.service.js";
import { writeAuditLog } from "../audit/audit.service.js";

export async function getEmployeeProfile(actingUser, employeeId) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { department: true, manager: true, user: { select: { email: true, status: true, roleType: true } } },
  });
  if (!employee) throw new AppError(404, "Employee not found.");

  const isSelf = actingUser.employee?.id === employeeId;
  if (!isSelf && actingUser.roleType !== "SUPER_ADMIN") {
    const canSeeDirectory = actingUser.permissionCodes?.includes("VIEW_EMPLOYEE");
    if (!canSeeDirectory) throw new AppError(403, "You are not permitted to view this profile.");
  }
  return employee;
}

export async function getSubordinates(actingUser, employeeId) {
  const isSelf = actingUser.employee?.id === employeeId;
  if (!isSelf && actingUser.roleType !== "SUPER_ADMIN") {
    throw new AppError(403, "You can only view your own subordinate list.");
  }
  const ids = await getAllSubordinateIds(employeeId);
  if (ids.length === 0) return [];

  return prisma.employee.findMany({
    where: { id: { in: ids } },
    include: { department: true, user: { select: { email: true, status: true } } },
  });
}

/**
 * FRS 29.2: PATCH /employees/:id -- update profile / manager / department.
 * Route-gated by MANAGE_USERS (Super Admin + HR Admin per Section 31).
 */
export async function updateEmployee(actingUser, employeeId, input) {
  const existing = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!existing) throw new AppError(404, "Employee not found.");

  if (input.departmentId) {
    await assertDepartmentAssignable(input.departmentId);
  }

  if (input.managerId) {
    if (input.managerId === employeeId) {
      throw new AppError(400, "An employee cannot be their own manager.");
    }

    const manager = await prisma.employee.findUnique({ where: { id: input.managerId } });
    if (!manager) throw new AppError(400, "The specified manager does not exist.");

    // Section 7.1 is an adjacency list walked by a recursive CTE. Pointing an
    // employee at one of their own subordinates closes the loop, and
    // getAllSubordinateIds() would then recurse until Postgres gives up.
    const subordinateIds = await getAllSubordinateIds(employeeId);
    if (subordinateIds.includes(input.managerId)) {
      throw new AppError(400, "That manager reports (directly or indirectly) to this employee -- the reporting chain would form a cycle.");
    }
  }

  const updated = await prisma.employee.update({
    where: { id: employeeId },
    data: input,
    include: { department: true, manager: true },
  });

  // Section 24: snapshot only the fields that actually changed.
  const previousValue = {};
  const newValue = {};
  for (const field of Object.keys(input)) {
    if (existing[field] !== updated[field]) {
      previousValue[field] = existing[field];
      newValue[field] = updated[field];
    }
  }

  if (Object.keys(newValue).length > 0) {
    await writeAuditLog({
      entityType: "Employee",
      entityId: employeeId,
      action: "UPDATE",
      performedById: actingUser.id,
      previousValue,
      newValue,
    });
  }

  return updated;
}
