// Zod layer for Vendor master data (FRS Sections 16.1, 29.7, 31 "Vendors").
//
// Schemas are .strict() so an unknown key -- or an attempt to PATCH a
// system-managed column like `id`/`createdAt` -- is a clean 400 rather than
// being silently dropped, matching clients/projects/invoices.

import { z } from "zod";
// FRS 17.4 / FR-20. A vendor GSTIN is the same artefact as a client GSTIN, and
// its first two digits are the state code that decides CGST+SGST vs IGST on
// this vendor's bills -- so both go through one shared definition.
import { gstinSchema } from "../../utils/gstin.js";
import { currency } from "../../utils/zodMoney.js";


// FRS 27: "Client / Vendor | Active, Inactive, Prospect (client only)" -- so a
// vendor has exactly two, which is what the live VendorStatus enum says.
export const VENDOR_STATUSES = ["ACTIVE", "INACTIVE"];

// FRS 16.1's 🟢 client-provided vendor types, normalised to the stable
// identifiers the ?category filter matches on.
//
// Deliberately NOT a z.enum: Section 38 Q30 asks the client to "confirm/extend"
// this list, so an unrecognised category is accepted and reported as a warning
// instead of rejected. Hard-coding it would mean a code change the first time
// they hire a vendor type nobody thought of, which is the same reasoning
// Section 11.2 gives for keeping expense categories out of an enum.
export const KNOWN_VENDOR_CATEGORIES = [
  "CLOUD_PROVIDER",
  "SOFTWARE_SUBSCRIPTION",
  "ISP",
  "CONSULTANT",
  "FREELANCER",
  "OFFICE_SERVICES",
  "RECRUITMENT",
];

/**
 * "Cloud Provider", "cloud-provider" and "CLOUD_PROVIDER" are the same category
 * typed three ways. Normalising on the way in is what makes ?category= a
 * reliable filter instead of a guess about how the last person capitalised it.
 */
const category = z
  .string()
  .trim()
  .min(1, "Vendor category is required.")
  .max(100)
  .transform((v) => v.toUpperCase().replace(/[\s-]+/g, "_"));

const name = z.string().trim().min(1, "Vendor name is required.").max(200);
const contactEmail = z.string().trim().toLowerCase().email("Must be a valid email address.").max(200);
const contactPhone = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s()]{7,20}$/, "Must be a valid phone number.");
const billingAddress = z.string().trim().min(1).max(500);
const gstin = gstinSchema;
const servicesOffered = z.string().trim().min(1).max(1000);
const paymentTerms = z.string().trim().min(1).max(100);
// FRS 16.1 "bank/payment information". Free text because the FRS never
// specifies its shape; redacted from responses for callers who cannot pay
// vendors (see vendor.service.redactVendor).
const bankDetails = z.string().trim().min(1).max(500);
const status = z.enum(VENDOR_STATUSES);

// `name` and `category` are the two columns the schema makes non-null, so they
// are the only required fields -- nothing optional is forced here, exactly as
// the clients module does it.
export const createVendorSchema = z
  .object({
    name,
    category,
    contactEmail: contactEmail.optional(),
    contactPhone: contactPhone.optional(),
    billingAddress: billingAddress.optional(),
    gstin: gstin.optional(),
    servicesOffered: servicesOffered.optional(),
    paymentTerms: paymentTerms.optional(),
    currency: currency.optional(), // schema default "INR" applies when omitted
    bankDetails: bankDetails.optional(),
    status: status.optional(), // schema default ACTIVE applies when omitted
  })
  .strict();

// PATCH: every field optional, but an empty body is a caller mistake rather
// than a no-op -- reject it so the audit log never records a diff of {}.
// `null` is the explicit way to clear an optional field; "" is rejected.
//
// There is no DELETE endpoint (FRS Section 26 rule 6 / FR-18): a vendor is
// retired by PATCHing status to INACTIVE, because VendorBill rows keep
// pointing at it.
export const updateVendorSchema = z
  .object({
    name: name.optional(),
    category: category.optional(),
    contactEmail: contactEmail.nullable().optional(),
    contactPhone: contactPhone.nullable().optional(),
    billingAddress: billingAddress.nullable().optional(),
    gstin: gstin.nullable().optional(),
    servicesOffered: servicesOffered.nullable().optional(),
    paymentTerms: paymentTerms.nullable().optional(),
    currency: currency.optional(), // NOT nullable: the column is non-null
    bankDetails: bankDetails.nullable().optional(),
    status: status.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  });

// Catches a malformed :id with a 400 instead of letting it reach Prisma, which
// would surface as an opaque "Database request error".
export const vendorIdParamSchema = z.object({
  id: z.string().uuid("Vendor id must be a valid UUID."),
});

// Not .strict(): page/pageSize are consumed by the shared getPagination helper,
// exactly as the clients/projects/invoices list queries do.
export const listVendorsQuerySchema = z.object({
  status: status.optional(),
  category: category.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
