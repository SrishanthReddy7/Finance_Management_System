// Departments (FRS Section 7.1, 29.2, 31 "Org/Teams").
//
// A department is a first-class entity, NOT something inferred from the
// manager chain -- per Section 7.1 it is named and budgeted independently of
// who reports to whom. It is also the scope key for DEPARTMENT-level budgets
// (Section 19 / FR-14), which is why a department is never hard-deleted.

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog } from "../audit/audit.service.js";

const EMPLOYEE_COUNT = { select: { employees: true, budgets: true } };

export async function listDepartments({ includeInactive = false } = {}) {
  return prisma.department.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: "asc" },
    include: { _count: EMPLOYEE_COUNT },
  });
}

export async function getDepartmentOr404(departmentId) {
  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    include: { _count: EMPLOYEE_COUNT },
  });
  if (!department) throw new AppError(404, "Department not found.");
  return department;
}

/**
 * Guard used by any module that writes an Employee.departmentId
 * (users.createUser, employees.updateEmployee).
 *
 * Without this, Prisma surfaces a raw foreign-key violation for an unknown id,
 * and -- worse -- an employee could be assigned to a department that was
 * already retired, which would quietly defeat setDepartmentStatus() below.
 */
export async function assertDepartmentAssignable(departmentId) {
  if (!departmentId) return null;

  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) throw new AppError(400, "The specified department does not exist.");
  if (!department.isActive) {
    throw new AppError(400, `Department "${department.name}" is inactive and cannot be assigned.`);
  }
  return department;
}

/** Existence-only check, for filtering (an inactive department is still a valid filter). */
export async function assertDepartmentExists(departmentId) {
  if (!departmentId) return null;

  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) throw new AppError(400, "The specified department does not exist.");
  return department;
}

export async function createDepartment(actingUser, input) {
  const clash = await prisma.department.findFirst({
    where: { OR: [{ name: input.name }, ...(input.code ? [{ code: input.code }] : [])] },
  });
  if (clash) {
    throw new AppError(409, clash.name === input.name ? "A department with this name already exists." : "A department with this code already exists.");
  }

  const department = await prisma.department.create({
    data: {
      name: input.name,
      code: input.code ?? null,
      description: input.description ?? null,
    },
  });

  await writeAuditLog({
    entityType: "Department",
    entityId: department.id,
    action: "CREATE",
    performedById: actingUser.id,
    newValue: { name: department.name, code: department.code },
  });

  return department;
}

export async function updateDepartment(actingUser, departmentId, input) {
  const existing = await getDepartmentOr404(departmentId);

  if (input.name && input.name !== existing.name) {
    const clash = await prisma.department.findUnique({ where: { name: input.name } });
    if (clash) throw new AppError(409, "A department with this name already exists.");
  }
  if (input.code && input.code !== existing.code) {
    const clash = await prisma.department.findFirst({ where: { code: input.code } });
    if (clash) throw new AppError(409, "A department with this code already exists.");
  }

  const updated = await prisma.department.update({ where: { id: departmentId }, data: input });

  // Section 24: snapshot only the fields that actually changed, not the whole row.
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
      entityType: "Department",
      entityId: departmentId,
      action: "UPDATE",
      performedById: actingUser.id,
      previousValue,
      newValue,
    });
  }

  return updated;
}

/**
 * Retire/restore a department instead of deleting it (Section 26 rule 6).
 *
 * Retiring one that still has employees assigned would leave those employees
 * pointing at a department nobody can select any more, and would silently skew
 * any future DEPARTMENT-scoped budget rollup -- so it is blocked until they are
 * moved via PATCH /employees/:id.
 */
export async function setDepartmentStatus(actingUser, departmentId, isActive) {
  const existing = await getDepartmentOr404(departmentId);

  if (existing.isActive === isActive) {
    return existing;
  }

  if (!isActive) {
    const assigned = await prisma.employee.count({
      where: { departmentId, status: "ACTIVE" },
    });
    if (assigned > 0) {
      throw new AppError(
        409,
        `Cannot deactivate: ${assigned} active employee(s) are still assigned to this department. Reassign them first.`
      );
    }
  }

  const updated = await prisma.department.update({
    where: { id: departmentId },
    data: { isActive },
  });

  await writeAuditLog({
    entityType: "Department",
    entityId: departmentId,
    action: isActive ? "UPDATE" : "ARCHIVE",
    performedById: actingUser.id,
    previousValue: { isActive: existing.isActive },
    newValue: { isActive },
  });

  return updated;
}
