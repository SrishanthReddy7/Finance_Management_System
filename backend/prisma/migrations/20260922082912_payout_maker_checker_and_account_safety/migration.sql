-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PayoutStatus" ADD VALUE 'AWAITING_APPROVAL';
ALTER TYPE "PayoutStatus" ADD VALUE 'APPROVED';
ALTER TYPE "PayoutStatus" ADD VALUE 'REJECTED';

-- DropForeignKey
ALTER TABLE "Payout" DROP CONSTRAINT "Payout_initiatedById_fkey";

-- DropIndex
DROP INDEX "Payout_initiatedById_idx";

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayoutAccount_providerFundAccountId_key" ON "EmployeePayoutAccount"("providerFundAccountId");

-- CreatePartialIndex
-- Hand-added (not representable in schema.prisma's DSL -- Prisma has no
-- syntax for a filtered/partial unique index). Enforces "at most one active
-- payout account per employee" at the database level: a second concurrent
-- attempt to activate an account for an employee who already has one active
-- fails this constraint instead of silently leaving two rows isActive=true.
-- See the EmployeePayoutAccount.isActive comment in schema.prisma for the
-- full reasoning and the service-layer locking requirement this does not
-- replace.
CREATE UNIQUE INDEX "EmployeePayoutAccount_employeeId_active_key" ON "EmployeePayoutAccount"("employeeId") WHERE "isActive" = true;

