import { z } from "zod";

// FRS Section 29.9 "GET /audit-logs -- filterable audit trail", narrowed by
// Section 31 to "filterable by entity/user/date". Nothing beyond that.
export const listAuditLogsQuerySchema = z.object({
  entityType: z.string().min(1).max(50).optional(),
  entityId: z.string().uuid().optional(),
  performedById: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
