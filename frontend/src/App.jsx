import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import MyExpenses from './pages/expenses/MyExpenses'
import SubmitExpense from './pages/expenses/SubmitExpense'
import ExpenseApprovals from './pages/expenses/ExpenseApprovals'
import Reimbursements from './pages/expenses/Reimbursements'
import ClientsList from './pages/clients/ClientsList'
import ProjectsList from './pages/projects/ProjectsList'
import ProjectDetail from './pages/projects/ProjectDetail'
import InvoicesList from './pages/invoices/InvoicesList'
import CreateInvoice from './pages/invoices/CreateInvoice'
import InvoiceDetail from './pages/invoices/InvoiceDetail'
import ClientPaymentsLedger from './pages/invoices/ClientPaymentsLedger'
import VendorsList from './pages/vendors/VendorsList'
import VendorBillsList from './pages/vendor-bills/VendorBillsList'
import CreateVendorBill from './pages/vendor-bills/CreateVendorBill'
import VendorBillDetail from './pages/vendor-bills/VendorBillDetail'
import PayoutsList from './pages/payouts/PayoutsList'
import PayoutDetail from './pages/payouts/PayoutDetail'
import EmployeeDirectory from './pages/employees/EmployeeDirectory'
import EmployeeProfile from './pages/employees/EmployeeProfile'
import OrgTeams from './pages/org/OrgTeams'
import SalaryStructuresPage from './pages/salary/SalaryStructuresPage'
import PayrollRunsList from './pages/payroll/PayrollRunsList'
import PayrollRunDetail from './pages/payroll/PayrollRunDetail'
import MyPayslips from './pages/payroll/MyPayslips'
import GstFilings from './pages/gst/GstFilings'
import GstTransactions from './pages/gst/GstTransactions'
import GstPeriodDetail from './pages/gst/GstPeriodDetail'
import BudgetsList from './pages/budgets/BudgetsList'
import BudgetDetail from './pages/budgets/BudgetDetail'
import ReportsHub from './pages/reports/ReportsHub'
import ReportDetail from './pages/reports/ReportDetail'
import AuditLogsList from './pages/audit/AuditLogsList'
import SettingsPage from './pages/settings/SettingsPage'
import ProtectedRoute from './routes/ProtectedRoute'

// Keep in sync with the Budgets entry in routes/navConfig.js
const BUDGET_PERMS = ['MANAGE_BUDGETS', 'VIEW_FINANCIAL_REPORTS', 'MANAGE_PROJECTS']
const INVOICE_READ = ['CREATE_INVOICE', 'APPROVE_INVOICE', 'RECORD_CLIENT_PAYMENT', 'VIEW_FINANCIAL_REPORTS']
const VENDOR_READ = ['MANAGE_VENDORS', 'VERIFY_VENDOR_BILL', 'APPROVE_VENDOR_BILL', 'RECORD_VENDOR_PAYMENT', 'VIEW_FINANCIAL_REPORTS']
const PAYOUT_READ = ['INITIATE_PAYOUT', 'APPROVE_PAYOUT', 'VIEW_PAYOUT']
// Keep in sync with the 'Clients & Projects' entry in routes/navConfig.js
const CLIENT_PROJECT_READ = ['MANAGE_CLIENTS', 'MANAGE_PROJECTS', 'VIEW_FINANCIAL_REPORTS']
const ORG_READ = ['MANAGE_USERS', 'VIEW_EMPLOYEE']
const PAYROLL_READ = ['MANAGE_SALARY', 'APPROVE_PAYROLL', 'VIEW_FINANCIAL_REPORTS']

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses"
        element={
          <ProtectedRoute>
            <MyExpenses />
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses/new"
        element={
          <ProtectedRoute>
            <SubmitExpense />
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses/:id/edit"
        element={
          <ProtectedRoute>
            <SubmitExpense />
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses/approvals"
        element={
          <ProtectedRoute require={['APPROVE_EXPENSE', 'VERIFY_EXPENSE']}>
            <ExpenseApprovals />
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses/reimbursements"
        element={
          <ProtectedRoute require="PROCESS_REIMBURSEMENT">
            <Reimbursements />
          </ProtectedRoute>
        }
      />
      <Route
        path="/clients"
        element={
          <ProtectedRoute require={CLIENT_PROJECT_READ}>
            <ClientsList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects"
        element={
          <ProtectedRoute require={CLIENT_PROJECT_READ}>
            <ProjectsList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:id"
        element={
          <ProtectedRoute require={CLIENT_PROJECT_READ}>
            <ProjectDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/invoices"
        element={
          <ProtectedRoute require={INVOICE_READ}>
            <InvoicesList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/invoices/new"
        element={
          <ProtectedRoute require="CREATE_INVOICE">
            <CreateInvoice />
          </ProtectedRoute>
        }
      />
      <Route
        path="/invoices/payments"
        element={
          <ProtectedRoute require="VIEW_FINANCIAL_REPORTS">
            <ClientPaymentsLedger />
          </ProtectedRoute>
        }
      />
      <Route
        path="/invoices/:id"
        element={
          <ProtectedRoute require={INVOICE_READ}>
            <InvoiceDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vendors"
        element={
          <ProtectedRoute require={VENDOR_READ}>
            <VendorsList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vendor-bills"
        element={
          <ProtectedRoute require={VENDOR_READ}>
            <VendorBillsList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vendor-bills/new"
        element={
          <ProtectedRoute require="MANAGE_VENDORS">
            <CreateVendorBill />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vendor-bills/:id"
        element={
          <ProtectedRoute require={VENDOR_READ}>
            <VendorBillDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payouts"
        element={
          <ProtectedRoute require={PAYOUT_READ}>
            <PayoutsList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payouts/:id"
        element={
          <ProtectedRoute require={PAYOUT_READ}>
            <PayoutDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/employees"
        element={
          <ProtectedRoute requireRoleType={['SUPER_ADMIN', 'ADMIN']}>
            <EmployeeDirectory />
          </ProtectedRoute>
        }
      />
      <Route
        path="/employees/:id"
        element={
          <ProtectedRoute>
            <EmployeeProfile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/org-teams"
        element={
          <ProtectedRoute require={ORG_READ}>
            <OrgTeams />
          </ProtectedRoute>
        }
      />
      <Route
        path="/salary-structures"
        element={
          <ProtectedRoute require="MANAGE_SALARY">
            <SalaryStructuresPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payroll"
        element={
          <ProtectedRoute require={PAYROLL_READ}>
            <PayrollRunsList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payroll/:id"
        element={
          <ProtectedRoute require={PAYROLL_READ}>
            <PayrollRunDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-payslips"
        element={
          <ProtectedRoute>
            <MyPayslips />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gst"
        element={
          <ProtectedRoute require="VIEW_GST">
            <GstFilings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gst/transactions"
        element={
          <ProtectedRoute require="VIEW_GST">
            <GstTransactions />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gst/periods/:id"
        element={
          <ProtectedRoute require="VIEW_GST">
            <GstPeriodDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/budgets"
        element={
          <ProtectedRoute require={BUDGET_PERMS}>
            <BudgetsList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/budgets/:id"
        element={
          <ProtectedRoute require={BUDGET_PERMS}>
            <BudgetDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <ReportsHub />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/:key"
        element={
          <ProtectedRoute>
            <ReportDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/audit-logs"
        element={
          <ProtectedRoute require="VIEW_AUDIT_LOGS">
            <AuditLogsList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute require="VIEW_GST">
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
