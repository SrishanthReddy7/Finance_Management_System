// Shared "don't silently sum incompatible currencies" guard.
//
// Extracted from three near-identical private copies (invoice.service.js's
// AR reports, vendorBill.service.js's AP report, budget.service.js's summary)
// into one helper, so the Reports module's new reports reuse the same check
// instead of a fourth copy. Behaviour is unchanged from those three.

/**
 * `currencyField` lets a caller whose rows key the currency under a
 * different property name (rare in this codebase, but cheaper than forcing
 * every caller to remap its rows first) override the default.
 */
export function buildCurrencyCaveats(rows, currencyField = "currency") {
  const currencies = [...new Set(rows.map((r) => r[currencyField]))];
  if (currencies.length > 1) {
    return [
      `This report mixes ${currencies.join(", ")}. The totals are a plain sum of face values and are not currency-converted.`,
    ];
  }
  return [];
}
