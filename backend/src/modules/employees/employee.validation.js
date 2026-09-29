import { z } from "zod";

// FRS 29.2: PATCH /employees/:id -- "Update profile/manager/department".
// departmentId and managerId are explicitly nullable: clearing a department
// (or detaching the top of the chain) is a legitimate operation, and must be
// distinguishable from "field not supplied".
export const updateEmployeeSchema = z
  .object({
    firstName: z.string().min(1).max(60).optional(),
    lastName: z.string().min(1).max(60).optional(),
    designation: z.string().min(1).max(100).optional(),
    phone: z.string().min(1).max(20).nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    managerId: z.string().uuid().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  });
