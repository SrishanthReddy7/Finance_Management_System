import { prisma } from "../../config/db.js";

import { hashPassword } from "../../utils/hashPassword.js";

import { AppError } from "../../middleware/error.middleware.js";

import { writeAuditLog } from "../../modules/audit/audit.service.js";

import {
  assertDepartmentAssignable,
  assertDepartmentExists,
} from "../departments/department.service.js";

// FRS Section 9:
// Super Admin creates Admin or Employee;
// Admin creates Employee only, unless explicitly granted CREATE_ADMIN.

export async function createUser(actingUser, input) {
  const creatingAdmin = input.roleType === "ADMIN";

  if (creatingAdmin) {
    const allowed =
      actingUser.roleType === "SUPER_ADMIN" ||
      actingUser.permissionCodes?.includes("CREATE_ADMIN");

    if (!allowed) {
      throw new AppError(
        403,
        "You are not permitted to create Admin accounts."
      );
    }
  } else {
    const allowed =
      actingUser.roleType === "SUPER_ADMIN" ||
      actingUser.roleType === "ADMIN" ||
      actingUser.permissionCodes?.includes("CREATE_EMPLOYEE");

    if (!allowed) {
      throw new AppError(
        403,
        "You are not permitted to create user accounts."
      );
    }
  }

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existing) {
    throw new AppError(409, "A user with this email already exists.");
  }

  // Reject an unknown or retired department up front, rather than letting a
  // raw Prisma FK violation surface as a generic 400.
  await assertDepartmentAssignable(input.departmentId);

  // For MVP, accept an initial temporary password.
  // The user is still created with PENDING status.
  const passwordHash = await hashPassword(input.temporaryPassword);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      roleType: input.roleType,
      roleId: input.roleId || null,
      status: "PENDING",
      createdById: actingUser.id,

      employee: {
        create: {
          firstName: input.firstName,
          lastName: input.lastName,
          employeeCode: input.employeeCode,
          designation: input.designation,
          departmentId: input.departmentId || null,
          managerId: input.managerId || null,
          dateOfJoining: input.dateOfJoining
            ? new Date(input.dateOfJoining)
            : new Date(),
        },
      },
    },

    include: {
      employee: true,
    },
  });

  await writeAuditLog({
    entityType: "User",
    entityId: user.id,
    action: "CREATE",
    performedById: actingUser.id,
    newValue: {
      email: user.email,
      roleType: user.roleType,
      managerId: input.managerId || null,
    },
  });

  // Never return passwordHash to the client.
  const { passwordHash: _omit, ...safeUser } = user;

  return safeUser;
}

export async function setUserStatus(
  actingUser,
  targetUserId,
  status
) {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { employee: true },
  });

  if (!target) {
    throw new AppError(404, "User not found.");
  }

  const isSelf = target.id === actingUser.id;

  // FRS Section 9: a Super Admin can activate/deactivate Admins and Users; an
  // Admin can only do so for Employee/User accounts -- never a Super Admin or
  // another Admin (so HR, who holds MANAGE_USERS, cannot lock out the CEO).
  // Nobody changes their own status.
  const isSuperAdmin = actingUser.roleType === "SUPER_ADMIN";
  const isUserManager =
    actingUser.roleType === "ADMIN" && actingUser.permissionCodes?.includes("MANAGE_USERS");

  if (isSelf || !(isSuperAdmin || isUserManager)) {
    throw new AppError(403, "You are not permitted to change this account's status.");
  }
  if (!isSuperAdmin && target.roleType !== "USER") {
    throw new AppError(403, "Only a Super Admin can change the status of an Admin or Super Admin account.");
  }

  const previous = target.status;

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { status },
  });

  await writeAuditLog({
    entityType: "User",
    entityId: targetUserId,
    action: "UPDATE",
    performedById: actingUser.id,
    previousValue: { status: previous },
    newValue: { status },
  });

  // Never return passwordHash to the client.
  const { passwordHash: _omit, ...safeUser } = updated;

  return safeUser;
}

export async function listUsers(actingUser, { skip, take, departmentId }) {
  // MVP scoping:
  // Super Admin sees everyone.
  // Admin sees everyone too for now.
  //
  // Fine-grained "only my subordinates" listing can reuse
  // getAllSubordinateIds once needed for a specific screen.

  // FRS Section 31, Employee Directory: "Search/filter by dept/team".
  // An unknown id is a 400, not a silently empty page. Inactive departments
  // stay filterable -- you still need to find the people left behind in one.
  const where = {};
  if (departmentId) {
    await assertDepartmentExists(departmentId);
    where.employee = { departmentId };
  }

  const [rows, totalCount] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take,
      include: {
        employee: {
          include: { department: true },
        },
        role: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),

    prisma.user.count({ where }),
  ]);

  // Never expose passwordHash in the list API.
  const safeRows = rows.map(({ passwordHash: _omit, ...safeUser }) => {
    return safeUser;
  });

  return {
    rows: safeRows,
    totalCount,
  };
}