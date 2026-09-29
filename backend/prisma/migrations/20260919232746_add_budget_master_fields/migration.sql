-- Budgets & Budget Management module (FRS Section 19, 22, 27, 29.9).
-- Additive only: adds a human-readable name/code and a currency to the
-- existing Budget table. No columns are dropped, no data is deleted.
-- The Budget table has 0 rows in every environment this was checked against,
-- so `name` can safely be added as NOT NULL with no backfill needed.

ALTER TABLE "Budget" ADD COLUMN "name" TEXT NOT NULL;
ALTER TABLE "Budget" ADD COLUMN "code" TEXT;
ALTER TABLE "Budget" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';

CREATE UNIQUE INDEX "Budget_code_key" ON "Budget"("code");
