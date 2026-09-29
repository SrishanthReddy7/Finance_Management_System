-- CreateEnum
CREATE TYPE "PayoutPurpose" AS ENUM ('REIMBURSEMENT', 'SALARY', 'VENDOR_PAYMENT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'QUEUED', 'PROCESSING', 'PROCESSED', 'FAILED', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutProvider" AS ENUM ('MOCK', 'RAZORPAYX');

-- CreateEnum
CREATE TYPE "PayoutAccountVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "reimbursementId" TEXT,
    "payslipId" TEXT,
    "vendorBillId" TEXT,
    "purpose" "PayoutPurpose" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED',
    "provider" "PayoutProvider" NOT NULL DEFAULT 'MOCK',
    "providerPayoutId" TEXT,
    "providerStatus" TEXT,
    "providerResponse" JSONB,
    "utr" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "failureReason" TEXT,
    "destinationAccountId" TEXT,
    "initiatedById" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePayoutAccount" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountNumberEncrypted" TEXT,
    "accountNumberLast4" TEXT,
    "ifsc" TEXT,
    "upiVpa" TEXT,
    "verificationStatus" "PayoutAccountVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "providerContactId" TEXT,
    "providerFundAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutEvent" (
    "id" TEXT NOT NULL,
    "provider" "PayoutProvider" NOT NULL DEFAULT 'MOCK',
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payout_reimbursementId_key" ON "Payout"("reimbursementId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_payslipId_key" ON "Payout"("payslipId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payout_status_idx" ON "Payout"("status");

-- CreateIndex
CREATE INDEX "Payout_purpose_idx" ON "Payout"("purpose");

-- CreateIndex
CREATE INDEX "Payout_vendorBillId_idx" ON "Payout"("vendorBillId");

-- CreateIndex
CREATE INDEX "Payout_destinationAccountId_idx" ON "Payout"("destinationAccountId");

-- CreateIndex
CREATE INDEX "Payout_initiatedById_idx" ON "Payout"("initiatedById");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_provider_providerPayoutId_key" ON "Payout"("provider", "providerPayoutId");

-- CreateIndex
CREATE INDEX "EmployeePayoutAccount_employeeId_idx" ON "EmployeePayoutAccount"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeePayoutAccount_isActive_idx" ON "EmployeePayoutAccount"("isActive");

-- CreateIndex
CREATE INDEX "PayoutEvent_eventType_idx" ON "PayoutEvent"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutEvent_provider_eventId_key" ON "PayoutEvent"("provider", "eventId");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_reimbursementId_fkey" FOREIGN KEY ("reimbursementId") REFERENCES "Reimbursement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_vendorBillId_fkey" FOREIGN KEY ("vendorBillId") REFERENCES "VendorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "EmployeePayoutAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayoutAccount" ADD CONSTRAINT "EmployeePayoutAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

