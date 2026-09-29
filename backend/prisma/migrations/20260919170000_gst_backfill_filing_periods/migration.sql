-- Assign the GstTransaction rows that predate this module to a filing period.
--
-- Until now nothing ever set filingPeriodId, so the 18 rows already in this
-- database (16 OUTPUT from invoices, 2 INPUT from vendor bills) carry NULL.
-- Every summary, reconciliation and export in the GST module groups by period,
-- so leaving them unassigned would make real recorded tax invisible.
--
-- Non-destructive: it INSERTs the periods those rows belong to and fills a
-- column that is currently NULL on every one of them. No existing value is
-- overwritten -- both statements are restricted to "filingPeriodId IS NULL" --
-- and on a fresh database both are no-ops.
--
-- Kept as its own migration rather than folded into
-- 20260919160000_gst_tax_module, because that one is already applied and
-- editing an applied migration's SQL breaks its recorded checksum.

-- 1. One period per distinct month present in the unassigned rows.
--    documentDate is `timestamp without time zone` holding UTC, so EXTRACT
--    reads the UTC month directly -- the same basis periodKeyOf() uses in
--    application code.
INSERT INTO "GstFilingPeriod" ("id", "periodMonth", "periodYear", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(),
       EXTRACT(MONTH FROM d.m)::int,
       EXTRACT(YEAR  FROM d.m)::int,
       'NOT_STARTED',
       NOW(),
       NOW()
  FROM (
        SELECT DISTINCT date_trunc('month', "documentDate") AS m
          FROM "GstTransaction"
         WHERE "filingPeriodId" IS NULL
       ) d
ON CONFLICT ("periodMonth", "periodYear") DO NOTHING;

-- 2. Point each unassigned row at the period for its own month.
UPDATE "GstTransaction" t
   SET "filingPeriodId" = p."id"
  FROM "GstFilingPeriod" p
 WHERE t."filingPeriodId" IS NULL
   AND p."periodMonth" = EXTRACT(MONTH FROM t."documentDate")::int
   AND p."periodYear"  = EXTRACT(YEAR  FROM t."documentDate")::int;
