import { z } from "zod";
// FRS 17.4 / FR-20 ("System shall validate GSTIN format on entry", 🟢). Shared,
// so a client GSTIN, a vendor GSTIN and the company's own registration are all
// held to one definition.
import { gstinSchema } from "../../utils/gstin.js";

// FRS 27 / the live ClientStatus enum. Not re-declared as a free string --
// an unknown status must be a 400, not a Prisma error.
export const CLIENT_STATUSES = ["ACTIVE", "INACTIVE", "PROSPECT"];

const name = z.string().trim().min(1, "Client name is required.").max(200);
const contactEmail = z.string().trim().toLowerCase().email("Must be a valid email address.").max(200);
const contactPhone = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s()]{7,20}$/, "Must be a valid phone number.");
const billingAddress = z.string().trim().min(1).max(500);
const gstin = gstinSchema;
const paymentTerms = z.string().trim().min(1).max(100);
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO currency code (e.g. INR, USD).");
const status = z.enum(CLIENT_STATUSES);

// `name` is the only field the FRS makes mandatory; everything else on the
// Client model is nullable, so nothing optional is forced here.
// .strict() so a caller that tries to PATCH `id`/`createdAt`/`updatedAt` gets a
// clear 400 instead of having it silently dropped.
export const createClientSchema = z
  .object({
    name,
    contactEmail: contactEmail.optional(),
    contactPhone: contactPhone.optional(),
    billingAddress: billingAddress.optional(),
    gstin: gstin.optional(),
    paymentTerms: paymentTerms.optional(),
    currency: currency.optional(), // schema default "INR" applies when omitted
    status: status.optional(), // schema default ACTIVE applies when omitted
  })
  .strict();

// PATCH: every field optional, but an empty body is a client mistake rather
// than a no-op -- reject it so the audit log never records a diff of {}.
// `null` is the explicit way to clear an optional field; "" is rejected.
export const updateClientSchema = z
  .object({
    name: name.optional(),
    contactEmail: contactEmail.nullable().optional(),
    contactPhone: contactPhone.nullable().optional(),
    billingAddress: billingAddress.nullable().optional(),
    gstin: gstin.nullable().optional(),
    paymentTerms: paymentTerms.nullable().optional(),
    currency: currency.optional(), // NOT nullable: the column is non-null
    status: status.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  });

// Catches a malformed :id with a 400 validation error instead of letting it
// reach Prisma, which would surface as an opaque "Database request error".
export const clientIdParamSchema = z.object({
  id: z.string().uuid("Client id must be a valid UUID."),
});

// Not .strict(): page/pageSize are handled by the shared getPagination helper
// and are stripped here, exactly as the expenses list query does.
export const listClientsQuerySchema = z.object({
  status: status.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
