// Vendor-bill status groupings that other modules need.
//
// A separate file, not an export from vendorBill.service.js, purely to avoid an
// import cycle: vendorBill.service imports assertProjectAssignable from
// project.service, and project.service needs these lists for the Section 13.4
// cost side. Constants with no dependencies can be imported by both.

/**
 * FRS 19 / Section 26 rule 10: "actual spend" is computed, never entered. A
 * vendor bill becomes actual spend once it has been APPROVED -- that is the
 * point the company has accepted the liability, whether or not the money has
 * left yet. Anything earlier is a commitment, and a DRAFT is not even that.
 */
export const ACTUAL_BILL_STATUSES = ["APPROVED", "PARTIALLY_PAID", "PAID"];

/** In the workflow but not yet approved: a commitment, reported separately. */
export const PENDING_BILL_STATUSES = ["PENDING_VERIFICATION", "VERIFIED", "PENDING_APPROVAL"];
