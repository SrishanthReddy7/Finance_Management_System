// Single shared Prisma Client instance for the whole app.
// Never create `new PrismaClient()` inside a service file — always import
// this one, so we don't open a new connection pool per request.

import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

export const prisma = new PrismaClient({
  log: env.isProduction ? ["error", "warn"] : ["query", "error", "warn"],
  // Prisma's default interactive-transaction timeout is 5s. Multi-row writes
  // (e.g. processing a payroll run, one payslip per employee) make many round
  // trips inside one transaction, so a remote/slow database (Neon over the
  // internet: ~1s per query) blows past 5s and fails with "Transaction not
  // found / expired". Applies to every $transaction that doesn't set its own.
  transactionOptions: { maxWait: 10_000, timeout: 60_000 },
});

// Graceful shutdown so Neon/Postgres connections aren't left dangling
// when the process is stopped (Ctrl+C, container restart, etc.)
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
