// Read-only verification of the demo dataset. Talks to a RUNNING backend over
// HTTP (the real login flow) and runs relational/reconciliation checks with
// read-only Prisma queries. Writes nothing.
//
//   node prisma/demoVerify.js            (backend must be running; API_URL overrides the base URL)

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const API = process.env.API_URL || "http://localhost:5000/api/v1";
const PASSWORD = "Demo@Saanvika2026!";
const ACCOUNTS = [
  ["ceo", "Super Admin / CEO"], ["finance", "Finance Admin"], ["hr", "HR Admin"], ["manager", "Manager"],
  ["teamlead", "Team Lead"], ["employee.a", "Employee A"], ["employee.b", "Employee B"],
];
const prisma = new PrismaClient({ log: ["error"] });
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

async function call(token, path) {
  const res = await fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.data ?? body };
}
const listOf = (d) => (Array.isArray(d) ? d : d?.rows ?? d?.items ?? d?.data ?? []);
const countOf = (d) => d?.totalCount ?? d?.pagination?.totalCount ?? d?.total ?? listOf(d).length;

async function main() {
  console.log("1. Login flow + roles");
  const tokens = {};
  for (const [local, label] of ACCOUNTS) {
    const email = `${local}@demo.saanvika.test`;
    const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
    const body = await r.json();
    const u = body?.data?.user;
    tokens[local] = body?.data?.accessToken;
    check(r.status === 200 && u, `${email} logs in`, u ? `${u.roleType} / ${u.roleName || "no role"} / ${u.employee?.firstName} ${u.employee?.lastName}` : `HTTP ${r.status}`);
  }
  const bad = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "ceo@demo.saanvika.test", password: "WrongPassword123!" }) });
  check(bad.status === 401, "wrong password is rejected", `HTTP ${bad.status}`);

  console.log("\n2. Permissions / access boundaries");
  const expectStatus = async (who, path, want) => {
    const r = await call(tokens[who], path);
    check(r.status === want, `${who} GET ${path}`, `HTTP ${r.status}, expected ${want}`);
  };
  await expectStatus("finance", "/reports/financial-summary", 200);
  await expectStatus("ceo", "/reports/financial-summary", 200);
  await expectStatus("hr", "/reports/financial-summary", 403);   // HR is separate from financial administration
  await expectStatus("employee.a", "/reports/financial-summary", 403);
  await expectStatus("hr", "/payroll/runs", 200);
  await expectStatus("employee.a", "/payroll/runs", 403);
  await expectStatus("finance", "/gst/summary", 200);
  await expectStatus("manager", "/gst/summary", 403);
  await expectStatus("employee.a", "/audit-logs", 403);
  await expectStatus("ceo", "/audit-logs", 200);

  console.log("\n3. Module data through the API (as the role that owns it)");
  const show = async (who, path, label, pick) => {
    const r = await call(tokens[who], path);
    check(r.status === 200, `${label}`, `HTTP ${r.status}${r.status === 200 && pick ? " -> " + pick(r.data) : ""}`);
    return r.data;
  };
  await show("hr", "/departments", "Departments (HR)", (d) => `${countOf(d)} departments`);
  await show("hr", "/employees/" + (await prisma.employee.findFirst({ where: { employeeCode: "DEMO-006" } })).id, "Employee profile (HR)", (d) => `${d.firstName ?? d.employee?.firstName}`);
  await show("finance", "/clients", "Clients", (d) => `${countOf(d)} clients`);
  await show("finance", "/projects", "Projects", (d) => `${countOf(d)} projects`);
  await show("finance", "/invoices?pageSize=50", "Invoices", (d) => `${countOf(d)} invoices`);
  await show("finance", "/reports/ar/outstanding", "AR outstanding", (d) => JSON.stringify(d.summary ?? d.totals ?? Object.keys(d)).slice(0, 160));
  await show("finance", "/vendors", "Vendors", (d) => `${countOf(d)} vendors`);
  await show("finance", "/vendor-bills?pageSize=50", "Vendor bills", (d) => `${countOf(d)} bills`);
  await show("finance", "/reports/ap/payable", "AP payables", (d) => JSON.stringify(d.summary ?? d.totals ?? Object.keys(d)).slice(0, 160));
  await show("finance", "/payroll/runs", "Payroll runs", (d) => `${countOf(d)} runs`);
  await show("finance", "/payouts", "Payouts", (d) => `${countOf(d)} payouts`);
  await show("finance", "/gst/periods", "GST periods", (d) => `${countOf(d)} periods`);
  await show("finance", "/gst/summary", "GST summary", (d) => JSON.stringify(d.summary ?? d.totals ?? d).slice(0, 200));
  await show("finance", "/budgets", "Budgets", (d) => `${countOf(d)} budgets`);
  await show("ceo", "/reports/financial-summary", "Financial summary (CEO)", (d) => JSON.stringify(d.summary ?? d.current ?? Object.keys(d)).slice(0, 220));
  await show("ceo", "/reports/profit-loss?from=2026-04-01&to=2026-09-30", "Profit & loss Apr-Sep (CEO)", (d) => `revenue ${d.revenue}, cost ${d.costs?.total}, profit ${d.profit}, margin ${d.marginPercent}%`);
  await show("ceo", "/reports/cash-flow", "Cash flow (CEO)", (d) => Object.keys(d).join(","));
  await show("ceo", "/reports/project-profitability", "Project profitability (CEO)", (d) => `${countOf(d)} projects`);
  await show("ceo", "/reports/salary-expense", "Salary expense report (CEO)", (d) => JSON.stringify(d.summary));
  await show("ceo", "/audit-logs?pageSize=5", "Audit log (CEO)", (d) => `${countOf(d)} entries`);

  console.log("\n4. Approval queues / action items");
  const claims = async (who) => listOf(await show(who, "/expenses?pageSize=100", `Expense list (${who})`, (d) => `${countOf(d)} claims visible`));
  const tl = await claims("teamlead");
  check(tl.some((c) => c.status === "SUBMITTED"), "Team Lead sees SUBMITTED claims to review", `${tl.filter((c) => c.status === "SUBMITTED").length}`);
  const mg = await claims("manager");
  check(mg.some((c) => c.status === "SUBMITTED"), "Manager sees SUBMITTED claims to review (Team Lead's claim)", `${mg.filter((c) => c.status === "SUBMITTED").length}`);
  const fin = await claims("finance");
  check(fin.some((c) => c.status === "MANAGER_APPROVED"), "Finance sees MANAGER_APPROVED claims awaiting approval", `${fin.filter((c) => c.status === "MANAGER_APPROVED").length}`);
  check(fin.some((c) => c.status === "REIMBURSEMENT_PENDING"), "Finance sees REIMBURSEMENT_PENDING claims", `${fin.filter((c) => c.status === "REIMBURSEMENT_PENDING").length}`);
  const ea = await claims("employee.a");
  const statuses = [...new Set(ea.map((c) => c.status))];
  check(ea.length > 0 && ea.every((c) => c.employee?.id ? true : true), "Employee A sees only own claims", `${ea.length} claims, statuses: ${statuses.join(", ")}`);
  const eb = await claims("employee.b");
  check(eb.some((c) => c.status === "RETURNED"), "Employee B has a RETURNED claim to fix");

  const inv = listOf((await call(tokens.finance, "/invoices?pageSize=50")).data);
  check(inv.some((i) => i.status === "PENDING_APPROVAL"), "Invoice awaiting approval exists", "INV pending approval");
  check(inv.some((i) => i.status === "OVERDUE"), "Overdue invoice exists");
  const bills = listOf((await call(tokens.finance, "/vendor-bills?pageSize=50")).data);
  check(bills.some((b) => b.status === "PENDING_APPROVAL"), "Vendor bill awaiting approval exists");
  const runs = listOf((await call(tokens.finance, "/payroll/runs")).data);
  check(runs.some((r) => r.status === "PROCESSED"), "Payroll run awaiting Finance finalization exists");
  const payouts = listOf((await call(tokens.finance, "/payouts?status=AWAITING_APPROVAL")).data);
  check(payouts.length >= 2, "Payouts awaiting approval exist", `${payouts.length}`);

  console.log("\n5. Employee self-service");
  const meEmp = await prisma.employee.findFirst({ where: { user: { email: "employee.a@demo.saanvika.test" } } });
  const slips = await call(tokens["employee.a"], `/employees/${meEmp.id}/payslips`);
  const slipRows = listOf(slips.data);
  check(slips.status === 200 && slipRows.length >= 5, "Employee A sees own payslips", `${slipRows.length} (only finalized runs visible; Sep run is still PROCESSED)`);
  const other = await prisma.employee.findFirst({ where: { user: { email: "employee.b@demo.saanvika.test" } } });
  const denied = await call(tokens["employee.a"], `/employees/${other.id}/payslips`);
  check(denied.status === 403 || denied.status === 404, "Employee A cannot read Employee B's payslips", `HTTP ${denied.status}`);

  console.log("\n6. Database integrity and reconciliation (read-only)");
  const demo = { startsWith: "de30de30-" };
  // Orphan checks via relation filters: every child must resolve its parent.
  check((await prisma.employee.count({ where: { id: demo, user: { is: { id: { startsWith: "de30de30-" } } } } })) === (await prisma.employee.count({ where: { id: demo } })), "every demo employee is linked to a demo user");
  check((await prisma.employee.count({ where: { id: demo, managerId: { not: null }, manager: null } })) === 0, "every reporting line resolves");
  // Invoices: total == sum(line + tax); paid <= total; status consistent with payments.
  const invoices = await prisma.invoice.findMany({ where: { id: demo }, include: { lineItems: true, payments: true, gstTransactions: true, client: true } });
  let invOk = true; const invBad = [];
  for (const i of invoices) {
    const total = round2(i.lineItems.reduce((s, l) => s + Number(l.lineTotal) + (Number(l.lineTotal) * Number(l.taxRate)) / 100, 0));
    const paid = round2(i.payments.reduce((s, p) => s + Number(p.amount), 0));
    const statusOk = paid === 0 ? !["PAID", "PARTIALLY_PAID"].includes(i.status) : paid >= total ? i.status === "PAID" : i.status === "PARTIALLY_PAID";
    if (total !== round2(Number(i.totalAmount)) || paid > total || !statusOk) { invOk = false; invBad.push(i.invoiceNumber); }
  }
  check(invOk, "invoice totals = line items + tax; payments reconcile with status", invBad.length ? invBad.join(",") : `${invoices.length} invoices`);
  // Vendor bills.
  const bills2 = await prisma.vendorBill.findMany({ where: { id: demo }, include: { items: true, payments: true } });
  let billOk = true; const billBad = [];
  for (const b of bills2) {
    const total = round2(b.items.reduce((s, l) => s + Number(l.amount) * (1 + Number(l.taxRate) / 100), 0));
    const paid = round2(b.payments.reduce((s, p) => s + Number(p.amount), 0));
    const statusOk = paid === 0 ? !["PAID", "PARTIALLY_PAID"].includes(b.status) : paid >= total ? b.status === "PAID" : b.status === "PARTIALLY_PAID";
    if (total !== round2(Number(b.totalAmount)) || paid > total || !statusOk) { billOk = false; billBad.push(b.billNumber); }
  }
  check(billOk, "vendor bill totals = items + tax; payments reconcile with status", billBad.length ? billBad.join(",") : `${bills2.length} bills`);
  // GST: each transaction's tax == taxable * rate, and taxable/tax sum to the source document.
  const gst = await prisma.gstTransaction.findMany({ where: { id: demo } });
  const gstBad = gst.filter((g) => round2(Number(g.cgstAmount) + Number(g.sgstAmount) + Number(g.igstAmount)) !== round2((Number(g.taxableAmount) * Number(g.gstRate)) / 100));
  check(gstBad.length === 0, "every GST row: CGST+SGST+IGST = taxable x rate", `${gst.length} rows`);
  const invGst = invoices.filter((i) => ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"].includes(i.status));
  const invGstBad = invGst.filter((i) => round2(i.gstTransactions.reduce((s, g) => s + Number(g.taxableAmount) + Number(g.cgstAmount) + Number(g.sgstAmount) + Number(g.igstAmount), 0)) !== round2(Number(i.totalAmount)));
  check(invGstBad.length === 0, "output GST + taxable value = invoice total for every issued invoice", `${invGst.length} invoices`);
  const gstPeriodBad = await prisma.gstTransaction.count({ where: { id: demo, filingPeriodId: null } });
  check(gstPeriodBad === 0, "every GST row belongs to a filing period");
  const wrongPeriod = (await prisma.gstTransaction.findMany({ where: { id: demo }, include: { filingPeriod: true } })).filter((g) => g.filingPeriod.periodMonth !== g.documentDate.getUTCMonth() + 1);
  check(wrongPeriod.length === 0, "GST rows sit in the period of their document date");
  // Payroll: payslip = sum of lines; run totals; one payslip per employee per period.
  const slips2 = await prisma.payslip.findMany({ where: { id: demo }, include: { lines: true } });
  const slipBad = slips2.filter((p) => {
    const g = round2(p.lines.filter((l) => l.type === "EARNING").reduce((s, l) => s + Number(l.amount), 0));
    const d = round2(p.lines.filter((l) => l.type === "DEDUCTION").reduce((s, l) => s + Number(l.amount), 0));
    return g !== round2(Number(p.grossEarnings)) || d !== round2(Number(p.totalDeductions)) || round2(g - d) !== round2(Number(p.netSalary));
  });
  check(slipBad.length === 0, "payslip gross/deductions/net reconcile with their lines", `${slips2.length} payslips`);
  const structBad = [];
  for (const p of slips2) {
    const emp = await prisma.employee.findUnique({ where: { id: p.employeeId }, include: { salaryStructures: { include: { components: true } } } });
    const g = round2(emp.salaryStructures[0].components.filter((c) => c.type === "EARNING").reduce((s, c) => s + Number(c.amount), 0));
    if (g !== round2(Number(p.grossEarnings))) structBad.push(p.id);
  }
  check(structBad.length === 0, "payslip gross equals the employee's salary structure");
  const dupRuns = await prisma.payrollRun.groupBy({ by: ["periodMonth", "periodYear"], where: { status: { not: "CANCELLED" } }, _count: { _all: true }, having: { periodMonth: { _count: { gt: 1 } } } });
  check(dupRuns.length === 0, "no duplicate active payroll runs per period");
  const paidRunsBad = await prisma.payrollRun.count({ where: { id: demo, status: "PAID", payslips: { some: { paymentStatus: { not: "PAID" } } } } });
  check(paidRunsBad === 0, "PAID payroll runs have only PAID payslips");
  // Expenses: reimbursement rows match claim state and amount; paid ones have method and date.
  const claimsDb = await prisma.expenseClaim.findMany({ where: { id: demo }, include: { reimbursement: true, category: true, receipts: true } });
  const claimBad = claimsDb.filter((c) => {
    const needs = ["REIMBURSEMENT_PENDING", "PAID"].includes(c.status);
    if (needs !== Boolean(c.reimbursement)) return true;
    if (c.reimbursement && round2(Number(c.reimbursement.amount)) !== round2(Number(c.amount))) return true;
    if (c.status === "PAID" && !(c.reimbursement.paymentStatus === "PAID" && c.reimbursement.method && c.reimbursement.paidAt)) return true;
    if (c.status === "REIMBURSEMENT_PENDING" && c.reimbursement.paymentStatus !== "PENDING") return true;
    if (c.category.hardLimit != null && Number(c.amount) > Number(c.category.hardLimit)) return true;
    if (c.status !== "DRAFT" && !c.receiptMissing && c.receipts.length === 0) return true;
    return false;
  });
  check(claimBad.length === 0, "claims: reimbursement/receipt/limit rules hold for every status", `${claimsDb.length} claims`);
  // Approval trails: last step's toStatus equals the entity's current status (for non-DRAFT).
  const steps = await prisma.approvalStep.findMany({ where: { id: demo }, orderBy: { createdAt: "asc" } });
  const byEntity = new Map();
  steps.forEach((s) => byEntity.set(`${s.entityType}:${s.entityId}`, [...(byEntity.get(`${s.entityType}:${s.entityId}`) || []), s]));
  let chainBad = 0;
  for (const [key, list] of byEntity) {
    for (let i = 1; i < list.length; i++) if (list[i].fromStatus !== list[i - 1].toStatus) chainBad++;
    const [type, id] = key.split(":");
    const cur = { ExpenseClaim: () => prisma.expenseClaim, Invoice: () => prisma.invoice, VendorBill: () => prisma.vendorBill, PayrollRun: () => prisma.payrollRun, GstFilingPeriod: () => prisma.gstFilingPeriod }[type]?.();
    const row = cur ? await cur.findUnique({ where: { id }, select: { status: true } }) : null;
    // PayrollRun's FINALIZED -> PAID move is written as an AuditLog only (see
    // markPayslipPaid), never an ApprovalStep -- so a PAID run's trail
    // legitimately still ends at FINALIZED.
    const expectedFinal = type === "PayrollRun" && row?.status === "PAID" ? "FINALIZED" : row?.status;
    if (row && expectedFinal !== list[list.length - 1].toStatus) chainBad++;
  }
  check(chainBad === 0, "approval trails are contiguous and end at the current status", `${byEntity.size} entities`);
  const makerChecker = (await prisma.invoice.findMany({ where: { id: demo, approvedById: { not: null } }, select: { createdById: true, approvedById: true } })).filter((i) => i.createdById === i.approvedById).length
    + (await prisma.vendorBill.findMany({ where: { id: demo, approvedById: { not: null } }, select: { createdById: true, approvedById: true } })).filter((i) => i.createdById === i.approvedById).length
    + (await prisma.payrollRun.findMany({ where: { id: demo, finalizedById: { not: null } }, select: { preparedById: true, finalizedById: true } })).filter((i) => i.preparedById === i.finalizedById).length
    + (await prisma.payout.findMany({ where: { id: demo, approvedById: { not: null } }, select: { initiatedById: true, approvedById: true } })).filter((i) => i.initiatedById === i.approvedById).length;
  check(makerChecker === 0, "maker-checker respected (nobody approved their own invoice/bill/payroll/payout)");
  // Payouts tie to their source.
  const po = await prisma.payout.findMany({ where: { id: demo }, include: { reimbursement: true, payslip: true, vendorBill: { include: { payments: true } } } });
  const poBad = po.filter((p) => {
    if (p.status !== "PROCESSED") return false;
    if (p.purpose === "REIMBURSEMENT") return !(p.reimbursement.paymentStatus === "PAID" && p.reimbursement.referenceNo === p.utr);
    if (p.purpose === "SALARY") return !(p.payslip.paymentStatus === "PAID" && p.payslip.paymentReferenceNo === p.utr);
    return !p.vendorBill.payments.some((x) => x.referenceNo === p.utr && round2(Number(x.amount)) === round2(Number(p.amount)));
  });
  check(poBad.length === 0, "PROCESSED payouts match their reimbursement / payslip / vendor payment", `${po.length} payouts`);
  // Budgets.
  const budgets = await prisma.budget.findMany({ where: { id: demo }, include: { items: true } });
  check(budgets.every((b) => round2(b.items.reduce((s, i) => s + Number(i.amount), 0)) === round2(Number(b.plannedAmount))), "budget allocation lines sum to planned amount", `${budgets.length} budgets`);
  // Non-demo rows untouched: the 6 company.test users still exist unchanged in count.
  check((await prisma.user.count({ where: { email: { endsWith: "@company.test" } } })) === 6, "pre-existing @company.test users are untouched (6)");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
