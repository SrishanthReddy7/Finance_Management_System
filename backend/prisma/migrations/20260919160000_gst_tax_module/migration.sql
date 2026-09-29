-- GST & Tax Management module (FRS Section 17).
--
-- PURELY ADDITIVE. No DROP, no DELETE, no TRUNCATE, no column retyped, no
-- existing value overwritten. The only UPDATE statements below backfill a
-- column that this migration itself creates, so they cannot alter data that
-- existed before it ran.
--
-- Written by hand rather than generated, because `prisma migrate diff` emits
-- `ADD COLUMN "documentDate" TIMESTAMP(3) NOT NULL` in one statement, which
-- fails outright against the 18 GstTransaction rows already in this database
-- (16 from invoices, 2 from vendor bills, 0 manual). The add/backfill/constrain
-- split below is the non-destructive equivalent.

-- 1. New GstTransaction columns, all nullable to begin with.
ALTER TABLE "GstTransaction" ADD COLUMN "documentDate" TIMESTAMP(3);
ALTER TABLE "GstTransaction" ADD COLUMN "createdById" TEXT;
ALTER TABLE "GstTransaction" ADD COLUMN "note" TEXT;

-- 2. Backfill documentDate from the tax point of the source document: the
--    invoice date for OUTPUT rows, the bill date for INPUT rows.
UPDATE "GstTransaction" t
   SET "documentDate" = i."invoiceDate"
  FROM "Invoice" i
 WHERE t."invoiceId" = i."id"
   AND t."documentDate" IS NULL;

UPDATE "GstTransaction" t
   SET "documentDate" = b."billDate"
  FROM "VendorBill" b
 WHERE t."vendorBillId" = b."id"
   AND t."documentDate" IS NULL;

-- Safety net. There are no rows with neither FK set at the time of writing, but
-- falling back to createdAt keeps step 3 from failing rather than leaving the
-- migration half-applied if one appears between now and deployment.
UPDATE "GstTransaction"
   SET "documentDate" = "createdAt"
 WHERE "documentDate" IS NULL;

-- 3. Now that every row has a value, enforce the constraint.
ALTER TABLE "GstTransaction" ALTER COLUMN "documentDate" SET NOT NULL;

-- 4. Filing-record timestamps (FRS 17.2).
ALTER TABLE "GstFilingPeriod" ADD COLUMN "preparedAt" TIMESTAMP(3);
ALTER TABLE "GstFilingPeriod" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);

-- 5. Indexes for the period/date filters the GST reports run.
CREATE INDEX "GstTransaction_documentDate_idx" ON "GstTransaction"("documentDate");
CREATE INDEX "GstFilingPeriod_status_idx" ON "GstFilingPeriod"("status");
