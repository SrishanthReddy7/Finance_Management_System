-- Vendors & Accounts Payable (FRS Sections 16, 19, 20, 22, 29.7).
-- Purely additive: no column is dropped, no row is modified. VendorBill
-- carries zero rows at the time of this migration, which is what makes the
-- NOT NULL "createdById" safe to add without a default.

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "servicesOffered" TEXT;

-- AlterTable
ALTER TABLE "VendorBill" ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "poReference" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "VendorPayment" ADD COLUMN     "note" TEXT;

-- CreateIndex
CREATE INDEX "Vendor_status_idx" ON "Vendor"("status");

-- CreateIndex
CREATE INDEX "VendorBill_projectId_idx" ON "VendorBill"("projectId");

-- CreateIndex
CREATE INDEX "VendorBill_dueDate_idx" ON "VendorBill"("dueDate");

-- CreateIndex
CREATE INDEX "VendorPayment_paymentDate_idx" ON "VendorPayment"("paymentDate");

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

