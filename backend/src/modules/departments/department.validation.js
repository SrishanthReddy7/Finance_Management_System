import { z } from "zod";

export const createDepartmentSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20).optional(),
  description: z.string().max(500).optional(),
});

// Every field optional (it's a PATCH), but an empty body is a client mistake,
// not a no-op update -- reject it so the audit log never records a diff of {}.
export const updateDepartmentSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    code: z.string().min(1).max(20).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  });

// FRS Section 26 rule 6 / FR-18: no hard deletes. A department is retired by
// flipping isActive, never by DELETE -- Budget rows keep pointing at it.
export const setDepartmentStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listDepartmentsQuerySchema = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
});
