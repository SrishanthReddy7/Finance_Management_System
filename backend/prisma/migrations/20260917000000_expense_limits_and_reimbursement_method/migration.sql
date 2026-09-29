-- FRS 11.3 "Expense limits" + FRS Section 38 Q14 (reimbursement payout method).
--
-- Purely additive and fully nullable: no existing row is rewritten, no column
-- is dropped, no data is lost. Safe to apply to the live database in place.

-- CreateEnum
CREATE TYPE "ReimbursementMethod" AS ENUM ('BANK_TRANSFER', 'PETTY_CASH');

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN     "hardLimit" DECIMAL(12,2),
ADD COLUMN     "softLimit" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Reimbursement" ADD COLUMN     "method" "ReimbursementMethod";
