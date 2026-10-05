// Demo-data seed for the Saanvika Solutions presentation.
//
// Run with:  npm run seed:demo      (see "Safety" below for the required env)
//
// WHAT IT DOES
//   Creates a compact, interconnected demo dataset (org, clients/projects,
//   expenses, invoices, AP, payroll, GST, budgets, payouts, audit trail) that
//   follows the application's own status flows and calculations. It writes
//   rows directly with Prisma because the API cannot back-date business events.
//
// SAFETY (all enforced below, in this order, BEFORE anything is written)
//   1. Never runs with NODE_ENV=production.
//   2. Target = DEMO_DATABASE_URL, else DATABASE_URL. The operator must state
//      which Neon endpoint they intend by setting DEMO_SEED_CONFIRM to that
//      endpoint id (first host label, e.g. "ep-empty-cloud-ayo5d34c"), so a
//      wrong .env cannot be seeded by accident.
//   3. Refuses if the database already holds NON-demo business records
//      (clients, projects, invoices, vendors, bills, claims, payroll, budgets),
//      i.e. it must look like a fresh/test branch. Override is deliberately not
//      offered.
//   4. Additive only: every insert is `createMany({ skipDuplicates: true })`
//      with deterministic ids, so reruns create nothing new and existing rows
//      (including the standard company.test users) are never updated or deleted.
//      No reset / truncate / delete / raw SQL is used anywhere.
//
// IDENTIFYING DEMO ROWS
//   Every id generated here starts with "de30de30-", users use
//   @demo.saanvika.test, employee codes are DEMO-###, and codes/numbers carry
//   a DEMO prefix where the schema has a free code field.

import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Safety gate
// ---------------------------------------------------------------------------

const DEMO_ID_PREFIX = "de30de30-";
const DEMO_PASSWORD = "Demo@Saanvika2026!";
const DEMO_EMAIL_DOMAIN = "demo.saanvika.test";

function fatal(message) {
  console.error(`\nDEMO SEED REFUSED: ${message}\n`);
  process.exit(1);
}

function resolveTarget() {
  if (process.env.NODE_ENV === "production") fatal("NODE_ENV is 'production'.");

  const url = process.env.DEMO_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) fatal("Neither DEMO_DATABASE_URL nor DATABASE_URL is set.");

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fatal("The database URL is not a valid URL.");
  }
  const endpointId = parsed.hostname.split(".")[0].replace(/-pooler$/, "");
  const database = parsed.pathname.replace(/^\//, "");

  if (process.env.DEMO_SEED_CONFIRM !== endpointId) {
    fatal(
      `Target database is endpoint "${endpointId}" (db "${database}", host ${parsed.hostname}).\n` +
        `Confirm it is your isolated demo/test branch by re-running with:\n` +
        `  DEMO_SEED_CONFIRM=${endpointId} npm run seed:demo`
    );
  }
  return { url, endpointId, database, host: parsed.hostname, usingDedicatedVar: Boolean(process.env.DEMO_DATABASE_URL) };
}

const target = resolveTarget();
const prisma = new PrismaClient({ datasourceUrl: target.url, log: ["error"] });

async function assertLooksLikeTestBranch() {
  const isDemo = { id: { startsWith: DEMO_ID_PREFIX } };
  const notDemo = { NOT: isDemo };
  const checks = {
    client: await prisma.client.count({ where: notDemo }),
    project: await prisma.project.count({ where: notDemo }),
    invoice: await prisma.invoice.count({ where: notDemo }),
    vendor: await prisma.vendor.count({ where: notDemo }),
    vendorBill: await prisma.vendorBill.count({ where: notDemo }),
    expenseClaim: await prisma.expenseClaim.count({ where: notDemo }),
    payrollRun: await prisma.payrollRun.count({ where: notDemo }),
    budget: await prisma.budget.count({ where: notDemo }),
    payout: await prisma.payout.count({ where: notDemo }),
  };
  const dirty = Object.entries(checks).filter(([, n]) => n > 0);
  if (dirty.length > 0) {
    fatal(
      "This database already contains non-demo business records " +
        `(${dirty.map(([k, n]) => `${k}: ${n}`).join(", ")}). ` +
        "It does not look like an isolated test branch, so nothing was written."
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic UUID-shaped id: same key -> same id on every run. */
const did = (key) => {
  const h = crypto.createHash("sha1").update(`saanvika-demo:${key}`).digest("hex");
  return `${DEMO_ID_PREFIX}${h.slice(0, 4)}-4${h.slice(4, 7)}-8${h.slice(7, 10)}-${h.slice(10, 22)}`;
};

const pad = (n) => String(n).padStart(2, "0");
/** Date-only value (UTC midnight), the shape the app stores for calendar dates. */
const D = (iso) => new Date(`${iso}T00:00:00.000Z`);
/** Timestamp at a given UTC hour on a date. */
const T = (iso, h = 5, m = 0) => new Date(`${iso}T${pad(h)}:${pad(m)}:00.000Z`);
const addDays = (iso, n) => {
  const d = D(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lastDayOf = (year, month) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

const rows = {};
const add = (model, row) => {
  (rows[model] ||= []).push(row);
  return row;
};

// ---------------------------------------------------------------------------
// Static definitions
// ---------------------------------------------------------------------------

// Mirrors prisma/seed.js (the app's own role/permission convention). Only used
// to guarantee the four roles exist with their standard permissions; existing
// roles are never modified.
const ROLE_DEFINITIONS = {
  "Team Lead": ["VIEW_EMPLOYEE", "VIEW_TEAM_SALARY", "APPROVE_EXPENSE"],
  Manager: ["VIEW_EMPLOYEE", "VIEW_TEAM_SALARY", "APPROVE_EXPENSE", "MANAGE_PROJECTS", "MANAGE_CLIENTS"],
  "Finance Admin": [
    "VIEW_EMPLOYEE", "VIEW_COMPANY_SALARY", "MANAGE_SALARY", "VERIFY_EXPENSE", "PROCESS_REIMBURSEMENT",
    "MANAGE_CLIENTS", "CREATE_INVOICE", "APPROVE_INVOICE", "RECORD_CLIENT_PAYMENT", "MANAGE_VENDORS",
    "VERIFY_VENDOR_BILL", "APPROVE_VENDOR_BILL", "RECORD_VENDOR_PAYMENT", "VIEW_GST", "PREPARE_GST_FILING",
    "SUBMIT_GST_FILING", "MANAGE_BUDGETS", "APPROVE_PAYROLL", "INITIATE_REFUND", "APPROVE_REFUND",
    "INITIATE_PAYOUT", "APPROVE_PAYOUT", "VIEW_PAYOUT", "MANAGE_PAYOUT_ACCOUNTS", "VIEW_FINANCIAL_REPORTS",
  ],
  "HR Admin": ["VIEW_EMPLOYEE", "VIEW_COMPANY_SALARY", "MANAGE_SALARY", "CREATE_EMPLOYEE", "MANAGE_USERS"],
};

const DEPARTMENTS = [
  { name: "Engineering", code: null },
  { name: "Finance", code: null },
  { name: "Human Resources", code: "HR" },
  { name: "Operations", code: "OPS" },
];

// key, names, designation, dept, manager key, roleType/roleName, joining date, status, monthly gross
const EMPLOYEES = [
  { key: "ceo", first: "Ananya", last: "Krishnan", designation: "Chief Executive Officer", dept: null, mgr: null, roleType: "SUPER_ADMIN", role: null, join: "2019-04-01", status: "ACTIVE", gross: 300000, by: null, email: "ceo" },
  { key: "fin", first: "Rohit", last: "Deshmukh", designation: "Finance Manager", dept: "Finance", mgr: "ceo", roleType: "ADMIN", role: "Finance Admin", join: "2021-06-14", status: "ACTIVE", gross: 120000, by: "ceo", email: "finance" },
  { key: "hr", first: "Meera", last: "Pillai", designation: "HR Manager", dept: "Human Resources", mgr: "ceo", roleType: "ADMIN", role: "HR Admin", join: "2021-09-01", status: "ACTIVE", gross: 95000, by: "ceo", email: "hr" },
  { key: "mgr", first: "Suresh", last: "Narayanan", designation: "Engineering Manager", dept: "Engineering", mgr: "ceo", roleType: "ADMIN", role: "Manager", join: "2020-02-10", status: "ACTIVE", gross: 180000, by: "ceo", email: "manager" },
  { key: "tl", first: "Lakshmi", last: "Prasad", designation: "Team Lead", dept: "Engineering", mgr: "mgr", roleType: "ADMIN", role: "Team Lead", join: "2021-11-22", status: "ACTIVE", gross: 140000, by: "hr", email: "teamlead" },
  { key: "empA", first: "Arjun", last: "Mehta", designation: "Software Engineer", dept: "Engineering", mgr: "tl", roleType: "USER", role: null, join: "2023-01-16", status: "ACTIVE", gross: 85000, by: "hr", email: "employee.a" },
  { key: "empB", first: "Sneha", last: "Kulkarni", designation: "QA Engineer", dept: "Engineering", mgr: "tl", roleType: "USER", role: null, join: "2023-05-08", status: "ACTIVE", gross: 70000, by: "hr", email: "employee.b" },
  { key: "karthik", first: "Karthik", last: "Reddy", designation: "Senior Software Engineer", dept: "Engineering", mgr: "tl", roleType: "USER", role: null, join: "2022-03-07", status: "ACTIVE", gross: 105000, by: "hr", email: "karthik.reddy" },
  { key: "pooja", first: "Pooja", last: "Sharma", designation: "UI/UX Designer", dept: "Engineering", mgr: "tl", roleType: "USER", role: null, join: "2026-07-01", status: "PROBATION", gross: 60000, by: "hr", email: "pooja.sharma" },
  { key: "farhan", first: "Farhan", last: "Ali", designation: "Operations Manager", dept: "Operations", mgr: "ceo", roleType: "ADMIN", role: "Manager", join: "2022-08-01", status: "ACTIVE", gross: 110000, by: "hr", email: "farhan.ali" },
  { key: "ritu", first: "Ritu", last: "Singh", designation: "Operations Executive", dept: "Operations", mgr: "farhan", roleType: "USER", role: null, join: "2024-02-12", status: "NOTICE_PERIOD", gross: 55000, by: "hr", email: "ritu.singh" },
];
EMPLOYEES.forEach((e, i) => (e.idx = i + 1));
const EMP = Object.fromEntries(EMPLOYEES.map((e) => [e.key, e]));
const uid = (k) => did(`user:${k}`);
const eid = (k) => did(`emp:${k}`);

const COMPANY_GSTIN = (process.env.COMPANY_GSTIN || "").trim().toUpperCase() || null;
const stateOf = (gstin) => (gstin ? gstin.slice(0, 2) : null);

const CLIENTS = [
  { key: "nimbus", name: "Nimbus Retail Pvt Ltd", email: "accounts@nimbusretail.demo.saanvika.test", phone: "+91 40 5555 0101", address: "Plot 42, Financial District, Gachibowli, Hyderabad, Telangana 500032", gstin: "36AAACN4521K1Z8", terms: "Net 30", status: "ACTIVE" },
  { key: "brightpath", name: "BrightPath Healthcare Ltd", email: "finance@brightpath.demo.saanvika.test", phone: "+91 80 5555 0102", address: "12 Outer Ring Road, Marathahalli, Bengaluru, Karnataka 560037", gstin: "29AABCB7743P1ZQ", terms: "Net 45", status: "ACTIVE" },
  { key: "kaveri", name: "Kaveri Logistics Pvt Ltd", email: "ap@kaverilogistics.demo.saanvika.test", phone: "+91 44 5555 0103", address: "88 Anna Salai, Guindy, Chennai, Tamil Nadu 600032", gstin: "33AAGCK3310L1Z2", terms: "Net 30", status: "ACTIVE" },
  { key: "orion", name: "Orion Financial Services", email: "billing@orionfin.demo.saanvika.test", phone: "+91 22 5555 0104", address: "Level 9, Bandra Kurla Complex, Mumbai, Maharashtra 400051", gstin: "27AAFCO9082D1Z5", terms: "Net 30", status: "ACTIVE" },
  { key: "greenfield", name: "Greenfield Agritech", email: "hello@greenfieldagri.demo.saanvika.test", phone: "+91 40 5555 0105", address: "Survey 17, Madhapur, Hyderabad, Telangana 500081", gstin: "36AABCG6120R1ZM", terms: "Net 30", status: "PROSPECT" },
];

const PROJECTS = [
  { key: "p1", name: "Nimbus E-Commerce Platform", client: "nimbus", pm: "mgr", contract: 8000000, model: "MILESTONE", status: "ACTIVE", start: "2026-04-01", end: "2026-12-15" },
  { key: "p2", name: "BrightPath Patient Portal", client: "brightpath", pm: "mgr", contract: 4500000, model: "TIME_AND_MATERIAL", status: "ACTIVE", start: "2026-05-01", end: "2026-12-31" },
  { key: "p3", name: "Kaveri Fleet Tracking App", client: "kaveri", pm: "mgr", contract: 3000000, model: "FIXED_PRICE", status: "ACTIVE", start: "2026-06-01", end: "2026-11-30" },
  { key: "p4", name: "Orion Data Analytics Retainer", client: "orion", pm: "mgr", contract: 3000000, model: "RETAINER", status: "ACTIVE", start: "2026-04-01", end: "2027-03-31" },
  { key: "p5", name: "Nimbus Mobile App - Phase 1", client: "nimbus", pm: "tl", contract: 1650000, model: "FIXED_PRICE", status: "COMPLETED", start: "2026-01-15", end: "2026-05-30" },
  { key: "p6", name: "Kaveri Warehouse Analytics", client: "kaveri", pm: "mgr", contract: 2000000, model: "TIME_AND_MATERIAL", status: "ON_HOLD", start: "2026-05-15", end: null },
  { key: "p7", name: "Greenfield Advisory Pilot", client: "greenfield", pm: "mgr", contract: 300000, model: "FIXED_PRICE", status: "PLANNED", start: "2026-10-15", end: "2026-12-15" },
];

const MILESTONES = [
  { key: "m1", project: "p1", name: "Discovery & Design", amount: 1200000, due: "2026-05-10", status: "COMPLETED", done: "2026-05-10" },
  { key: "m2", project: "p1", name: "Core Platform Build", amount: 2800000, due: "2026-08-28", status: "COMPLETED", done: "2026-08-28" },
  { key: "m3", project: "p1", name: "Integration & Payments", amount: 2400000, due: "2026-11-05", status: "IN_PROGRESS", done: null },
  { key: "m4", project: "p1", name: "UAT & Go-Live", amount: 1600000, due: "2026-12-15", status: "PENDING", done: null },
];

// allocation is % of an employee's time
const MEMBERS = [
  ["p1", "empA", 60, "2026-04-01"], ["p1", "karthik", 50, "2026-04-01"], ["p1", "empB", 40, "2026-04-01"], ["p1", "tl", 30, "2026-04-01"], ["p1", "mgr", 10, "2026-04-01"],
  ["p2", "karthik", 50, "2026-05-01"], ["p2", "empB", 40, "2026-05-01"], ["p2", "tl", 20, "2026-05-01"], ["p2", "pooja", 100, "2026-07-01"], ["p2", "mgr", 10, "2026-05-01"],
  ["p3", "empA", 40, "2026-06-01"], ["p3", "tl", 30, "2026-06-01"], ["p3", "mgr", 10, "2026-06-01"],
  ["p4", "empB", 20, "2026-04-01"], ["p4", "tl", 20, "2026-04-01"], ["p4", "mgr", 10, "2026-04-01"],
  ["p5", "empA", 30, "2026-01-15", "2026-05-30"], ["p5", "tl", 40, "2026-01-15", "2026-05-30"],
];

// Invoices (Finance creates, CEO approves - maker/checker). Tax 18% unless stated.
const INVOICES = [
  { key: "i1", client: "nimbus", project: "p5", date: "2026-04-10", terms: 30, status: "PAID", lines: [["Mobile App Phase 1 - 60% milestone (design + core build)", 1, 990000]], pays: [["2026-05-05", 1168200, "NEFT-NIMBUS-0505"]] },
  { key: "i2", client: "nimbus", project: "p5", date: "2026-05-30", terms: 30, status: "PAID", lines: [["Mobile App Phase 1 - final 40% on delivery", 1, 660000]], pays: [["2026-06-25", 778800, "NEFT-NIMBUS-0625"]] },
  { key: "i3", client: "nimbus", project: "p1", milestone: "m1", date: "2026-05-15", terms: 30, status: "PAID", lines: [["Milestone 1 - Discovery & Design", 1, 1200000]], pays: [["2026-06-10", 1416000, "NEFT-NIMBUS-0610"]] },
  { key: "i4", client: "nimbus", project: "p1", milestone: "m2", date: "2026-09-02", terms: 30, status: "PARTIALLY_PAID", lines: [["Milestone 2 - Core Platform Build", 1, 2800000]], pays: [["2026-09-20", 2000000, "NEFT-NIMBUS-0920"]] },
  { key: "i6", client: "brightpath", project: "p2", date: "2026-06-30", terms: 45, status: "PAID", period: ["2026-06-01", "2026-06-30"], lines: [["Senior developer hours - June", 200, 2200], ["QA / analyst hours - June", 80, 1800]], pays: [["2026-08-10", 689120, "NEFT-BRIGHT-0810"]] },
  { key: "i7", client: "brightpath", project: "p2", date: "2026-07-31", terms: 45, status: "OVERDUE", period: ["2026-07-01", "2026-07-31"], lines: [["Senior developer hours - July", 240, 2200], ["QA / analyst hours - July", 100, 1800]], pays: [] },
  { key: "i8", client: "brightpath", project: "p2", date: "2026-08-31", terms: 45, status: "SENT", period: ["2026-08-01", "2026-08-31"], lines: [["Senior developer hours - August", 230, 2200], ["QA / analyst hours - August", 110, 1800]], pays: [] },
  { key: "i9", client: "brightpath", project: "p2", date: "2026-09-25", terms: 45, status: "DRAFT", period: ["2026-09-01", "2026-09-30"], lines: [["Senior developer hours - September", 250, 2200], ["QA / analyst hours - September", 120, 1800]], pays: [] },
  { key: "i10", client: "kaveri", project: "p3", date: "2026-06-05", terms: 30, status: "PAID", lines: [["Fleet Tracking App - 50% advance", 1, 1500000]], pays: [["2026-06-28", 1770000, "NEFT-KAVERI-0628"]] },
  { key: "i11", client: "kaveri", project: "p3", date: "2026-09-15", terms: 30, status: "PENDING_APPROVAL", lines: [["Fleet Tracking App - 30% on beta release", 1, 900000]], pays: [] },
  { key: "i12", client: "orion", project: "p4", date: "2026-04-30", terms: 30, status: "PAID", period: ["2026-04-01", "2026-04-30"], lines: [["Analytics retainer - April", 1, 250000]], pays: [["2026-05-22", 295000, "NEFT-ORION-0522"]] },
  { key: "i13", client: "orion", project: "p4", date: "2026-05-31", terms: 30, status: "PAID", period: ["2026-05-01", "2026-05-31"], lines: [["Analytics retainer - May", 1, 250000]], pays: [["2026-06-25", 295000, "NEFT-ORION-0625"]] },
  { key: "i14", client: "orion", project: "p4", date: "2026-06-30", terms: 30, status: "PAID", period: ["2026-06-01", "2026-06-30"], lines: [["Analytics retainer - June", 1, 250000]], pays: [["2026-07-24", 295000, "NEFT-ORION-0724"]] },
  { key: "i15", client: "orion", project: "p4", date: "2026-07-31", terms: 30, status: "PAID", period: ["2026-07-01", "2026-07-31"], lines: [["Analytics retainer - July", 1, 250000]], pays: [["2026-08-28", 295000, "NEFT-ORION-0828"]] },
  { key: "i16", client: "orion", project: "p4", date: "2026-08-31", terms: 30, status: "SENT", period: ["2026-08-01", "2026-08-31"], lines: [["Analytics retainer - August", 1, 250000]], pays: [] },
  { key: "i17", client: "orion", project: "p4", date: "2026-09-25", terms: 30, status: "APPROVED", period: ["2026-09-01", "2026-09-30"], lines: [["Analytics retainer - September", 1, 250000]], pays: [] },
];

const VENDORS = [
  { key: "cloudnest", name: "CloudNest Hosting Pvt Ltd", category: "Cloud provider", email: "billing@cloudnest.demo.saanvika.test", phone: "+91 80 5555 0201", address: "5th Floor, Embassy Tech Village, Bengaluru, Karnataka 560103", gstin: "29AABCC8821H1ZP", services: "Cloud compute, storage and CDN", terms: "Net 30", bank: "HDFC Bank, A/c ****4421, IFSC HDFC0001234 (demo)" },
  { key: "techsoft", name: "TechSoft Licensing Solutions", category: "Software subscription", email: "sales@techsoft.demo.saanvika.test", phone: "+91 40 5555 0202", address: "Kondapur, Hyderabad, Telangana 500084", gstin: "36AAECT4412M1Z9", services: "IDE, design tool and collaboration licences", terms: "Net 30", bank: "ICICI Bank, A/c ****7783, IFSC ICIC0000456 (demo)" },
  { key: "swiftnet", name: "SwiftNet Broadband", category: "ISP", email: "accounts@swiftnet.demo.saanvika.test", phone: "+91 40 5555 0203", address: "Begumpet, Hyderabad, Telangana 500016", gstin: "36AAFCS2210B1ZK", services: "Dedicated 500 Mbps leased line", terms: "Net 15", bank: "Axis Bank, A/c ****1190, IFSC UTIB0000789 (demo)" },
  { key: "prime", name: "Prime Workspace Services", category: "Office services", email: "ops@primeworkspace.demo.saanvika.test", phone: "+91 40 5555 0204", address: "HITEC City, Hyderabad, Telangana 500081", gstin: "36AAGCP7731Q1ZA", services: "Co-working seats, housekeeping and facility management", terms: "Net 30", bank: "SBI, A/c ****5566, IFSC SBIN0001010 (demo)" },
  { key: "talent", name: "TalentBridge Recruiters", category: "Recruitment", email: "billing@talentbridge.demo.saanvika.test", phone: "+91 20 5555 0205", address: "Baner, Pune, Maharashtra 411045", gstin: "27AAHCT5590E1ZD", services: "Technical hiring and executive search", terms: "Net 30", bank: "Kotak Mahindra Bank, A/c ****3308, IFSC KKBK0000321 (demo)" },
  { key: "ravi", name: "Ravi Kumar Consulting", category: "Freelancer", email: "ravi@consulting.demo.saanvika.test", phone: "+91 90000 55206", address: "Kukatpally, Hyderabad, Telangana 500072", gstin: null, services: "UX audits and design consulting", terms: "Net 15", bank: "HDFC Bank, A/c ****9012, IFSC HDFC0005678 (demo)" },
];

// status = target status; items [description, amount(ex-tax), taxRate]
const BILLS = [
  { key: "b1", vendor: "cloudnest", no: "CN-2026-0611", project: "p1", date: "2026-06-05", terms: 30, status: "PAID", po: "PO-DEMO-1001", items: [["Cloud compute - June", 68000, 18], ["Storage & CDN - June", 14000, 18]], pays: [["2026-06-28", 96760, "UTR-CN-0611"]] },
  { key: "b2", vendor: "cloudnest", no: "CN-2026-0711", project: "p1", date: "2026-07-05", terms: 30, status: "PAID", po: "PO-DEMO-1001", items: [["Cloud compute - July", 72000, 18], ["Storage & CDN - July", 15000, 18]], pays: [["2026-07-30", 102660, "UTR-CN-0711"]] },
  { key: "b3", vendor: "cloudnest", no: "CN-2026-0811", project: "p1", date: "2026-08-05", terms: 30, status: "PARTIALLY_PAID", po: "PO-DEMO-1001", items: [["Cloud compute - August", 75000, 18], ["Storage & CDN - August", 16000, 18]], pays: [["2026-08-28", 60000, "DEMO-UTR-0002", "po3"]] },
  { key: "b4", vendor: "cloudnest", no: "CN-2026-0911", project: "p1", date: "2026-09-05", terms: 30, status: "PENDING_APPROVAL", po: "PO-DEMO-1001", items: [["Cloud compute - September", 78000, 18], ["Storage & CDN - September", 16500, 18]], pays: [] },
  { key: "b5", vendor: "techsoft", no: "TS-INV-5521", project: null, date: "2026-07-10", terms: 30, status: "PAID", po: null, items: [["Annual IDE licences (12 seats)", 240000, 18]], pays: [["2026-08-05", 283200, "UTR-TS-5521"]] },
  { key: "b6", vendor: "swiftnet", no: "SN-0826", project: null, date: "2026-08-01", terms: 15, status: "PAID", po: null, items: [["500 Mbps leased line - August", 20000, 18]], pays: [["2026-08-14", 23600, "UTR-SN-0826"]] },
  { key: "b7", vendor: "swiftnet", no: "SN-0926", project: null, date: "2026-09-01", terms: 15, status: "APPROVED", po: null, items: [["500 Mbps leased line - September", 20000, 18]], pays: [] },
  { key: "b8", vendor: "prime", no: "PW-0826", project: null, date: "2026-08-20", terms: 30, status: "PAID", po: null, items: [["Co-working seats - August", 90000, 18]], pays: [["2026-09-15", 106200, "UTR-PW-0826"]] },
  { key: "b9", vendor: "prime", no: "PW-0926", project: null, date: "2026-09-20", terms: 30, status: "REJECTED", po: null, rejectComment: "Housekeeping charge is not covered by the signed contract; ask vendor to re-issue.", items: [["Co-working seats - September", 90000, 18], ["Housekeeping add-on (not in contract)", 12000, 18]], pays: [] },
  { key: "b10", vendor: "techsoft", no: "TS-INV-6012", project: "p2", date: "2026-09-15", terms: 30, status: "PENDING_VERIFICATION", po: null, items: [["Design tool subscriptions - 6 seats", 36000, 18]], pays: [] },
  { key: "b11", vendor: "talent", no: "TB-2026-114", project: null, date: "2026-09-12", terms: 30, status: "VERIFIED", po: "PO-DEMO-2040", items: [["Recruitment fee - Senior Engineer placement", 150000, 18]], pays: [] },
  { key: "b12", vendor: "ravi", no: "RK-014", project: "p2", date: "2026-09-18", terms: 15, status: "DRAFT", po: null, items: [["UX audit consulting (unregistered vendor, no GST)", 45000, 0]], pays: [] },
];

// GST filing status per month (2026). No portal reference numbers are invented:
// FILED periods carry no referenceNo, exactly as the app allows.
const GST_PERIODS = { 4: "FILED", 5: "FILED", 6: "FILED", 7: "READY", 8: "IN_PREPARATION", 9: "NOT_STARTED" };
const GST_FILED_ON = { 4: "2026-05-18", 5: "2026-06-18", 6: "2026-07-18" };

const BUDGETS = [
  { key: "bud-company", name: "Company Operating Budget - Q3 FY2026-27", code: "DEMO-BUD-CO-Q3", scope: "COMPANY", period: "FY2026-27 Q3", planned: 9000000, items: [["Payroll", 4500000], ["Vendors & Cloud", 2400000], ["Employee Expenses", 600000], ["Contingency", 1500000]] },
  { key: "bud-eng", name: "Engineering Budget - Q3 FY2026-27", code: "DEMO-BUD-ENG-Q3", scope: "DEPARTMENT", dept: "Engineering", period: "FY2026-27 Q3", planned: 1500000, items: [["Payroll", 1100000], ["Travel & Client Visits", 250000], ["Training", 150000]] },
  { key: "bud-ops", name: "Operations Budget - Q3 FY2026-27", code: "DEMO-BUD-OPS-Q3", scope: "DEPARTMENT", dept: "Operations", period: "FY2026-27 Q3", planned: 250000, items: [["Payroll", 200000], ["Office & Admin", 50000]] },
  { key: "bud-fin", name: "Finance Budget - Q3 FY2026-27", code: "DEMO-BUD-FIN-Q3", scope: "DEPARTMENT", dept: "Finance", period: "FY2026-27 Q3", planned: 220000, items: [["Payroll", 160000], ["Audit & Compliance", 60000]] },
  { key: "bud-p1", name: "Nimbus E-Commerce Platform - Project Budget", code: "DEMO-BUD-P1", scope: "PROJECT", project: "p1", period: "FY2026-27", planned: 5200000, items: [["Labour", 3200000], ["Cloud & Infrastructure", 1500000], ["Travel & Expenses", 500000]] },
  { key: "bud-p2", name: "BrightPath Patient Portal - Project Budget", code: "DEMO-BUD-P2", scope: "PROJECT", project: "p2", period: "FY2026-27", planned: 2800000, items: [["Labour", 2400000], ["Tools & Licences", 200000], ["Travel & Expenses", 200000]] },
  { key: "bud-p3", name: "Kaveri Fleet Tracking App - Project Budget", code: "DEMO-BUD-P3", scope: "PROJECT", project: "p3", period: "FY2026-27", planned: 900000, items: [["Labour", 800000], ["Travel & Expenses", 100000]] },
  { key: "bud-p4", name: "Orion Analytics Retainer - Project Budget", code: "DEMO-BUD-P4", scope: "PROJECT", project: "p4", period: "FY2026-27", planned: 600000, items: [["Labour", 550000], ["Travel & Expenses", 50000]] },
];

// Expense claims. status is the claim's current state; the approval trail is
// derived from it using the app's own transitions (see buildClaimTrail).
const REVIEWER = { empA: "tl", empB: "tl", karthik: "tl", pooja: "tl", tl: "mgr", mgr: "ceo", farhan: "ceo", hr: "ceo", ritu: "farhan" };
const CLAIMS = [
  // Drafts
  { key: "c1", emp: "empA", cat: "Food", proj: "p3", amt: 850, date: "2026-09-24", purpose: "Team lunch during Kaveri sprint review", pay: "UPI", status: "DRAFT" },
  { key: "c2", emp: "karthik", cat: "Internet", proj: null, amt: 1199, date: "2026-09-25", purpose: "Home broadband - September (work from home)", pay: "UPI", status: "DRAFT", recurring: "MONTHLY" },
  // Submitted, awaiting Manager / Team Lead
  { key: "c3", emp: "empA", cat: "Cab", proj: "p1", amt: 1450, date: "2026-09-22", purpose: "Cab to Nimbus client workshop, Gachibowli", pay: "Personal Card", status: "SUBMITTED" },
  { key: "c4", emp: "empB", cat: "Travel", proj: "p2", amt: 6800, date: "2026-09-18", purpose: "Flight Hyderabad-Bengaluru for BrightPath UAT", pay: "Personal Card", status: "SUBMITTED" },
  { key: "c5", emp: "pooja", cat: "Office Supplies", proj: null, amt: 2350, date: "2026-09-21", purpose: "Sketchbooks and stylus pens for design workshop", pay: "Cash", status: "SUBMITTED", missing: "Cash purchase at a local store; the bill was misplaced." },
  { key: "c6", emp: "ritu", cat: "Client Meetings", proj: null, amt: 3200, date: "2026-09-19", purpose: "Refreshments for vendor onboarding visit", pay: "Cash", status: "SUBMITTED" },
  { key: "c7", emp: "tl", cat: "Hotel", proj: "p2", amt: 9400, date: "2026-09-12", purpose: "2-night stay in Bengaluru for BrightPath onsite", pay: "Personal Card", status: "SUBMITTED" },
  // Manager-approved, awaiting Finance
  { key: "c8", emp: "karthik", cat: "Travel", proj: "p1", amt: 4200, date: "2026-09-08", purpose: "Train travel for Nimbus data-centre visit", pay: "Personal Card", status: "MANAGER_APPROVED", mgrComment: "Approved - client-billable travel." },
  { key: "c9", emp: "empA", cat: "Client Meetings", proj: "p3", amt: 2750, date: "2026-09-12", purpose: "Kaveri stakeholder dinner", pay: "Personal Card", status: "MANAGER_APPROVED", mgrComment: "Approved. Within the client hospitality guideline." },
  { key: "c10", emp: "mgr", cat: "Travel", proj: "p4", amt: 8900, date: "2026-09-05", purpose: "Flight to Mumbai for Orion quarterly review", pay: "Personal Card", status: "MANAGER_APPROVED", mgrComment: "Approved." },
  { key: "c11", emp: "empB", cat: "Food", proj: null, amt: 1650, date: "2026-09-14", purpose: "Late-night release team dinner", pay: "UPI", status: "MANAGER_APPROVED", mgrComment: "Approved for release night." },
  // Rejected / returned / cancelled
  { key: "c12", emp: "karthik", cat: "Business Expenses", proj: null, amt: 4500, date: "2026-08-28", purpose: "Conference ticket (personal interest)", pay: "Personal Card", status: "MANAGER_REJECTED", mgrComment: "Not aligned with a project or business need. Please seek prior approval." },
  { key: "c13", emp: "empB", cat: "Fuel", proj: null, amt: 3100, date: "2026-09-02", purpose: "Fuel reimbursement - August client visits", pay: "Cash", status: "RETURNED", mgrComment: "Please attach fuel bills and state the distance travelled." },
  { key: "c14", emp: "hr", cat: "Business Expenses", proj: null, amt: 5600, date: "2026-08-20", purpose: "Recruitment portal credit top-up", pay: "Personal Card", status: "FINANCE_REJECTED", mgrComment: "Approved at manager level.", finComment: "Recruitment spend must be billed through the vendor bill process, not claimed as an expense." },
  { key: "c15", emp: "ritu", cat: "Food", proj: null, amt: 600, date: "2026-09-10", purpose: "Working lunch (claim withdrawn)", pay: "Cash", status: "CANCELLED" },
  // Finance-approved, reimbursement pending
  { key: "c16", emp: "empA", cat: "Cab", proj: "p1", amt: 1880, date: "2026-09-01", purpose: "Cabs for Nimbus client workshop days", pay: "Personal Card", status: "REIMBURSEMENT_PENDING", mgrComment: "Approved.", finComment: "Verified against receipts.", payout: "awaiting" },
  { key: "c17", emp: "pooja", cat: "Telephone", proj: null, amt: 799, date: "2026-08-31", purpose: "Mobile data plan for client calls", pay: "UPI", status: "REIMBURSEMENT_PENDING", mgrComment: "Approved.", finComment: "Verified." },
  { key: "c18", emp: "ritu", cat: "Travel", proj: null, amt: 2400, date: "2026-08-30", purpose: "Auto fare and metro for vendor site visits", pay: "Cash", status: "REIMBURSEMENT_PENDING", mgrComment: "Approved.", finComment: "Verified." },
  // Paid
  { key: "c19", emp: "empA", cat: "Travel", proj: "p1", amt: 5600, date: "2026-08-10", purpose: "Train and taxi for Nimbus requirements workshop", pay: "Personal Card", status: "PAID", mgrComment: "Approved.", finComment: "Verified.", paid: { method: "BANK_TRANSFER", date: "2026-08-19", payout: "po1" } },
  { key: "c20", emp: "karthik", cat: "Hotel", proj: "p2", amt: 7800, date: "2026-08-14", purpose: "Hotel during BrightPath discovery week", pay: "Personal Card", status: "PAID", mgrComment: "Approved.", finComment: "Verified.", paid: { method: "BANK_TRANSFER", date: "2026-08-24", ref: "NEFT-EXP-0824" } },
  { key: "c21", emp: "empB", cat: "Cab", proj: "p2", amt: 1250, date: "2026-07-22", purpose: "Cab to BrightPath office for UAT", pay: "Cash", status: "PAID", mgrComment: "Approved.", finComment: "Verified.", paid: { method: "PETTY_CASH", date: "2026-07-30" } },
  { key: "c22", emp: "tl", cat: "Client Meetings", proj: "p1", amt: 3900, date: "2026-07-15", purpose: "Client lunch after Nimbus design sign-off", pay: "Personal Card", status: "PAID", mgrComment: "Approved.", finComment: "Verified.", paid: { method: "BANK_TRANSFER", date: "2026-07-24", ref: "NEFT-EXP-0724" } },
  { key: "c23", emp: "farhan", cat: "Office Supplies", proj: null, amt: 4750, date: "2026-07-08", purpose: "Printer cartridges and stationery", pay: "Personal Card", status: "PAID", mgrComment: "Approved.", finComment: "Verified.", paid: { method: "BANK_TRANSFER", date: "2026-07-17", ref: "NEFT-EXP-0717" } },
  { key: "c24", emp: "mgr", cat: "Travel", proj: "p3", amt: 9200, date: "2026-06-20", purpose: "Flights and cab for Kaveri kickoff in Chennai", pay: "Personal Card", status: "PAID", mgrComment: "Approved.", finComment: "Verified.", paid: { method: "BANK_TRANSFER", date: "2026-07-01", ref: "NEFT-EXP-0701" } },
  { key: "c25", emp: "karthik", cat: "Internet", proj: null, amt: 1199, date: "2026-08-25", purpose: "Home broadband - August (work from home)", pay: "UPI", status: "PAID", recurring: "MONTHLY", mgrComment: "Approved.", finComment: "Verified.", paid: { method: "BANK_TRANSFER", date: "2026-09-03", ref: "NEFT-EXP-0903" } },
];

// ---------------------------------------------------------------------------
// Build: audit / approval-trail helpers
// ---------------------------------------------------------------------------

const actionFor = (to) => {
  if (["MANAGER_APPROVED", "REIMBURSEMENT_PENDING", "APPROVED", "FINALIZED", "VERIFIED"].includes(to)) return "APPROVE";
  if (["MANAGER_REJECTED", "FINANCE_REJECTED", "REJECTED"].includes(to)) return "REJECT";
  if (to === "RETURNED") return "RETURN";
  if (to === "CANCELLED") return "CANCEL";
  return "UPDATE";
};

/** Writes the ApprovalStep + AuditLog pair the services write for every status change. */
function trail(entityType, entityKey, entityId, steps) {
  steps.forEach((s, i) => {
    add("approvalStep", {
      id: did(`step:${entityType}:${entityKey}:${i}`),
      entityType, entityId, actorUserId: uid(s.actor), fromStatus: s.from, toStatus: s.to,
      comment: s.comment ?? null, createdAt: s.at,
    });
    add("auditLog", {
      id: did(`audit:${entityType}:${entityKey}:step${i}`),
      entityType, entityId, action: actionFor(s.to), performedById: uid(s.actor),
      previousValue: { status: s.from }, newValue: { status: s.to }, note: s.comment ?? null, createdAt: s.at,
    });
  });
}

function auditCreate(entityType, entityKey, entityId, actor, at, newValue, action = "CREATE") {
  add("auditLog", {
    id: did(`audit:${entityType}:${entityKey}:create`),
    entityType, entityId, action, performedById: uid(actor), previousValue: null, newValue, note: null, createdAt: at,
  });
}

// ---------------------------------------------------------------------------
// Build: dataset
// ---------------------------------------------------------------------------

async function build(ctx) {
  const { deptId, categoryId, roleId, passwordHash } = ctx;

  // ---- Users, employees, salary --------------------------------------------
  for (const e of EMPLOYEES) {
    const created = T(addDays(e.join, -1) > "2026-03-01" ? "2026-06-30" : "2026-03-01", 5);
    add("user", {
      id: uid(e.key), email: `${e.email}@${DEMO_EMAIL_DOMAIN}`, passwordHash, roleType: e.roleType,
      roleId: e.role ? roleId[e.role] : null, status: "ACTIVE", createdById: e.by ? uid(e.by) : null, createdAt: created,
    });
    add("employee", {
      id: eid(e.key), userId: uid(e.key), firstName: e.first, lastName: e.last, designation: e.designation,
      departmentId: e.dept ? deptId[e.dept] : null, managerId: e.mgr ? eid(e.mgr) : null,
      dateOfJoining: D(e.join), employeeCode: `DEMO-${String(e.idx).padStart(3, "0")}`,
      phone: `+91 90000 ${String(10000 + e.idx * 137).slice(0, 5)}`, status: e.status, createdAt: created,
    });
    auditCreate("User", e.key, uid(e.key), e.by || "ceo", created, { email: `${e.email}@${DEMO_EMAIL_DOMAIN}`, roleType: e.roleType, role: e.role });

    // Salary structure (HR maintains). Split of gross: 50% basic, 20% HRA, 30% special allowance.
    const effective = e.join > "2026-01-01" ? e.join : "2026-01-01";
    const sid = did(`salstruct:${e.key}`);
    add("salaryStructure", { id: sid, employeeId: eid(e.key), effectiveFrom: D(effective), createdAt: T(effective, 5) });
    e.comps = salaryComponents(e.gross);
    e.comps.forEach((c, i) => add("salaryComponent", { id: did(`salcomp:${e.key}:${i}`), structureId: sid, label: c.label, type: c.type, amount: c.amount }));
    auditCreate("SalaryStructure", e.key, sid, "hr", T(effective, 6), { employeeId: eid(e.key), effectiveFrom: effective, gross: e.gross });

    // Payout destination: UPI only (no bank number, so no encryption key is needed).
    add("employeePayoutAccount", {
      id: did(`payacct:${e.key}`), employeeId: eid(e.key), accountHolderName: `${e.first} ${e.last}`,
      upiVpa: `${e.first.toLowerCase()}.${e.last.toLowerCase()}@demobank`, verificationStatus: "VERIFIED",
      verifiedAt: T("2026-06-30", 6), isActive: true, createdAt: T("2026-06-30", 5),
    });
  }

  // ---- Clients, projects, milestones, members --------------------------------
  const clientId = (k) => did(`client:${k}`);
  for (const c of CLIENTS) {
    add("client", {
      id: clientId(c.key), name: c.name, contactEmail: c.email, contactPhone: c.phone, billingAddress: c.address,
      gstin: c.gstin, paymentTerms: c.terms, currency: "INR", status: c.status, createdAt: T("2026-03-20", 5),
    });
    auditCreate("Client", c.key, clientId(c.key), "mgr", T("2026-03-20", 5), { name: c.name, status: c.status });
  }
  const projectId = (k) => did(`project:${k}`);
  for (const p of PROJECTS) {
    add("project", {
      id: projectId(p.key), name: p.name, clientId: clientId(p.client), projectManagerId: eid(p.pm),
      contractValue: p.contract, billingModel: p.model, status: p.status, startDate: D(p.start),
      endDate: p.end ? D(p.end) : null, createdAt: T(addDays(p.start, -7) < "2026-01-01" ? "2026-01-05" : addDays(p.start, -7), 5),
    });
    auditCreate("Project", p.key, projectId(p.key), "mgr", T(addDays(p.start, -7) < "2026-01-01" ? "2026-01-05" : addDays(p.start, -7), 5), { name: p.name, status: p.status });
  }
  MILESTONES.forEach((m, i) =>
    add("projectMilestone", {
      id: did(`milestone:${m.key}`), projectId: projectId(m.project), name: m.name, amount: m.amount, dueDate: D(m.due),
      status: m.status, completedAt: m.done ? T(m.done, 10) : null, sequence: i + 1, createdAt: T("2026-03-25", 5),
    })
  );
  MEMBERS.forEach(([p, e, pct, start, end]) =>
    add("projectMember", { id: did(`member:${p}:${e}`), projectId: projectId(p), employeeId: eid(e), allocationPercent: pct, startDate: D(start), endDate: end ? D(end) : null })
  );

  // ---- Expense claims, receipts, reimbursements -------------------------------
  const claimId = (k) => did(`claim:${k}`);
  for (const c of CLAIMS) {
    const id = claimId(c.key);
    const owner = c.emp;
    const created = T(addDays(c.date, 1), 5);
    add("expenseClaim", {
      id, employeeId: eid(owner), categoryId: categoryId[c.cat], projectId: c.proj ? projectId(c.proj) : null,
      amount: c.amt, expenseDate: D(c.date), purpose: c.purpose, paymentMethod: c.pay,
      receiptMissing: Boolean(c.missing), receiptMissingReason: c.missing || null, status: c.status,
      isRecurring: Boolean(c.recurring), recurringPeriod: c.recurring || null, createdAt: created,
    });
    auditCreate("ExpenseClaim", c.key, id, owner, created, { amount: c.amt, categoryId: categoryId[c.cat], status: "DRAFT" });

    if (c.status !== "DRAFT" && !c.missing) {
      const storageKey = `${did(`receipt:${c.key}`)}.pdf`;
      const bytes = receiptPdf(`DEMO RECEIPT - ${c.purpose} - INR ${c.amt.toFixed(2)} - ${c.date}`);
      writeReceiptFile(storageKey, bytes);
      add("expenseReceipt", {
        id: did(`receiptrow:${c.key}`), expenseClaimId: id, uploadedAt: T(addDays(c.date, 1), 5),
        checksum: crypto.createHash("sha256").update(bytes).digest("hex"), mimeType: "application/pdf",
        originalFileName: `receipt-${c.date}-${c.cat.toLowerCase().replace(/\s+/g, "-")}.pdf`, sizeBytes: bytes.length,
        storageKey, uploadedById: uid(owner),
      });
    }

    const steps = buildClaimTrail(c, owner);
    trail("ExpenseClaim", c.key, id, steps);

    const reimbursed = ["REIMBURSEMENT_PENDING", "PAID"].includes(c.status);
    if (reimbursed) {
      const paid = c.status === "PAID";
      const financeAt = steps.find((s) => s.to === "REIMBURSEMENT_PENDING").at;
      const utr = paid && c.paid.payout ? PAYOUT_UTR[c.paid.payout] : null;
      const ref = paid ? utr || c.paid.ref || null : null;
      add("reimbursement", {
        id: did(`reimb:${c.key}`), expenseClaimId: id, amount: c.amt, paymentStatus: paid ? "PAID" : "PENDING",
        paidAt: paid ? T(c.paid.date, 6) : null, referenceNo: ref, method: paid ? c.paid.method : null,
        totalPaid: paid ? c.amt : 0, createdAt: financeAt,
      });
      if (paid) {
        add("auditLog", {
          id: did(`audit:Reimbursement:${c.key}:paid`), entityType: "Reimbursement", entityId: did(`reimb:${c.key}`),
          action: "UPDATE", performedById: uid("fin"), previousValue: { paymentStatus: "PENDING" },
          newValue: { paymentStatus: "PAID", method: c.paid.method, referenceNo: ref }, note: null, createdAt: T(c.paid.date, 6),
        });
      }
    }
  }

  // ---- Invoices, payments, GST (output) ---------------------------------------
  const existingInvoices = new Set((await prisma.invoice.findMany({ where: { id: { startsWith: DEMO_ID_PREFIX } }, select: { id: true } })).map((r) => r.id));
  const lastSeq = await prisma.invoice
    .findMany({ where: { invoiceNumber: { startsWith: "INV-2026-" } }, select: { invoiceNumber: true } })
    .then((r) => r.reduce((m, x) => Math.max(m, parseInt(x.invoiceNumber.slice(9), 10) || 0), 0));
  let nextSeq = lastSeq;

  const gstOutput = [];
  const invoiceTotals = {};
  for (const inv of INVOICES) {
    const id = did(`invoice:${inv.key}`);
    const client = CLIENTS.find((c) => c.key === inv.client);
    const priced = inv.lines.map(([description, quantity, rate]) => {
      const lineTotal = round2(quantity * rate);
      return { description, quantity, rate, taxRate: 18, discount: 0, lineTotal, taxAmount: round2((lineTotal * 18) / 100) };
    });
    const total = round2(priced.reduce((s, l) => s + l.lineTotal + l.taxAmount, 0));
    invoiceTotals[inv.key] = total;

    // Reconcile: the hand-written payment amounts must be consistent with the computed totals.
    const paid = round2(inv.pays.reduce((s, p) => s + p[1], 0));
    const expectStatus = paid === 0 ? null : paid >= total ? "PAID" : "PARTIALLY_PAID";
    if (expectStatus && expectStatus !== inv.status) throw new Error(`Invoice ${inv.key}: payments (${paid}) do not match status ${inv.status} for total ${total}.`);
    if (paid > total) throw new Error(`Invoice ${inv.key}: overpaid.`);

    const number = existingInvoices.has(id) ? null : `INV-2026-${String(++nextSeq).padStart(4, "0")}`;
    const dueDate = addDays(inv.date, inv.terms);
    const approved = !["DRAFT", "PENDING_APPROVAL"].includes(inv.status);
    add("invoice", {
      id, ...(number ? { invoiceNumber: number } : { invoiceNumber: `RESERVED-${id}` }), clientId: clientId(inv.client), projectId: projectId(inv.project),
      milestoneId: inv.milestone ? did(`milestone:${inv.milestone}`) : null, invoiceDate: D(inv.date), dueDate: D(dueDate),
      billingPeriodStart: inv.period ? D(inv.period[0]) : null, billingPeriodEnd: inv.period ? D(inv.period[1]) : null,
      paymentTerms: client.terms, status: inv.status, totalAmount: total, currency: "INR",
      notes: "Demo invoice", createdById: uid("fin"), approvedById: approved ? uid("ceo") : null, createdAt: T(inv.date, 5),
    });
    priced.forEach((l, i) =>
      add("invoiceLineItem", { id: did(`invline:${inv.key}:${i}`), invoiceId: id, description: l.description, quantity: l.quantity, rate: l.rate, taxRate: l.taxRate, discount: 0, lineTotal: l.lineTotal })
    );

    auditCreate("Invoice", inv.key, id, "fin", T(inv.date, 5), { totalAmount: total, status: "DRAFT" });
    const steps = [];
    const S = (from, to, actor, at, comment) => steps.push({ from, to, actor, at, comment });
    if (inv.status !== "DRAFT") S("DRAFT", "PENDING_APPROVAL", "fin", T(inv.date, 6));
    let cursor = inv.date;
    if (approved) { cursor = addDays(inv.date, 1); S("PENDING_APPROVAL", "APPROVED", "ceo", T(cursor, 7)); }
    const sent = ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"].includes(inv.status);
    if (sent) { cursor = addDays(cursor, 1); S("APPROVED", "SENT", "fin", T(cursor, 5)); }
    let current = sent ? "SENT" : null;
    inv.pays.forEach(([date, amount, ref], i) => {
      const before = round2(inv.pays.slice(0, i).reduce((s, p) => s + p[1], 0));
      const after = round2(before + amount);
      const to = after >= total ? "PAID" : "PARTIALLY_PAID";
      S(current, to, "fin", T(date, 8), `Payment of ${round2(amount)} INR recorded (${after} of ${total}).`);
      current = to;
      const payId = did(`clientpay:${inv.key}:${i}`);
      add("clientPayment", { id: payId, invoiceId: id, amount, paymentDate: D(date), method: "BANK_TRANSFER", referenceNo: ref, note: null, recordedAt: T(date, 8) });
      auditCreate("ClientPayment", `${inv.key}:${i}`, payId, "fin", T(date, 8), { invoiceId: id, amount, referenceNo: ref, amountReceived: after, remainingAmount: round2(total - after) });
    });
    if (inv.status === "OVERDUE") S("SENT", "OVERDUE", "ceo", T(addDays(dueDate, 1), 1));
    trail("Invoice", inv.key, id, steps);

    if (sent) {
      for (const g of gstRowsFor(client.gstin, priced)) {
        const period = Number(inv.date.slice(5, 7));
        gstOutput.push({ id: did(`gst:inv:${inv.key}:${g.gstRate}`), direction: "OUTPUT", invoiceId: id, vendorBillId: null, period, documentDate: D(inv.date), ...g, createdById: uid("fin"), createdAt: T(addDays(inv.date, 2), 5) });
      }
    }
  }

  // ---- Vendors, bills, payments, GST (input) ----------------------------------
  const vendorId = (k) => did(`vendor:${k}`);
  for (const v of VENDORS) {
    add("vendor", {
      id: vendorId(v.key), name: v.name, category: v.category, contactEmail: v.email, contactPhone: v.phone, billingAddress: v.address,
      gstin: v.gstin, servicesOffered: v.services, paymentTerms: v.terms, currency: "INR", bankDetails: v.bank, status: "ACTIVE", createdAt: T("2026-04-02", 5),
    });
    auditCreate("Vendor", v.key, vendorId(v.key), "fin", T("2026-04-02", 5), { name: v.name, category: v.category });
  }
  const gstInput = [];
  for (const b of BILLS) {
    const id = did(`bill:${b.key}`);
    const vendor = VENDORS.find((v) => v.key === b.vendor);
    const priced = b.items.map(([description, amount, taxRate]) => ({ description, amount, taxRate, lineTotal: amount, taxAmount: round2((amount * taxRate) / 100) }));
    const total = round2(priced.reduce((s, l) => s + l.amount + l.taxAmount, 0));
    const paid = round2(b.pays.reduce((s, p) => s + p[1], 0));
    if (b.status === "PAID" && paid !== total) throw new Error(`Bill ${b.key}: paid ${paid} != total ${total}.`);
    if (b.status === "PARTIALLY_PAID" && !(paid > 0 && paid < total)) throw new Error(`Bill ${b.key}: bad partial payment.`);
    const dueDate = addDays(b.date, b.terms);

    const approved = ["APPROVED", "PARTIALLY_PAID", "PAID"].includes(b.status);
    const verified = approved || ["VERIFIED", "PENDING_APPROVAL", "REJECTED"].includes(b.status);
    add("vendorBill", {
      id, billNumber: b.no, vendorId: vendorId(b.vendor), projectId: b.project ? projectId(b.project) : null, billDate: D(b.date), dueDate: D(dueDate),
      poReference: b.po, paymentTerms: vendor.terms, status: b.status, totalAmount: total, currency: "INR", notes: "Demo vendor bill",
      createdById: uid("fin"), verifiedById: verified ? uid("fin") : null, approvedById: approved ? uid("ceo") : null, createdAt: T(b.date, 5),
    });
    priced.forEach((l, i) => add("vendorBillItem", { id: did(`billitem:${b.key}:${i}`), vendorBillId: id, description: l.description, amount: l.amount, taxRate: l.taxRate }));

    auditCreate("VendorBill", b.key, id, "fin", T(b.date, 5), { billNumber: b.no, totalAmount: total, status: "DRAFT" });
    const steps = [];
    const S = (from, to, actor, at, comment) => steps.push({ from, to, actor, at, comment });
    let day = b.date;
    if (b.status !== "DRAFT") S("DRAFT", "PENDING_VERIFICATION", "fin", T(day, 6));
    if (verified) { day = addDays(day, 1); S("PENDING_VERIFICATION", "VERIFIED", "fin", T(day, 5), b.po ? `Checked against ${b.po}.` : "Checked against contract."); }
    if (verified && b.status !== "VERIFIED") { S("VERIFIED", "PENDING_APPROVAL", "fin", T(day, 6)); }
    if (approved) { day = addDays(day, 1); S("PENDING_APPROVAL", "APPROVED", "ceo", T(day, 7)); }
    if (b.status === "REJECTED") { day = addDays(day, 1); S("PENDING_APPROVAL", "REJECTED", "ceo", T(day, 7), b.rejectComment); }
    let current = approved ? "APPROVED" : null;
    b.pays.forEach(([date, amount, ref, payoutKey], i) => {
      const after = round2(b.pays.slice(0, i + 1).reduce((s, p) => s + p[1], 0));
      const to = after >= total ? "PAID" : "PARTIALLY_PAID";
      S(current, to, "fin", T(date, 8), `Payment of ${amount} recorded (${after} of ${total}).`);
      current = to;
      const payId = did(`vendpay:${b.key}:${i}`);
      add("vendorPayment", {
        id: payId, vendorBillId: id, amount, paymentDate: D(date), method: "BANK_TRANSFER", referenceNo: ref,
        note: payoutKey ? `Payout ${did(`payout:${payoutKey}`)} via MOCK.` : null, recordedAt: T(date, 8),
      });
      auditCreate("VendorPayment", `${b.key}:${i}`, payId, "fin", T(date, 8), { billNumber: b.no, amount, referenceNo: ref });
    });
    trail("VendorBill", b.key, id, steps);

    if (approved) {
      for (const g of gstRowsFor(vendor.gstin, priced.map((p) => ({ ...p, lineTotal: p.amount })))) {
        gstInput.push({ id: did(`gst:bill:${b.key}:${g.gstRate}`), direction: "INPUT", invoiceId: null, vendorBillId: id, period: Number(b.date.slice(5, 7)), documentDate: D(b.date), ...g, createdById: uid("fin"), createdAt: T(addDays(b.date, 3), 5) });
      }
    }
  }

  // ---- GST filing periods + transactions ---------------------------------------
  const periodId = (m) => did(`gstperiod:2026-${pad(m)}`);
  for (const [m, status] of Object.entries(GST_PERIODS)) {
    const month = Number(m);
    const filedOn = GST_FILED_ON[month];
    const prepared = ["IN_PREPARATION", "READY", "FILED"].includes(status);
    const preparedAt = prepared ? T(filedOn ? addDays(filedOn, -3) : lastDayOf(2026, month + 1 > 9 ? 9 : month + 1).slice(0, 8) + "10", 5) : null;
    add("gstFilingPeriod", {
      id: periodId(month), periodMonth: month, periodYear: 2026, status,
      preparedById: prepared ? uid("fin") : null, preparedAt,
      filedById: status === "FILED" ? uid("fin") : null, filedAt: status === "FILED" ? T(filedOn, 6) : null,
      createdAt: T(`2026-${pad(month)}-01`, 5),
    });
    const path = { IN_PREPARATION: ["NOT_STARTED>IN_PREPARATION"], READY: ["NOT_STARTED>IN_PREPARATION", "IN_PREPARATION>READY"], FILED: ["NOT_STARTED>IN_PREPARATION", "IN_PREPARATION>READY", "READY>FILED"], NOT_STARTED: [] }[status];
    const steps = path.map((p) => {
      const [from, to] = p.split(">");
      const at = to === "FILED" ? T(filedOn, 6) : T(addDays(filedOn || `2026-${pad(month + 1)}-10`, to === "READY" ? -2 : -4), 5);
      return { from, to, actor: "fin", at };
    });
    trail("GstFilingPeriod", `2026-${pad(month)}`, periodId(month), steps);
  }
  for (const g of [...gstOutput, ...gstInput]) {
    const { period, ...rest } = g;
    add("gstTransaction", { ...rest, filingPeriodId: periodId(period), note: null });
    add("auditLog", {
      id: did(`audit:GstTransaction:${g.id}`), entityType: "GstTransaction", entityId: g.invoiceId || g.vendorBillId, action: "CREATE", performedById: uid("fin"),
      previousValue: null, newValue: { direction: g.direction, gstRate: Number(g.gstRate), taxableAmount: Number(g.taxableAmount) }, note: null, createdAt: g.createdAt,
    });
  }

  // ---- Budgets -------------------------------------------------------------------
  for (const b of BUDGETS) {
    const sum = b.items.reduce((s, i) => s + i[1], 0);
    if (sum !== b.planned) throw new Error(`Budget ${b.key}: items (${sum}) != planned (${b.planned}).`);
    const id = did(`budget:${b.key}`);
    add("budget", {
      id, name: b.name, code: b.code, scope: b.scope, departmentId: b.dept ? deptId[b.dept] : null, projectId: b.project ? projectId(b.project) : null,
      periodLabel: b.period, plannedAmount: b.planned, currency: "INR", status: "ACTIVE", createdAt: T("2026-06-28", 5),
    });
    b.items.forEach(([category, amount], i) => add("budgetItem", { id: did(`budgetitem:${b.key}:${i}`), budgetId: id, category, amount }));
    auditCreate("Budget", b.key, id, "fin", T("2026-06-28", 5), { name: b.name, plannedAmount: b.planned, status: "ACTIVE" });
  }

  // ---- Payroll -------------------------------------------------------------------
  // Apr-Jul PAID, Aug FINALIZED (payouts in flight), Sep PROCESSED (awaiting Finance).
  const RUNS = [
    { m: 4, status: "PAID" }, { m: 5, status: "PAID" }, { m: 6, status: "PAID" }, { m: 7, status: "PAID" },
    { m: 8, status: "FINALIZED" }, { m: 9, status: "PROCESSED" },
  ];
  const AUG_EXCEPTIONS = { ritu: "PENDING", farhan: "FAILED", pooja: "PENDING" }; // everyone else PAID
  for (const r of RUNS) {
    const runId = did(`payrun:2026-${pad(r.m)}`);
    const monthEnd = lastDayOf(2026, r.m);
    const processedAt = T(r.m === 9 ? "2026-09-26" : addDays(monthEnd, -5), 5);
    const finalizedAt = ["FINALIZED", "PAID"].includes(r.status) ? T(addDays(monthEnd, -3), 6) : null;
    add("payrollRun", {
      id: runId, periodMonth: r.m, periodYear: 2026, status: r.status, preparedById: uid("hr"), processedById: uid("hr"), processedAt,
      finalizedById: finalizedAt ? uid("fin") : null, finalizedAt, notes: `Demo payroll - ${r.m}/2026`, createdAt: T(addDays(processedAt.toISOString().slice(0, 10), -1), 5),
    });
    auditCreate("PayrollRun", `2026-${pad(r.m)}`, runId, "hr", T(addDays(processedAt.toISOString().slice(0, 10), -1), 5), { periodMonth: r.m, periodYear: 2026, status: "DRAFT" });
    const steps = [{ from: "DRAFT", to: "PROCESSED", actor: "hr", at: processedAt }];
    if (finalizedAt) steps.push({ from: "PROCESSED", to: "FINALIZED", actor: "fin", at: finalizedAt });
    trail("PayrollRun", `2026-${pad(r.m)}`, runId, steps);

    const eligible = EMPLOYEES.filter((e) => e.join <= monthEnd && ["ACTIVE", "PROBATION", "NOTICE_PERIOD"].includes(e.status));
    for (const e of eligible) {
      const gross = round2(e.comps.filter((c) => c.type === "EARNING").reduce((s, c) => s + c.amount, 0));
      const ded = round2(e.comps.filter((c) => c.type === "DEDUCTION").reduce((s, c) => s + c.amount, 0));
      let payStatus = "PENDING";
      if (r.status === "PAID") payStatus = "PAID";
      if (r.status === "FINALIZED") payStatus = AUG_EXCEPTIONS[e.key] || "PAID";
      const psId = did(`payslip:2026-${pad(r.m)}:${e.key}`);
      const paidAt = payStatus === "PAID" ? T(monthEnd, 7) : null;
      const utr = r.m === 8 && e.key === "empA" ? PAYOUT_UTR.po6 : null;
      add("payslip", {
        id: psId, employeeId: eid(e.key), periodMonth: r.m, periodYear: 2026, grossEarnings: gross, totalDeductions: ded, netSalary: round2(gross - ded),
        paymentStatus: payStatus, generatedAt: processedAt, payrollRunId: runId, paidAt,
        paymentMethod: payStatus === "PAID" ? "BANK_TRANSFER" : null, paymentReferenceNo: payStatus === "PAID" ? utr || `SAL-2026${pad(r.m)}-${e.idx}` : null,
      });
      e.comps.forEach((c, i) => add("payslipLine", { id: did(`payline:2026-${pad(r.m)}:${e.key}:${i}`), payslipId: psId, label: c.label, type: c.type, amount: c.amount }));
      if (payStatus === "PAID" || payStatus === "FAILED") {
        add("auditLog", {
          id: did(`audit:Payslip:2026-${pad(r.m)}:${e.key}`), entityType: "Payslip", entityId: psId, action: "UPDATE", performedById: uid("fin"),
          previousValue: { paymentStatus: "PENDING" }, newValue: { paymentStatus: payStatus, method: "BANK_TRANSFER", netSalary: round2(gross - ded) },
          note: payStatus === "FAILED" ? "Payout failed at bank - beneficiary account temporarily unavailable." : null, createdAt: paidAt || T(monthEnd, 8),
        });
      }
    }
    if (r.status === "PAID") {
      add("auditLog", { id: did(`audit:PayrollRun:2026-${pad(r.m)}:paid`), entityType: "PayrollRun", entityId: runId, action: "UPDATE", performedById: uid("fin"),
        previousValue: { status: "FINALIZED" }, newValue: { status: "PAID" }, note: "All payslips in this run are now marked paid.", createdAt: T(monthEnd, 9) });
    }
  }

  // ---- Payouts (MOCK provider - no money moves, no external call) -----------------
  const payout = (key, o) => add("payout", {
    id: did(`payout:${key}`), currency: "INR", provider: "MOCK", idempotencyKey: `demo-idem-${key}`, initiatedById: uid("fin"), createdAt: o.createdAt, ...o,
  });
  payout("po1", { purpose: "REIMBURSEMENT", reimbursementId: did("reimb:c19"), amount: 5600, status: "PROCESSED", providerPayoutId: "mock_pout_demo_1", providerStatus: "processed",
    utr: PAYOUT_UTR.po1, destinationAccountId: did("payacct:empA"), approvedById: uid("ceo"), approvedAt: T("2026-08-18", 6), processedAt: T("2026-08-19", 6), createdAt: T("2026-08-17", 6) });
  payout("po2", { purpose: "REIMBURSEMENT", reimbursementId: did("reimb:c16"), amount: 1880, status: "AWAITING_APPROVAL", destinationAccountId: did("payacct:empA"), createdAt: T("2026-09-24", 6) });
  payout("po3", { purpose: "VENDOR_PAYMENT", vendorBillId: did("bill:b3"), amount: 60000, status: "PROCESSED", providerPayoutId: "mock_pout_demo_3", providerStatus: "processed",
    utr: PAYOUT_UTR.po3, approvedById: uid("ceo"), approvedAt: T("2026-08-27", 6), processedAt: T("2026-08-28", 8), createdAt: T("2026-08-26", 6) });
  payout("po4", { purpose: "SALARY", payslipId: did("payslip:2026-08:ritu"), amount: payslipNet("ritu"), status: "AWAITING_APPROVAL", destinationAccountId: did("payacct:ritu"), createdAt: T("2026-09-25", 6) });
  payout("po5", { purpose: "SALARY", payslipId: did("payslip:2026-08:farhan"), amount: payslipNet("farhan"), status: "FAILED", providerPayoutId: "mock_pout_demo_5", providerStatus: "failed",
    failureReason: "Beneficiary account temporarily unavailable (simulated by the mock provider).", destinationAccountId: did("payacct:farhan"), approvedById: uid("ceo"), approvedAt: T("2026-08-29", 6), createdAt: T("2026-08-28", 6) });
  payout("po6", { purpose: "SALARY", payslipId: did("payslip:2026-08:empA"), amount: payslipNet("empA"), status: "PROCESSED", providerPayoutId: "mock_pout_demo_6", providerStatus: "processed",
    utr: PAYOUT_UTR.po6, destinationAccountId: did("payacct:empA"), approvedById: uid("ceo"), approvedAt: T("2026-08-30", 6), processedAt: T("2026-08-31", 7), createdAt: T("2026-08-29", 6) });
  for (const p of rows.payout) {
    add("auditLog", { id: did(`audit:Payout:${p.id}`), entityType: "Payout", entityId: p.id, action: "CREATE", performedById: uid("fin"),
      previousValue: null, newValue: { purpose: p.purpose, amount: Number(p.amount), status: "AWAITING_APPROVAL" }, note: null, createdAt: p.createdAt });
    if (p.status !== "AWAITING_APPROVAL") {
      add("auditLog", { id: did(`audit:Payout:${p.id}:final`), entityType: "Payout", entityId: p.id, action: p.status === "FAILED" ? "UPDATE" : "APPROVE", performedById: uid("ceo"),
        previousValue: { status: "AWAITING_APPROVAL" }, newValue: { status: p.status }, note: p.failureReason || null, createdAt: p.approvedAt || p.createdAt });
    }
  }
}

const PAYOUT_UTR = { po1: "DEMO-UTR-0001", po3: "DEMO-UTR-0002", po6: "DEMO-UTR-0006" };
const payslipNet = (k) => {
  const c = EMP[k].comps;
  return round2(c.filter((x) => x.type === "EARNING").reduce((s, x) => s + x.amount, 0) - c.filter((x) => x.type === "DEDUCTION").reduce((s, x) => s + x.amount, 0));
};

function salaryComponents(gross) {
  const basic = Math.round(gross * 0.5);
  const hra = Math.round(gross * 0.2);
  const special = gross - basic - hra;
  const tdsPct = gross >= 250000 ? 0.15 : gross >= 150000 ? 0.1 : gross >= 100000 ? 0.06 : gross >= 80000 ? 0.03 : 0;
  const comps = [
    { label: "Basic Salary", type: "EARNING", amount: basic },
    { label: "House Rent Allowance", type: "EARNING", amount: hra },
    { label: "Special Allowance", type: "EARNING", amount: special },
    { label: "Provident Fund (Employee)", type: "DEDUCTION", amount: 1800 },
    { label: "Professional Tax", type: "DEDUCTION", amount: 200 },
  ];
  if (tdsPct > 0) comps.push({ label: "Income Tax (TDS)", type: "DEDUCTION", amount: round2(gross * tdsPct) });
  return comps;
}

/** The approval trail for a claim, following the app's own transitions. */
function buildClaimTrail(c, owner) {
  const steps = [];
  const S = (from, to, actor, at, comment) => steps.push({ from, to, actor, at, comment });
  if (c.status === "DRAFT") return steps;
  const reviewer = REVIEWER[owner];
  const submitDay = addDays(c.date, 1);
  S("DRAFT", "SUBMITTED", owner, T(submitDay, 5));
  if (c.status === "SUBMITTED") return steps;
  if (c.status === "CANCELLED") { S("SUBMITTED", "CANCELLED", owner, T(addDays(submitDay, 1), 5), "Withdrawn by employee."); return steps; }
  const mgrDay = addDays(submitDay, 1);
  if (c.status === "MANAGER_REJECTED") { S("SUBMITTED", "MANAGER_REJECTED", reviewer, T(mgrDay, 5), c.mgrComment); return steps; }
  if (c.status === "RETURNED") { S("SUBMITTED", "RETURNED", reviewer, T(mgrDay, 5), c.mgrComment); return steps; }
  S("SUBMITTED", "MANAGER_APPROVED", reviewer, T(mgrDay, 5), c.mgrComment);
  if (c.status === "MANAGER_APPROVED") return steps;
  const finDay = addDays(mgrDay, 1);
  const finActor = owner === "fin" ? "ceo" : "fin";
  if (c.status === "FINANCE_REJECTED") { S("MANAGER_APPROVED", "FINANCE_REJECTED", finActor, T(finDay, 6), c.finComment); return steps; }
  S("MANAGER_APPROVED", "REIMBURSEMENT_PENDING", finActor, T(finDay, 6), c.finComment);
  if (c.status === "REIMBURSEMENT_PENDING") return steps;
  S("REIMBURSEMENT_PENDING", "PAID", finActor, T(c.paid.date, 6));
  return steps;
}

/** CGST+SGST for an intra-state counterparty, IGST otherwise (mirrors src/utils/gst.js). */
function gstRowsFor(counterpartyGstin, pricedItems) {
  const companyState = stateOf(COMPANY_GSTIN);
  const otherState = stateOf(counterpartyGstin);
  if (!companyState || !otherState) return [];
  const byRate = new Map();
  for (const it of pricedItems) {
    if (!(it.taxRate > 0) || !(it.taxAmount > 0)) continue;
    const e = byRate.get(it.taxRate) || { taxable: 0, tax: 0 };
    e.taxable = round2(e.taxable + it.lineTotal);
    e.tax = round2(e.tax + it.taxAmount);
    byRate.set(it.taxRate, e);
  }
  return [...byRate.entries()].map(([gstRate, g]) => {
    if (companyState !== otherState) return { gstRate, taxableAmount: g.taxable, cgstAmount: 0, sgstAmount: 0, igstAmount: g.tax };
    const half = round2(g.tax / 2);
    return { gstRate, taxableAmount: g.taxable, cgstAmount: round2(g.tax - half), sgstAmount: half, igstAmount: 0 };
  });
}

// ---------------------------------------------------------------------------
// Receipt placeholder files (local uploads/ folder, git-ignored)
// ---------------------------------------------------------------------------

function receiptPdf(text) {
  const safe = text.replace(/[()\\]/g, " ");
  const stream = `BT /F1 12 Tf 20 100 Td (${safe}) Tj ET`;
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 700 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function writeReceiptFile(storageKey, bytes) {
  const dir = path.resolve(process.cwd(), "uploads", "receipts");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, storageKey);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

// Dependency order (parents before children).
const INSERT_ORDER = [
  "user", "employee", "salaryStructure", "salaryComponent", "employeePayoutAccount",
  "client", "project", "projectMilestone", "projectMember",
  "expenseClaim", "expenseReceipt", "reimbursement",
  "invoice", "invoiceLineItem", "clientPayment",
  "vendor", "vendorBill", "vendorBillItem", "vendorPayment",
  "gstFilingPeriod", "gstTransaction", "budget", "budgetItem",
  "payrollRun", "payslip", "payslipLine", "payout",
  "approvalStep", "auditLog",
];

async function ensureReferenceData() {
  // Permissions / roles / departments / categories may already exist from
  // prisma/seed.js. Look up by their natural key; create only what is missing.
  const permCodes = [...new Set(Object.values(ROLE_DEFINITIONS).flat())];
  const perms = await prisma.permission.findMany({ where: { code: { in: permCodes } } });
  const permByCode = Object.fromEntries(perms.map((p) => [p.code, p.id]));
  const missingPerms = permCodes.filter((c) => !permByCode[c]);
  if (missingPerms.length) {
    await prisma.permission.createMany({ data: missingPerms.map((code) => ({ id: did(`perm:${code}`), code, label: code })), skipDuplicates: true });
    (await prisma.permission.findMany({ where: { code: { in: missingPerms } } })).forEach((p) => (permByCode[p.code] = p.id));
  }

  const roleId = {};
  for (const [name, codes] of Object.entries(ROLE_DEFINITIONS)) {
    let role = await prisma.role.findUnique({ where: { name } });
    if (!role) role = await prisma.role.create({ data: { id: did(`role:${name}`), name } });
    roleId[name] = role.id;
    // Additive only: add any permission the role lacks; never remove or change.
    await prisma.rolePermission.createMany({ data: codes.map((code) => ({ roleId: role.id, permissionId: permByCode[code] })), skipDuplicates: true });
  }

  const deptId = {};
  for (const d of DEPARTMENTS) {
    let dept = await prisma.department.findUnique({ where: { name: d.name } });
    if (!dept) dept = await prisma.department.create({ data: { id: did(`dept:${d.name}`), name: d.name, code: d.code } });
    deptId[d.name] = dept.id;
  }

  const wanted = [...new Set(CLAIMS.map((c) => c.cat))];
  const categoryId = {};
  for (const name of wanted) {
    let cat = await prisma.expenseCategory.findUnique({ where: { name } });
    if (!cat) cat = await prisma.expenseCategory.create({ data: { id: did(`cat:${name}`), name, softLimit: 2000, hardLimit: 10000 } });
    categoryId[name] = cat.id;
  }
  return { roleId, deptId, categoryId };
}

async function main() {
  console.log("Demo seed target");
  console.log(`  endpoint : ${target.endpointId}  (db "${target.database}")`);
  console.log(`  source   : ${target.usingDedicatedVar ? "DEMO_DATABASE_URL" : "DATABASE_URL (confirmed via DEMO_SEED_CONFIRM)"}`);
  if (!COMPANY_GSTIN) console.warn("  WARNING: COMPANY_GSTIN is not set - GST transactions cannot be derived, so none will be created.");

  await assertLooksLikeTestBranch();
  console.log("  safety   : no non-demo business records found - proceeding (additive inserts only)");

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const ref = await ensureReferenceData();
  await build({ ...ref, passwordHash });

  console.log("\nInserting (createMany + skipDuplicates; existing rows are left untouched):");
  const summary = [];
  for (const model of INSERT_ORDER) {
    const data = rows[model] || [];
    if (data.length === 0) continue;
    const res = await prisma[model].createMany({ data, skipDuplicates: true });
    summary.push([model, data.length, res.count]);
    console.log(`  ${model.padEnd(24)} defined ${String(data.length).padStart(4)}   newly created ${String(res.count).padStart(4)}`);
  }
  const unknown = Object.keys(rows).filter((m) => !INSERT_ORDER.includes(m));
  if (unknown.length) throw new Error(`Models built but not inserted: ${unknown.join(", ")}`);

  const created = summary.reduce((s, r) => s + r[2], 0);
  console.log(`\nDone. ${created} new row(s) created${created === 0 ? " (dataset was already present - rerun is a no-op)" : ""}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
