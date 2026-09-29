// The GSTIN format rule (FRS 17.4, FR-20), in one place.
//
// It was previously written out three times -- once in client.validation.js,
// once in vendor.validation.js, and once more when the GST module arrived. A
// validation rule the FRS states as a numbered requirement should have exactly
// one definition, or a later correction to it silently applies to some
// counterparties and not others.
//
// The pattern is the one FRS 17.4 spells out: 2-digit state code, 5 letters and
// 4 digits of PAN, an entity code, a literal Z, and a checksum character.

import { z } from "zod";

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const GSTIN_MESSAGE = "Must be a valid 15-character GSTIN.";

/**
 * The first two characters are the state code, which is the whole basis of the
 * FRS 14.3 CGST+SGST vs IGST decision. Returns null rather than throwing, so a
 * caller with no GSTIN to hand can treat "unknown" as its own case instead of
 * having to guess a state.
 */
export const gstinStateCode = (gstin) =>
  gstin ? String(gstin).trim().toUpperCase().slice(0, 2) : null;

/** Shared Zod field: trimmed, uppercased, format-checked. */
export const gstinSchema = z.string().trim().toUpperCase().regex(GSTIN_REGEX, GSTIN_MESSAGE);
