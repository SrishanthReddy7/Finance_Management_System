import {
  LayoutDashboard,
  Users,
  Building2,
  Briefcase,
  FileText,
  Landmark,
  Wallet,
  CircleDollarSign,
  Send,
  FileBarChart,
  PiggyBank,
  BarChart3,
  ScrollText,
  Settings,
  ClipboardCheck,
  Receipt,
  FileSpreadsheet,
  Banknote,
} from 'lucide-react'

// Single source of truth for the sidebar. Each entry's `isVisible` is
// evaluated at render time against the logged-in user's real
// roleType/permissionCodes (via AuthContext's `can`) -- nothing here is
// hardcoded per role. Route targets are placeholders until their feature
// pages land in later steps.
const NAV_DEFINITIONS = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: '/dashboard',
    isVisible: () => true,
  },
  {
    label: 'Employee Directory',
    icon: Users,
    href: '/employees',
    // Matches GET /users's real gate exactly: roleType SUPER_ADMIN or ADMIN,
    // not a permission code. A plain Employee (roleType USER) has no
    // Directory access at all, even holding VIEW_EMPLOYEE would not help --
    // that code only gates the narrower GET /employees/:id and /departments.
    isVisible: ({ user }) => user?.roleType === 'SUPER_ADMIN' || user?.roleType === 'ADMIN',
  },
  {
    label: 'Org & Teams',
    icon: Building2,
    href: '/org-teams',
    // Departments' own read gate is VIEW_EMPLOYEE; widened from the original
    // MANAGE_USERS-only guess so any of the four ADMIN-tier roles holding it
    // can load the page instead of hitting a 403 on load.
    isVisible: ({ can, user }) => can('MANAGE_USERS') || can('VIEW_EMPLOYEE') || user?.roleType === 'SUPER_ADMIN',
  },
  {
    label: 'Clients & Projects',
    icon: Briefcase,
    href: '/clients',
    // Widened from step 2's MANAGE_CLIENTS-only gate: Projects' own read
    // access is broader (PM/allocated members, or VIEW_FINANCIAL_REPORTS),
    // so Finance Admin and a project's own PM should see this link too.
    isVisible: ({ can }) => can('MANAGE_CLIENTS') || can('MANAGE_PROJECTS') || can('VIEW_FINANCIAL_REPORTS'),
  },
  {
    label: 'Invoices & Payments',
    icon: FileText,
    href: '/invoices',
    // Matches the backend's exact OR gate on GET /invoices (invoice.service.js
    // canSeeInvoices) so the nav link never disagrees with what the page can load.
    isVisible: ({ can }) => can('CREATE_INVOICE') || can('APPROVE_INVOICE') || can('RECORD_CLIENT_PAYMENT') || can('VIEW_FINANCIAL_REPORTS'),
  },
  {
    label: 'Vendors & Bills',
    icon: Landmark,
    href: '/vendors',
    // Matches the backend's exact requireVendorRead OR-of-5 gate on
    // GET /vendors and GET /vendor-bills, same convention as step 5's
    // Clients & Projects / Invoices & Payments gates.
    isVisible: ({ can }) =>
      can('MANAGE_VENDORS') || can('VERIFY_VENDOR_BILL') || can('APPROVE_VENDOR_BILL') || can('RECORD_VENDOR_PAYMENT') || can('VIEW_FINANCIAL_REPORTS'),
  },
  {
    label: 'Salary Structures',
    icon: Wallet,
    href: '/salary-structures',
    isVisible: ({ can }) => can('MANAGE_SALARY'),
  },
  {
    label: 'Payroll',
    icon: CircleDollarSign,
    href: '/payroll',
    // Matches the backend's requirePayrollRead OR-of-3 gate exactly.
    isVisible: ({ can }) => can('MANAGE_SALARY') || can('APPROVE_PAYROLL') || can('VIEW_FINANCIAL_REPORTS'),
  },
  {
    label: 'Payouts',
    icon: Send,
    href: '/payouts',
    // Matches the backend's requirePayoutRead OR-of-3 gate exactly.
    isVisible: ({ can }) => can('INITIATE_PAYOUT') || can('APPROVE_PAYOUT') || can('VIEW_PAYOUT'),
  },
  {
    label: 'GST & Filings',
    icon: FileBarChart,
    href: '/gst',
    isVisible: ({ can }) => can('VIEW_GST'),
  },
  {
    label: 'Budgets',
    icon: PiggyBank,
    href: '/budgets',
    // MANAGE_CLIENTS dropped -- it doesn't correlate with budget visibility
    // at all (only MANAGE_BUDGETS/VIEW_FINANCIAL_REPORTS/Super Admin see
    // everything; anyone else sees only PROJECT-scope budgets for projects
    // they're the assigned PM of, which MANAGE_PROJECTS is the closest proxy for).
    isVisible: ({ can }) => can('MANAGE_BUDGETS') || can('VIEW_FINANCIAL_REPORTS') || can('MANAGE_PROJECTS'),
  },
  {
    label: 'Reports',
    icon: BarChart3,
    href: '/reports',
    // Genuinely open to everyone: two of the hub's nine reports (Employee
    // Reimbursement, Project Profitability) have NO backend permission gate
    // at all -- scoped in-service like GET /expenses, so even a plain
    // Employee gets real, non-empty content (their own reimbursement
    // history). ReportsHub itself hides every other card a given user can't use.
    isVisible: () => true,
  },
  {
    label: 'Audit Logs',
    icon: ScrollText,
    href: '/audit-logs',
    isVisible: ({ user }) => user?.roleType === 'SUPER_ADMIN',
  },
  {
    label: 'Settings',
    icon: Settings,
    href: '/settings',
    // Product decision: no role gets a sidebar "Settings" entry (previously
    // shown to SUPER_ADMIN and to Finance Admin via VIEW_GST). The /settings
    // route itself is untouched -- only the nav link is hidden.
    isVisible: () => false,
  },
  {
    label: 'Expense Approvals',
    icon: ClipboardCheck,
    href: '/expenses/approvals',
    isVisible: ({ can }) => can('APPROVE_EXPENSE') || can('VERIFY_EXPENSE'),
  },
  {
    label: 'Reimbursements',
    icon: Banknote,
    href: '/expenses/reimbursements',
    isVisible: ({ can }) => can('PROCESS_REIMBURSEMENT'),
  },
  {
    label: 'My Expenses',
    icon: Receipt,
    href: '/expenses',
    isVisible: () => true,
  },
  {
    label: 'My Payslips',
    icon: FileSpreadsheet,
    href: '/my-payslips',
    isVisible: () => true,
  },
  // No separate "Profile" entry here -- AppShell's fixed sidebar footer
  // already has its own permanent Profile link (pointed at the viewer's own
  // Employee Profile page), so this list doesn't need to duplicate it.
]

/**
 * Builds the sidebar's navItems array for the given user + `can` permission
 * checker (both from AuthContext), filtered down to what that user is
 * actually allowed to see.
 */
export function buildNavItems(user, can) {
  const ctx = { user, can }
  return NAV_DEFINITIONS.filter((item) => item.isVisible(ctx)).map((item) => ({
    label: typeof item.label === 'function' ? item.label(ctx) : item.label,
    icon: item.icon,
    href: item.href,
  }))
}
