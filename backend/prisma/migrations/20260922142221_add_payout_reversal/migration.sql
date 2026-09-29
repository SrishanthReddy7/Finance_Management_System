-- Payout Subsystem Step 3C: PayoutReversal (Step 3A.5 design).
-- Purely additive: one new table, one unique index, one foreign key.
-- No existing table is altered. No PayoutEvent -> PayoutReversal FK, by
-- explicit design (see schema.prisma's own comment on PayoutReversal).

-- CreateTable
CREATE TABLE "PayoutReversal" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "utr" TEXT,
    "reason" TEXT,
    "providerResponse" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutReversal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutReversal_payoutId_key" ON "PayoutReversal"("payoutId");

-- AddForeignKey
ALTER TABLE "PayoutReversal" ADD CONSTRAINT "PayoutReversal_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
