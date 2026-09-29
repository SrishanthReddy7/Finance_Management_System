// Shared GST treatment and CGST/SGST/IGST split (FRS 14.3, 17.4, FR-12).
//
// Extracted from the invoices module so INPUT tax (vendor bills) and OUTPUT tax
// (client invoices) are split by the same code. These two have to agree: the
// GST summary nets one against the other, and a rounding or place-of-supply
// rule that applied to only one side would quietly misstate the liability.
//
// Behaviour is unchanged from the invoice implementation.

import { env } from "../config/env.js";
import { gstinStateCode as GSTIN_STATE_CODE } from "./gstin.js";

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * FRS 14.3: CGST+SGST when the counterparty is in the company's own state, IGST
 * when they are not. The company's state comes from the first two digits of
 * COMPANY_GSTIN (Section 31 "Settings ... GST registration details").
 *
 * The client has not supplied that GSTIN yet, so this deliberately does NOT
 * guess. When either side's GSTIN is missing it returns `applicable: false` and
 * the caller raises a warning instead -- a bill or invoice still gets its
 * correct total, it just carries no CGST/SGST/IGST breakdown until the
 * registration is configured. Defaulting to intra-state would silently produce
 * wrong returns for every out-of-state counterparty.
 *
 * `missingReason` is the counterparty-specific code the caller reports when the
 * other side has no GSTIN -- "CLIENT_GSTIN_MISSING" or "VENDOR_GSTIN_MISSING".
 */
export function resolveGstTreatment(counterpartyGstin, missingReason = "COUNTERPARTY_GSTIN_MISSING") {
  const companyState = GSTIN_STATE_CODE(env.companyGstin);
  if (!companyState) {
    return { applicable: false, reason: "COMPANY_GSTIN_NOT_CONFIGURED" };
  }
  const counterpartyState = GSTIN_STATE_CODE(counterpartyGstin);
  if (!counterpartyState) {
    return { applicable: false, reason: missingReason, companyState };
  }
  return {
    applicable: true,
    interState: counterpartyState !== companyState,
    companyState,
    counterpartyState,
  };
}

/**
 * Groups priced line items by GST rate and splits each group's tax. One
 * GstTransaction per distinct rate, which is the granularity GSTR-1 and GSTR-3B
 * report at -- not one per line, which would multiply rows for no analytical
 * gain.
 *
 * Each item must carry `taxRate`, `lineTotal` (the taxable value) and
 * `taxAmount`.
 *
 * A half-paise remainder on an odd CGST/SGST split is pushed onto CGST so the
 * two halves always re-add to exactly the tax charged.
 */
export function buildGstTransactions(pricedItems, treatment) {
  if (!treatment.applicable) return [];

  const byRate = new Map();
  for (const item of pricedItems) {
    if (item.taxRate <= 0 || item.taxAmount <= 0) continue;
    const existing = byRate.get(item.taxRate) || { taxableAmount: 0, taxAmount: 0 };
    existing.taxableAmount = round2(existing.taxableAmount + item.lineTotal);
    existing.taxAmount = round2(existing.taxAmount + item.taxAmount);
    byRate.set(item.taxRate, existing);
  }

  return [...byRate.entries()].map(([gstRate, group]) => {
    if (treatment.interState) {
      return {
        gstRate,
        taxableAmount: group.taxableAmount,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: group.taxAmount,
      };
    }
    const half = round2(group.taxAmount / 2);
    return {
      gstRate,
      taxableAmount: group.taxableAmount,
      cgstAmount: round2(group.taxAmount - half),
      sgstAmount: half,
      igstAmount: 0,
    };
  });
}
