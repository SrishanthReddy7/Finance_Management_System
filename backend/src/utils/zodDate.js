// Shared strict ISO date parsing for Zod schemas.
//
// Extracted from the invoices module so AP validates dates identically to AR
// rather than carrying a second copy that can drift. Behaviour is unchanged
// from the invoice implementation.
//
// Date.parse() cannot be used on its own here. It silently ROLLS OVER an
// out-of-range day instead of rejecting it -- "2026-02-30" becomes 2026-03-02,
// "2026-04-31" becomes 2026-05-01, and a non-leap "2026-02-29" becomes
// 2026-03-01 -- in the date-only and the full-timestamp form alike. On a bill
// that silently moves a bill date or, worse, a due date, which is what every
// payable and aging calculation is measured from. (Month overflow like
// "2026-13-01" does return NaN, but relying on that for some fields and not
// others is not a rule anyone can hold in their head.)
//
// Shape is also pinned to the two forms the error message names. Date.parse
// accepts locale strings such as "March 1, 2026" and resolves them in the
// SERVER's timezone, so on an IST machine that string lands on
// 2026-02-28T18:30Z -- the previous day. A date field that shifts by a day
// depending on where the process runs is the same defect in a different
// disguise.

import { z } from "zod";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * True only when Y-M-D is a real square on the calendar. Round-tripping through
 * Date.UTC is what catches the rollover: Date.UTC(2026, 1, 30) yields March 2,
 * whose UTC day-of-month (2) no longer matches the 30 that went in.
 */
function isRealCalendarDate(year, month, day) {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

/** Returns a Date, or null if the string is not an acceptable, real date. */
export function parseIsoDate(value) {
  if (typeof value !== "string") return null;
  if (!DATE_ONLY.test(value) && !ISO_TIMESTAMP.test(value)) return null;

  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!isRealCalendarDate(year, month, day)) return null;

  // Still parsed afterwards so an impossible TIME ("2026-03-01T25:00:00Z") is
  // rejected as well, and so date-only input keeps being read as UTC midnight.
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export const isoDate = z
  .string()
  .trim()
  .refine((v) => parseIsoDate(v) !== null, {
    message:
      "Must be a real calendar date in ISO format (YYYY-MM-DD or a full ISO timestamp). " +
      "Dates such as 2026-02-30 or 2026-04-31 do not exist.",
  })
  .transform((v) => parseIsoDate(v));
