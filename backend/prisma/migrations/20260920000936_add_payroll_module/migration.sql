-- Payroll Management module (FRS Section 12, 26, 27, 29.3), extended with a
-- maker-checker approval step (deliberate enhancement beyond the FRS's own
-- single-step "Finance triggers payslip generation").
-- Additive only: a new PayrollRun table, and nullable columns added to the
-- existing Payslip table. No columns are dropped, no data is deleted.
-- Payslip has 0 rows in every environment this was checked against.

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'PROCESSED', 'FINALIZED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" TEXT NOT NULL,
    "processedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollRun_periodYear_periodMonth_idx" ON "PayrollRun"("periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "PayrollRun_status_idx" ON "PayrollRun"("status");

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN "payrollRunId" TEXT;
ALTER TABLE "Payslip" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "Payslip" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "Payslip" ADD COLUMN "paymentReferenceNo" TEXT;

-- CreateIndex
CREATE INDEX "Payslip_payrollRunId_idx" ON "Payslip"("payrollRunId");

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
