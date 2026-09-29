// Filing-period resolution, shared by the three writers of GstTransaction rows:
// invoices (OUTPUT tax, at send), vendor bills (INPUT tax, at approve) and the
// GST module itself (manual adjustment entries).
//
// It lives in utils rather than in modules/gst so the invoice and vendor-bill
// services can import it without an import cycle -- gst.service.js imports from
// both of those, not the other way round.

import { prisma } from "../config/db.js";

/**
 * FRS Section 26 rule 8: "GST records become read-only once their tax period is
 * marked Filed." Acknowledged is strictly later than Filed, so it locks too.
 */
export const LOCKED_PERIOD_STATUSES = ["FILED", "ACKNOWLEDGED"];

export const isPeriodLocked = (period) =>
  Boolean(period) && LOCKED_PERIOD_STATUSES.includes(period.status);

/** "2026-08" -- the form FRS Section 28 uses when it names a filing cycle. */
export const formatPeriodLabel = ({ periodYear, periodMonth }) =>
  `${periodYear}-${String(periodMonth).padStart(2, "0")}`;

/**
 * FRS 17.4 "tax period (month/year)". Always read in UTC: the dates that feed
 * this come from utils/zodDate, which parses a date-only string as UTC
 * midnight, so reading it back in the server's local zone would move a
 * 1st-of-the-month document into the previous period on any machine behind UTC.
 */
export function periodKeyOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  return { periodMonth: d.getUTCMonth() + 1, periodYear: d.getUTCFullYear() };
}

const nextMonth = ({ periodMonth, periodYear }) =>
  periodMonth === 12
    ? { periodMonth: 1, periodYear: periodYear + 1 }
    : { periodMonth: periodMonth + 1, periodYear };

/** How far forward the roll-forward search will walk before giving up. */
const MAX_ROLL_FORWARD_MONTHS = 120;

/**
 * Returns the GstFilingPeriod a transaction dated `documentDate` belongs in,
 * creating it if this is the first activity in that month.
 *
 * The natural period is simply the document's own month. If that period has
 * already been Filed, rule 8 forbids adding to it -- but dropping the row, or
 * leaving it with no period, would silently lose tax the company genuinely owes
 * or genuinely can claim. So the row is posted into the next period that is
 * still open, which is what a late entry does on the real portal too, and the
 * caller is told via `rolledForward` so it can warn.
 *
 * `documentDate` is still stored on the row itself, so a period containing a
 * rolled-forward entry can always explain where it came from.
 *
 * Uses upsert rather than findUnique-then-create because two invoices sent in
 * the same second would otherwise race on the [periodMonth, periodYear] unique
 * constraint and abort one of the two transactions.
 */
export async function resolveFilingPeriod(documentDate, client = prisma) {
  const naturalKey = periodKeyOf(documentDate);
  let key = naturalKey;

  for (let hops = 0; hops < MAX_ROLL_FORWARD_MONTHS; hops += 1) {
    const period = await client.gstFilingPeriod.upsert({
      where: { periodMonth_periodYear: key },
      update: {},
      create: { periodMonth: key.periodMonth, periodYear: key.periodYear },
    });

    if (!isPeriodLocked(period)) {
      return {
        period,
        naturalPeriod: naturalKey,
        rolledForward: hops > 0,
        naturalPeriodLabel: formatPeriodLabel(naturalKey),
      };
    }
    key = nextMonth(key);
  }

  // Unreachable in practice: it would take ten consecutive years of filed
  // periods with no open month. Failing loudly beats returning a locked period.
  throw new Error(
    `No open GST filing period found within ${MAX_ROLL_FORWARD_MONTHS} months of ` +
      `${formatPeriodLabel(naturalKey)}.`
  );
}
