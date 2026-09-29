// FRS 14.2: "Sent/Partially Paid -> Overdue | System (auto, scheduled job)".
//
// Runs the existing syncOverdueInvoices() on a timer so nobody has to call
// POST /invoices/sync-overdue by hand. The sweep is idempotent (it only picks
// up SENT/PARTIALLY_PAID invoices whose due date has passed), so running it
// more often than strictly needed is harmless.
//
// AuditLog.performedById is a non-null FK to User, so each transition needs a
// real actor. The oldest ACTIVE Super Admin is used; the audit note on each
// change says it was the automatic sweep, not that person acting by hand.

import { prisma } from "../config/db.js";
import { syncOverdueInvoices } from "../modules/invoice/invoice.service.js";

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const STARTUP_DELAY_MS = 15 * 1000; // let the server/DB settle before the first run

let isRunning = false;

async function findSweepActor() {
  return prisma.user.findFirst({
    where: { roleType: "SUPER_ADMIN", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}

export async function runOverdueSweep() {
  if (isRunning) return null; // never overlap two sweeps in this process
  isRunning = true;
  try {
    const actor = await findSweepActor();
    if (!actor) {
      // eslint-disable-next-line no-console
      console.warn("[overdue-sweep] skipped: no ACTIVE Super Admin to attribute the changes to.");
      return null;
    }
    const result = await syncOverdueInvoices(actor);
    if (result.markedOverdue > 0) {
      // eslint-disable-next-line no-console
      console.log(`[overdue-sweep] marked ${result.markedOverdue} invoice(s) overdue.`);
    }
    return result;
  } catch (err) {
    // A failed sweep (e.g. DB briefly unreachable) must never crash the API;
    // the next tick simply tries again.
    // eslint-disable-next-line no-console
    console.error("[overdue-sweep] failed:", err?.message || err);
    return null;
  } finally {
    isRunning = false;
  }
}

export function startOverdueSweep() {
  // .unref() so these timers alone never keep the process alive on shutdown.
  setTimeout(runOverdueSweep, STARTUP_DELAY_MS).unref();
  setInterval(runOverdueSweep, SWEEP_INTERVAL_MS).unref();
}
