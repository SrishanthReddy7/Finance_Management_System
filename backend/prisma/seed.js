// Seeds: permission codes (FRS Section 30), a handful of Roles, and a small
// fake org with a real managerId chain so hierarchy/salary-visibility logic
// has real data to be tested against (per FRS Section 39, Step 1).
//
// Run with: npm run seed

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PERMISSION_CODES = [
  ["CREATE_ADMIN", "Create Admin users"],
  ["CREATE_EMPLOYEE", "Create Employee/User accounts"],
  ["MANAGE_USERS", "Activate/deactivate/update users"],
  ["VIEW_EMPLOYEE", "View employee directory"],
  ["VIEW_TEAM_SALARY", "View salary of subordinates"],
  ["VIEW_COMPANY_SALARY", "View salary of any employee (HR/Finance override)"],
  ["MANAGE_SALARY", "Create/update salary structures"],
  ["APPROVE_EXPENSE", "Manager-level expense approval"],
  ["VERIFY_EXPENSE", "Finance-level expense verification/approval"],
  ["PROCESS_REIMBURSEMENT", "Mark reimbursement as paid"],
  ["MANAGE_CLIENTS", "CRUD clients"],
  ["MANAGE_PROJECTS", "CRUD projects, allocate members"],
  ["CREATE_INVOICE", "Create/edit/send invoices"],
  ["APPROVE_INVOICE", "Approve/cancel invoices"],
  ["RECORD_CLIENT_PAYMENT", "Record client payments"],
  ["MANAGE_VENDORS", "CRUD vendors and vendor bills"],
  ["VERIFY_VENDOR_BILL", "Verify vendor bills"],
  ["APPROVE_VENDOR_BILL", "Approve vendor bills"],
  ["RECORD_VENDOR_PAYMENT", "Record vendor payments"],
  ["VIEW_GST", "View GST transactions/summaries"],
  ["PREPARE_GST_FILING", "Move a GST period to Ready"],
  ["SUBMIT_GST_FILING", "Mark a GST period Filed"],
  ["MANAGE_BUDGETS", "CRUD budgets"],
  // Payroll's maker-checker: MANAGE_SALARY prepares/processes a run,
  // APPROVE_PAYROLL finalizes it -- deliberately separate from MANAGE_SALARY
  // so two different people are required, enforced in the service by
  // comparing the finalizer against the run's own preparedById.
  ["APPROVE_PAYROLL", "Finalize a processed payroll run"],
  // Payment Gateway Stage 10 (Stage 8 design, approved): refund initiation is
  // its own permission, distinct from RECORD_CLIENT_PAYMENT -- releasing
  // money back out is a different-risk operation than recording money coming
  // in, same reasoning the FRS already applies to invoice/vendor-bill
  // approval. APPROVE_REFUND is the maker-checker "submit to Razorpay" step
  // (Stage 10 correction) -- deliberately separate from INITIATE_REFUND;
  // the service layer additionally requires the two actors to differ, same
  // maker-checker precedent as APPROVE_PAYROLL/MANAGE_SALARY and vendor-bill
  // creator-!=-approver.
  ["INITIATE_REFUND", "Request a refund against a client payment"],
  ["APPROVE_REFUND", "Approve and submit a requested refund to Razorpay"],
  // Payout Subsystem Step 2: same maker-checker split as
  // INITIATE_REFUND/APPROVE_REFUND, applied to the money-out side --
  // creating a payout (INITIATE_PAYOUT) and approving/rejecting/cancelling/
  // retrying it (APPROVE_PAYOUT) are deliberately separate permissions; the
  // service layer additionally requires the two actors to differ, same
  // precedent as every other maker-checker pair in this codebase.
  // MANAGE_PAYOUT_ACCOUNTS is separate again -- adding/replacing an
  // employee's bank/UPI destination is a data-entry action, not a
  // money-movement approval, so it gets its own narrower permission rather
  // than riding on either payout permission.
  ["INITIATE_PAYOUT", "Create a payout (reimbursement, salary, or vendor bill)"],
  ["APPROVE_PAYOUT", "Approve, reject, cancel, or retry a payout"],
  ["VIEW_PAYOUT", "View payouts"],
  ["MANAGE_PAYOUT_ACCOUNTS", "Add/replace an employee's payout (bank/UPI) account"],
  ["VIEW_FINANCIAL_REPORTS", "View company-wide financial reports"],
  ["VIEW_AUDIT_LOGS", "View the audit trail"],
];

const ROLE_DEFINITIONS = {
  "Team Lead": ["VIEW_EMPLOYEE", "VIEW_TEAM_SALARY", "APPROVE_EXPENSE"],
  // MANAGE_CLIENTS sits with the CEO (SUPER_ADMIN, which bypasses permission
  // checks outright) and Managers -- a Manager owning project delivery also
  // owns the client record behind it. Finance Admin keeps it too, per FRS 31
  // ("Clients: Admin/Finance").
  "Manager": ["VIEW_EMPLOYEE", "VIEW_TEAM_SALARY", "APPROVE_EXPENSE", "MANAGE_PROJECTS", "MANAGE_CLIENTS"],
  "Finance Admin": [
    "VIEW_EMPLOYEE",
    "VIEW_COMPANY_SALARY",
    "MANAGE_SALARY",
    "VERIFY_EXPENSE",
    "PROCESS_REIMBURSEMENT",
    "MANAGE_CLIENTS",
    "CREATE_INVOICE",
    "APPROVE_INVOICE",
    "RECORD_CLIENT_PAYMENT",
    "MANAGE_VENDORS",
    "VERIFY_VENDOR_BILL",
    "APPROVE_VENDOR_BILL",
    "RECORD_VENDOR_PAYMENT",
    "VIEW_GST",
    "PREPARE_GST_FILING",
    "SUBMIT_GST_FILING",
    "MANAGE_BUDGETS",
    "APPROVE_PAYROLL",
    "INITIATE_REFUND",
    "APPROVE_REFUND",
    "INITIATE_PAYOUT",
    "APPROVE_PAYOUT",
    "VIEW_PAYOUT",
    "MANAGE_PAYOUT_ACCOUNTS",
    "VIEW_FINANCIAL_REPORTS",
  ],
  "HR Admin": ["VIEW_EMPLOYEE", "VIEW_COMPANY_SALARY", "MANAGE_SALARY", "CREATE_EMPLOYEE", "MANAGE_USERS"],
};

async function upsertPermissions() {
  const permissions = {};
  for (const [code, label] of PERMISSION_CODES) {
    permissions[code] = await prisma.permission.upsert({
      where: { code },
      update: { label },
      create: { code, label },
    });
  }
  return permissions;
}

async function upsertRoles(permissions) {
  const roles = {};
  for (const [roleName, codes] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    for (const code of codes) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permissions[code].id } },
        update: {},
        create: { roleId: role.id, permissionId: permissions[code].id },
      });
    }
    roles[roleName] = role;
  }
  return roles;
}

async function createUserWithEmployee({ email, password, roleType, roleId, firstName, lastName, designation, employeeCode, departmentId, managerId, createdById }) {
  const passwordHash = await bcrypt.hash(password, 12);

  // Upsert, not create: this script gets re-run constantly during development,
  // and a plain create dies on the unique email the second time round.
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, roleType, roleId: roleId || null, status: "ACTIVE" },
    create: {
      email,
      passwordHash,
      roleType,
      roleId: roleId || null,
      status: "ACTIVE",
      createdById: createdById || null,
    },
  });

  // employeeCode is required + unique on Employee, so it must be supplied here.
  const employee = await prisma.employee.upsert({
    where: { userId: user.id },
    update: {
      firstName,
      lastName,
      designation,
      employeeCode,
      departmentId: departmentId || null,
      managerId: managerId || null,
    },
    create: {
      userId: user.id,
      firstName,
      lastName,
      designation,
      employeeCode,
      departmentId: departmentId || null,
      managerId: managerId || null,
      dateOfJoining: new Date(),
    },
  });

  return { ...user, employee };
}

async function main() {
  console.log("Seeding permissions & roles...");
  const permissions = await upsertPermissions();
  const roles = await upsertRoles(permissions);

  console.log("Seeding departments...");
  const engineering = await prisma.department.upsert({
    where: { name: "Engineering" },
    update: {},
    create: { name: "Engineering" },
  });
  const finance = await prisma.department.upsert({
    where: { name: "Finance" },
    update: {},
    create: { name: "Finance" },
  });

  console.log("Seeding expense categories...");
  // FRS 11.3 "Expense limits": soft limit warns the approver, hard limit blocks
  // submission. Values confirmed by the client: Rs 2,000 soft / Rs 10,000 hard.
  // They live per-category so Finance can vary them later without a deploy.
  const SOFT_LIMIT = 2000;
  const HARD_LIMIT = 10000;
  const categories = ["Cab", "Travel", "Hotel", "Food", "Fuel", "Internet", "Telephone", "Office Supplies", "Client Meetings", "Business Expenses", "Other"];
  for (const name of categories) {
    await prisma.expenseCategory.upsert({
      where: { name },
      update: { softLimit: SOFT_LIMIT, hardLimit: HARD_LIMIT },
      create: { name, softLimit: SOFT_LIMIT, hardLimit: HARD_LIMIT },
    });
  }

  console.log("Seeding a small fake org (CEO -> Manager -> Team Lead -> Employees)...");

  const ceo = await createUserWithEmployee({
    email: "ceo@company.test",
    password: "Passw0rd!123",
    roleType: "SUPER_ADMIN",
    firstName: "Asha",
    lastName: "Rao",
    designation: "CEO",
    employeeCode: "EMP-001",
  });

  const financeAdmin = await createUserWithEmployee({
    email: "finance@company.test",
    password: "Passw0rd!123",
    roleType: "ADMIN",
    roleId: roles["Finance Admin"].id,
    firstName: "Priya",
    lastName: "Menon",
    designation: "Finance Admin",
    employeeCode: "EMP-002",
    departmentId: finance.id,
    managerId: ceo.employee.id,
    createdById: ceo.id,
  });

  const manager = await createUserWithEmployee({
    email: "manager@company.test",
    password: "Passw0rd!123",
    roleType: "ADMIN",
    roleId: roles["Manager"].id,
    firstName: "Rahul",
    lastName: "Verma",
    designation: "Engineering Manager",
    employeeCode: "EMP-003",
    departmentId: engineering.id,
    managerId: ceo.employee.id,
    createdById: ceo.id,
  });

  const teamLead = await createUserWithEmployee({
    email: "teamlead@company.test",
    password: "Passw0rd!123",
    roleType: "ADMIN",
    roleId: roles["Team Lead"].id,
    firstName: "Divya",
    lastName: "Nair",
    designation: "Team Lead",
    employeeCode: "EMP-004",
    departmentId: engineering.id,
    managerId: manager.employee.id,
    createdById: manager.id,
  });

  const employeeA = await createUserWithEmployee({
    email: "employee.a@company.test",
    password: "Passw0rd!123",
    roleType: "USER",
    firstName: "Karan",
    lastName: "Shah",
    designation: "Software Engineer",
    employeeCode: "EMP-005",
    departmentId: engineering.id,
    managerId: teamLead.employee.id,
    createdById: teamLead.id,
  });

  await createUserWithEmployee({
    email: "employee.b@company.test",
    password: "Passw0rd!123",
    roleType: "USER",
    firstName: "Neha",
    lastName: "Iyer",
    designation: "Software Engineer",
    employeeCode: "EMP-006",
    departmentId: engineering.id,
    managerId: teamLead.employee.id,
    createdById: teamLead.id,
  });

  console.log("Seeded users (all password: Passw0rd!123):");
  console.log("  ceo@company.test          (SUPER_ADMIN)");
  console.log("  finance@company.test      (ADMIN / Finance Admin)");
  console.log("  manager@company.test      (ADMIN / Manager)");
  console.log("  teamlead@company.test     (ADMIN / Team Lead) -- reports to manager");
  console.log("  employee.a@company.test   (USER) -- reports to teamlead");
  console.log("  employee.b@company.test   (USER) -- reports to teamlead");
  console.log(`Employee A id (for testing): ${employeeA.employee.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
