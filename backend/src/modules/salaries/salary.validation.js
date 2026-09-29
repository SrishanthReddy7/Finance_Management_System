// Zod layer for Salary Structures (FRS Section 12.1, 26, 29.3).
//
// .strict() throughout: an unknown key is a clean 400. There is no field
// anywhere in this file for grossEarnings/totalDeductions/netSalary -- Section
// 26 rule 10 makes those computed server-side from the components, never
// accepted from a client.
//
// Moved here from payroll.validation.js, where this schema was originally
// built (before this module existed) -- unchanged, since the Payroll module
// never needed anything payroll-specific from it.

import { z } from "zod";
import { isoDate } from "../../utils/zodDate.js";
import { nonNegativeMoney } from "../../utils/zodMoney.js";

export const SALARY_COMPONENT_TYPES = ["EARNING", "DEDUCTION"];

const uuid = (label) => z.string().uuid(`${label} must be a valid UUID.`);

// A structure with no EARNING line has no gross pay, which makes every
// downstream payroll figure meaningless -- caught here rather than surfacing
// as a silent zero-salary payslip later.
const componentSchema = z
  .object({
    label: z.string().trim().min(1, "Component label is required.").max(100),
    type: z.enum(SALARY_COMPONENT_TYPES),
    amount: nonNegativeMoney("Component amount"),
  })
  .strict();

export const setSalaryStructureSchema = z
  .object({
    // Defaults to today in the service if omitted -- most structures take
    // effect immediately; a future-dated revision is the exception.
    effectiveFrom: isoDate.optional(),
    components: z
      .array(componentSchema)
      .min(1, "A salary structure needs at least one component.")
      .max(50, "A salary structure cannot have more than 50 components."),
  })
  .strict()
  .refine((body) => body.components.some((c) => c.type === "EARNING"), {
    message: "A salary structure needs at least one EARNING component to produce a nonzero gross salary.",
    path: ["components"],
  });

export const employeeIdParamSchema = z.object({ id: uuid("Employee id") });
