# Finance Management System

An internal, full-stack **Finance Management System (FMS)** for end-to-end financial and HR operations — authentication & role-based access, employee/department management, client & project tracking, invoicing with online payments (Razorpay), vendor bills & accounts payable, GST compliance, budgeting, payroll & salaries, employee expense reimbursements, employee payouts (RazorpayX), and financial reporting with audit logging.

**Stack:** React (Vite) frontend + Node.js/Express REST API backend, backed by PostgreSQL via Prisma ORM.

## Team

- Srishanth Reddy
- Saatvik Sai
- Yadunandan

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Overview](#api-overview)
- [Scripts](#scripts)
- [Security Notes](#security-notes)
- [Known Limitations / Roadmap](#known-limitations--roadmap)
- [Further Reading](#further-reading)

## Features

### Authentication & Access Control
- JWT-based authentication with refresh tokens, account lockout after repeated failed logins.
- Role types (`SUPER_ADMIN`, `ADMIN`, `USER`) plus a fine-grained, database-driven permission system (e.g. `MANAGE_BUDGETS`, `CREATE_INVOICE`, `APPROVE_INVOICE`, `INITIATE_PAYOUT`, `APPROVE_PAYOUT`, `MANAGE_VENDORS`, `VERIFY_VENDOR_BILL`, `APPROVE_PAYROLL`, `VIEW_AUDIT_LOGS`, and more).
- Frontend route protection via a permission/role-aware `ProtectedRoute` component.

### Employees & Departments
- Employee directory with department hierarchy, manager/direct-report chains, and organization/team views.

### Expenses & Reimbursements
- Employee expense claims with categories and uploaded receipts.
- Approval / verification workflow with resubmission or cancellation.
- Reimbursement payment tracking.

### Clients & Projects
- Client records and project management with milestones and project members.
- Project profitability tracking.

### Invoicing & Accounts Receivable
- Invoices with line items and attached documents, full status lifecycle.
- Client payment ledger and AR aging reports.
- Background job (`overdueSweep`) to keep overdue invoices up to date.

### Online Payments (Razorpay)
- Razorpay order creation and checkout flow from an invoice.
- Server-side payment signature verification and idempotent webhook handling.
- Invoice-level locking to prevent overpayment; client payments are only created once a payment is verified.

### Vendors & Accounts Payable
- Vendor records and vendor bills with line items.
- Maker-checker workflow: verification → approval → payment.

### GST Compliance
- Company GSTIN configuration, GST transactions, filing periods, and filing/acknowledgement workflow.
- GST reports (internal only — no external GST portal integration).

### Budgets
- Budgets scoped to Company / Department / Project with a Draft → Active → Closed lifecycle.
- Tracks actual, committed, and remaining spend with utilization and budget-vs-actual reporting.

### Payroll & Salaries
- Effective-dated salary structures broken into components.
- Payroll runs, payslip generation, and an employee self-service "My Payslips" view.

### Employee Payouts (RazorpayX)
- Encrypted (AES-256-GCM) employee payout bank details.
- RazorpayX contact/fund account provisioning, payout initiation & approval, reversals, and a dedicated payout webhook.

### Reporting & Audit
- Revenue, Expenses, Profit & Loss, Cash Flow, Financial/Monthly Summary, Employee Reimbursement, Project Profitability, Payment Transactions, Salary Expense, Client Outstanding, Invoice Aging, Vendor Payable, Budget vs Actual, GST & GST Filing History reports (many with CSV export).
- Full audit log of user actions across the system.

## Tech Stack

### Frontend (`frontend/`)
- **React 19** with **React Router 7** (SPA)
- **Vite** for tooling/build
- **Tailwind CSS 4** for styling
- **TanStack React Query 5** for data fetching/caching
- **Axios** for HTTP requests
- **React Hook Form** for forms
- **Recharts** for charts/dashboards
- **Lucide React** for icons
- **jsPDF** for client-side PDF generation
- **oxlint** for linting

### Backend (`backend/`)
- **Node.js** (ES Modules) + **Express 4**
- **PostgreSQL** (developed against Neon serverless Postgres)
- **Prisma 6** ORM
- **JWT** (`jsonwebtoken`) auth + **bcryptjs** password hashing
- **Zod** for request validation
- **Helmet**, **CORS**, **Morgan** (logging), **Multer** (file uploads)
- **Razorpay** SDK for client payments; custom RazorpayX integration for employee payouts
- **nodemon** for local development

## Project Structure

```
Finance Management System/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma         # Database schema (Prisma)
│   │   ├── migrations/
│   │   ├── seed.js                # Base seed data
│   │   └── demoSeed.js            # Demo data seed
│   ├── src/
│   │   ├── server.js             # Entry point
│   │   ├── app.js                # Express app setup
│   │   ├── config/                # Env/config loading
│   │   ├── integrations/
│   │   │   ├── payment-gateway/razorpay/
│   │   │   └── payout-provider/{mock,razorpayx}/
│   │   ├── jobs/                  # Background jobs (e.g. overdueSweep)
│   │   ├── middleware/            # Auth, error handling, etc.
│   │   ├── modules/               # audit, auth, budgets, clients, departments,
│   │   │                          # employees, expenses, gst, income, invoice,
│   │   │                          # payments, payouts, payroll, projects,
│   │   │                          # reports, salaries, users, vendors
│   │   ├── routes/index.js        # Central route mounting
│   │   └── utils/
│   └── uploads/                    # Uploaded receipts/documents
└── frontend/
    └── src/
        ├── api/                    # Axios client
        ├── components/             # dashboard, layout, salary, ui, etc.
        ├── context/                # App/auth context providers
        ├── pages/                  # audit, budgets, clients, dashboard, employees,
        │                          # expenses, gst, invoices, org, payouts, payroll,
        │                          # projects, reports, salary, settings,
        │                          # vendor-bills, vendors
        ├── routes/                 # navConfig.js, ProtectedRoute.jsx
        └── utils/
```

## Database Schema

PostgreSQL database managed with Prisma (`backend/prisma/schema.prisma`), covering 40+ models grouped into these domains:

- **Identity & Access:** `User`, `Role`, `Permission`, `RolePermission`, `RefreshToken`
- **HR:** `Department`, `Employee`
- **Payroll:** `SalaryStructure`, `SalaryComponent`, `PayrollRun`, `Payslip`, `PayslipLine`
- **Expenses:** `ExpenseCategory`, `ExpenseClaim`, `ExpenseReceipt`, `Reimbursement`, `ReimbursementPayment`
- **Clients & Projects:** `Client`, `Project`, `ProjectMilestone`, `ProjectMember`
- **Invoicing / AR:** `Invoice`, `InvoiceLineItem`, `InvoiceDocument`, `ClientPayment`
- **Payments (Razorpay):** `PaymentTransaction`, `PaymentGatewayEvent`, `PaymentRefund`
- **Vendors / AP:** `Vendor`, `VendorBill`, `VendorBillItem`, `VendorPayment`
- **GST:** `GstTransaction`, `GstFilingPeriod`
- **Budgets:** `Budget`, `BudgetItem`
- **Payouts (RazorpayX):** `Payout`, `PayoutReversal`, `EmployeePayoutAccount`, `PayoutEvent`
- **Cross-cutting:** `ApprovalStep`, `AuditLog`, `Notification`

### Business relationships

```
Company
  ├── Departments → Employees
  ├── Clients → Projects → Project Members / Milestones / Expenses
  ├── Invoices → Client Payments
  ├── Vendors → Vendor Bills → Vendor Payments
  ├── Budgets
  ├── Payroll
  ├── Salary Structures
  ├── GST
  └── Financial Reports
```

### Payment lifecycle (Razorpay)

```
Invoice → outstanding amount calculated → Razorpay order created → PaymentTransaction
        → frontend checkout → verification / webhook
        → server-side signature verification → finalizePaymentTransaction()
        → ClientPayment created → PaymentTransaction marked VERIFIED
        → Invoice status recalculated
```

## Getting Started

### Prerequisites
- Node.js (LTS)
- A PostgreSQL database (e.g. [Neon](https://neon.tech))

### 1. Clone and install

```bash
git clone <repo-url>
cd "Finance Management System"
```

### 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env   # then fill in DATABASE_URL, JWT_SECRET, etc.
npm run prisma:migrate
npm run prisma:generate
npm run seed          # base data (or `npm run seed:demo` for demo data)
npm run dev           # starts API on http://localhost:5000
```

### 3. Frontend setup

```bash
cd frontend
npm install
npm run dev           # starts Vite dev server on http://localhost:5173
```

The frontend calls the API via `VITE_API_URL` (defaults to `http://localhost:5000/api/v1` if unset).

## Environment Variables

Backend (`backend/.env`, based on `backend/.env.example`):

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` / `production` |
| `PORT` | API server port (default `5000`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign JWTs |
| `JWT_EXPIRES_IN` | JWT expiry (e.g. `7d`) |
| `CORS_ORIGIN` | Allowed frontend origin (e.g. `http://localhost:5173`) |
| `COMPANY_GSTIN` | Optional — needed for CGST/SGST vs IGST split in GST module |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay API credentials |
| `RAZORPAY_WEBHOOK_SECRET` | Secret for verifying Razorpay payment webhooks |
| `RAZORPAY_MODE` | `test` or `live` |
| `PAYOUT_FIELD_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM encryption of stored bank details. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `RAZORPAYX_ACCOUNT_NUMBER` | RazorpayX operating current-account number (reuses Razorpay key/secret) |
| `RAZORPAYX_WEBHOOK_SECRET` | Separate secret for verifying RazorpayX payout webhooks |

Frontend (`frontend/.env`, optional):

| Variable | Description |
|---|---|
| `VITE_API_URL` | Base URL of the backend API (defaults to `http://localhost:5000/api/v1`) |

## API Overview

Base path: `http://localhost:5000/api/v1` (plus a plain `GET /health` outside that prefix).

| Route | Purpose |
|---|---|
| `/auth` | Login, registration, token refresh |
| `/users` | User management |
| `/employees` | Employee CRUD, salary and payroll sub-routes, payout accounts |
| `/payslips` | Payslip access |
| `/departments` | Department management |
| `/expenses` | Expense claims & reimbursements |
| `/clients` | Client management |
| `/projects` | Project management |
| `/invoices`, `/reports/ar` | Invoicing & accounts receivable reports |
| `/vendors`, `/vendor-bills`, `/reports/ap` | Vendor bills & accounts payable reports |
| `/gst`, `/reports/gst` | GST transactions, filings, and reports |
| `/budgets`, `/reports/budgets` | Budget management & reporting |
| `/payroll` | Payroll runs |
| `/payments`, `/payments/webhook/razorpay` | Client payment initiation/verification & Razorpay webhook |
| `/payouts`, `/payouts/webhook/razorpayx` | Employee payout initiation/approval & RazorpayX webhook |
| `/audit-logs` | Audit log access |
| `/reports` | General financial reports (Revenue, P&L, Cash Flow, etc.) |

> Webhook routes (`/payments/webhook/razorpay`, `/payouts/webhook/razorpayx`) are mounted ahead of their authenticated counterparts, since they must accept raw, unauthenticated requests from the payment providers and verify them via signature instead of a JWT.

## Scripts

### Backend

| Command | Description |
|---|---|
| `npm run dev` | Start the API with nodemon (auto-reload) |
| `npm start` | Start the API |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run Prisma migrations |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run seed` | Seed base data |
| `npm run seed:demo` | Seed demo data |

### Frontend

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run oxlint |




