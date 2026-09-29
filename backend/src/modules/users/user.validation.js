import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email(),
  temporaryPassword: z.string().min(8),

  roleType: z.enum(["ADMIN", "USER"]),
  roleId: z.string().uuid().optional(),

  firstName: z.string().min(1),
  lastName: z.string().min(1),
  employeeCode: z.string().min(1),
  designation: z.string().min(1),

  departmentId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  dateOfJoining: z.string().datetime().optional(),
});

export const setStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

// FRS Section 31, Employee Directory: filter by department.
// Pagination params are handled separately by getPagination().
export const listUsersQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
});
