// Organizational hierarchy + salary visibility logic (FRS Section 7 & 8).
// This is the ONLY place this logic should live. Every module that needs
// "can this user see that employee's salary / expenses / data" imports
// these two functions rather than re-implementing the check.

import { prisma } from "../config/db.js";

/**
 * Returns the full set of employee IDs reachable downward from a given
 * employee, by recursively following the managerId chain.
 * Implemented as a recursive SQL CTE for performance (one query, not N).
 */
export async function getAllSubordinateIds(employeeId) {
  const rows = await prisma.$queryRaw`
    WITH RECURSIVE subordinates AS (
      SELECT id FROM "Employee" WHERE "managerId" = ${employeeId}
      UNION ALL
      SELECT e.id FROM "Employee" e
      INNER JOIN subordinates s ON e."managerId" = s.id
    )
    SELECT id FROM subordinates;
  `;
  return rows.map((r) => r.id);
}

/**
 * FRS Section 8.1 matrix, enforced server-side:
 *   - anyone can view their own salary
 *   - SUPER_ADMIN can view everyone's, EXCEPT another Super Admin's
 *     (Section 0.1 Q9, client-answered: "everyone except other Super
 *     Admins", not "everyone")
 *   - a Manager can view their full downward chain; a Team Lead is scoped to
 *     direct reports only (Section 0.1 Q5, client-answered)
 *   - HR/Finance can be granted an explicit override permission
 *     (VIEW_COMPANY_SALARY) checked separately by the caller — this
 *     function only encodes the hierarchy part.
 *
 * The Q5/Q9 narrowing was flagged in the FRS itself as "real deltas from
 * Section 8.1's matrix ... canViewSalary() should be updated to match once
 * salary endpoints are built" (Section 0.2) — this is that update, now that
 * the Salaries module exists.
 */
export async function canViewSalary(requestingUser, targetEmployeeId) {
  if (requestingUser.employee?.id === targetEmployeeId) return true;

  if (requestingUser.roleType === "SUPER_ADMIN") {
    const targetIsSuperAdmin = await isEmployeeSuperAdmin(targetEmployeeId);
    return !targetIsSuperAdmin;
  }

  if (!requestingUser.employee) return false;

  // Q5: reused from the expense-review scoping rather than re-implemented --
  // both are the same "Team Lead = direct reports only, Manager = full
  // downward chain" hierarchy rule, just applied to different data.
  const reviewableIds = await getReviewableEmployeeIds(requestingUser);
  return reviewableIds.includes(targetEmployeeId);
}

/** Q9's carve-out needs the TARGET's role, which canViewSalary is not otherwise given. */
async function isEmployeeSuperAdmin(employeeId) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { user: { select: { roleType: true } } },
  });
  return employee?.user?.roleType === "SUPER_ADMIN";
}

/**
 * Batch form of isEmployeeSuperAdmin's check, for filtering a list of
 * employees (e.g. a project's team) rather than testing one target id.
 * Exported for callers that redact salary data across several employees at
 * once (Projects' per-employee labour-cost breakdown) and need the same Q9
 * carve-out canViewSalary applies one id at a time.
 */
export async function getSuperAdminEmployeeIds(employeeIds) {
  if (employeeIds.length === 0) return [];
  const rows = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, user: { roleType: "SUPER_ADMIN" } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Same hierarchy shape, reused for expense-approval routing:
 * "is this employee a direct report (or deeper) of the requesting manager?"
 */
export async function isManagerOf(requestingEmployeeId, targetEmployeeId) {
  const subordinateIds = await getAllSubordinateIds(requestingEmployeeId);
  return subordinateIds.includes(targetEmployeeId);
}

/** Depth-1 only: the people who report *directly* to this employee. */
export async function getDirectReportIds(employeeId) {
  const rows = await prisma.employee.findMany({
    where: { managerId: employeeId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// FRS Section 0.1, Q5 (client-answered, therefore confirmed): a Team Lead
// covers "only their team (direct reports)", while a Manager keeps the full
// downward chain (Q6). That is a depth-1 rule for one specific role, so the
// role name is the only thing that distinguishes the two cases -- there is no
// separate permission code for it in Section 30's seed list.
const DEPTH_LIMITED_ROLE_NAMES = new Set(["Team Lead"]);

export function isDepthLimitedReviewer(requestingUser) {
  return DEPTH_LIMITED_ROLE_NAMES.has(requestingUser.role?.name);
}

/**
 * The set of employees whose claims this user may see/act on *through the
 * hierarchy* (Section 30, layer 3). Team Leads get direct reports only;
 * everyone else gets the full recursive chain.
 *
 * Returns [] for a user with no employee profile -- a permission alone never
 * grants hierarchy scope.
 */
export async function getReviewableEmployeeIds(requestingUser) {
  if (!requestingUser.employee) return [];
  return isDepthLimitedReviewer(requestingUser)
    ? getDirectReportIds(requestingUser.employee.id)
    : getAllSubordinateIds(requestingUser.employee.id);
}

/** "May this user review/act on a claim belonging to that employee?" */
export async function canReviewExpenseOf(requestingUser, targetEmployeeId) {
  const ids = await getReviewableEmployeeIds(requestingUser);
  return ids.includes(targetEmployeeId);
}
