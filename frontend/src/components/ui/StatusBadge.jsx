const COLORS = {
  green: { bg: 'var(--success-soft)', text: 'var(--success)' },
  amber: { bg: 'var(--warning-soft)', text: 'var(--warning)' },
  red: { bg: 'var(--danger-soft)', text: 'var(--danger)' },
  blue: { bg: 'var(--info-soft)', text: 'var(--info)' },
  gray: { bg: 'var(--bg)', text: 'var(--ink-muted)' },
}

// Keys pulled from backend/prisma/schema.prisma enums so they match exactly.
const STATUS_MAP = {
  invoice: {
    DRAFT: { label: 'Draft', color: 'gray' },
    PENDING_APPROVAL: { label: 'Pending Approval', color: 'amber' },
    APPROVED: { label: 'Approved', color: 'green' },
    SENT: { label: 'Sent', color: 'blue' },
    PARTIALLY_PAID: { label: 'Partially Paid', color: 'amber' },
    PAID: { label: 'Paid', color: 'green' },
    OVERDUE: { label: 'Overdue', color: 'red' },
    CANCELLED: { label: 'Cancelled', color: 'gray' },
  },
  vendorBill: {
    DRAFT: { label: 'Draft', color: 'gray' },
    PENDING_VERIFICATION: { label: 'Pending Verification', color: 'amber' },
    VERIFIED: { label: 'Verified', color: 'green' },
    PENDING_APPROVAL: { label: 'Pending Approval', color: 'amber' },
    APPROVED: { label: 'Approved', color: 'green' },
    REJECTED: { label: 'Rejected', color: 'red' },
    PARTIALLY_PAID: { label: 'Partially Paid', color: 'amber' },
    PAID: { label: 'Paid', color: 'green' },
    CANCELLED: { label: 'Cancelled', color: 'gray' },
  },
  expense: {
    DRAFT: { label: 'Draft', color: 'gray' },
    SUBMITTED: { label: 'Submitted', color: 'blue' },
    MANAGER_APPROVED: { label: 'Manager Approved', color: 'green' },
    MANAGER_REJECTED: { label: 'Manager Rejected', color: 'red' },
    RETURNED: { label: 'Returned', color: 'red' },
    FINANCE_APPROVED: { label: 'Finance Approved', color: 'green' },
    FINANCE_REJECTED: { label: 'Finance Rejected', color: 'red' },
    REIMBURSEMENT_PENDING: { label: 'Reimbursement Pending', color: 'amber' },
    PAID: { label: 'Paid', color: 'green' },
    CANCELLED: { label: 'Cancelled', color: 'gray' },
    PARTIALLY_PAID: { label: 'Partially Paid', color: 'amber' },
  },
  payout: {
    CREATED: { label: 'Created', color: 'gray' },
    AWAITING_APPROVAL: { label: 'Awaiting Approval', color: 'amber' },
    APPROVED: { label: 'Approved', color: 'green' },
    QUEUED: { label: 'Queued', color: 'blue' },
    PROCESSING: { label: 'Processing', color: 'blue' },
    PROCESSED: { label: 'Processed', color: 'green' },
    REJECTED: { label: 'Rejected', color: 'red' },
    FAILED: { label: 'Failed', color: 'red' },
    REVERSED: { label: 'Reversed', color: 'red' },
    CANCELLED: { label: 'Cancelled', color: 'gray' },
  },
  gstFiling: {
    NOT_STARTED: { label: 'Not Started', color: 'gray' },
    IN_PREPARATION: { label: 'In Preparation', color: 'blue' },
    READY: { label: 'Ready', color: 'amber' },
    FILED: { label: 'Filed', color: 'blue' },
    ACKNOWLEDGED: { label: 'Acknowledged', color: 'green' },
  },
  budget: {
    DRAFT: { label: 'Draft', color: 'gray' },
    ACTIVE: { label: 'Active', color: 'green' },
    CLOSED: { label: 'Closed', color: 'gray' },
  },
  project: {
    PLANNED: { label: 'Planned', color: 'blue' },
    ACTIVE: { label: 'Active', color: 'green' },
    ON_HOLD: { label: 'On Hold', color: 'amber' },
    COMPLETED: { label: 'Completed', color: 'green' },
    CANCELLED: { label: 'Cancelled', color: 'gray' },
  },
  client: {
    ACTIVE: { label: 'Active', color: 'green' },
    INACTIVE: { label: 'Inactive', color: 'gray' },
    PROSPECT: { label: 'Prospect', color: 'blue' },
  },
  vendor: {
    ACTIVE: { label: 'Active', color: 'green' },
    INACTIVE: { label: 'Inactive', color: 'gray' },
  },
  milestone: {
    PENDING: { label: 'Pending', color: 'gray' },
    IN_PROGRESS: { label: 'In Progress', color: 'blue' },
    COMPLETED: { label: 'Completed', color: 'green' },
    CANCELLED: { label: 'Cancelled', color: 'gray' },
  },
  payrollRun: {
    DRAFT: { label: 'Draft', color: 'gray' },
    PROCESSED: { label: 'Processed', color: 'blue' },
    FINALIZED: { label: 'Finalized', color: 'amber' },
    PAID: { label: 'Paid', color: 'green' },
    CANCELLED: { label: 'Cancelled', color: 'gray' },
  },
  // Payslip.paymentStatus -- shares the PaymentStatus enum with other
  // modules, but the payroll flow itself only ever writes PENDING/PAID/FAILED.
  paymentStatus: {
    PENDING: { label: 'Pending', color: 'gray' },
    PROCESSED: { label: 'Processed', color: 'blue' },
    PAID: { label: 'Paid', color: 'green' },
    FAILED: { label: 'Failed', color: 'red' },
    PARTIALLY_PAID: { label: 'Partially Paid', color: 'amber' },
  },
  employment: {
    ACTIVE: { label: 'Active', color: 'green' },
    PROBATION: { label: 'Probation', color: 'blue' },
    NOTICE_PERIOD: { label: 'Notice Period', color: 'amber' },
    TERMINATED: { label: 'Terminated', color: 'red' },
    RESIGNED: { label: 'Resigned', color: 'gray' },
  },
}

export default function StatusBadge({ status, entity }) {
  const entry = STATUS_MAP[entity]?.[status]
  const label = entry?.label || status
  const palette = COLORS[entry?.color] || COLORS.gray

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium"
      style={{ background: palette.bg, color: palette.text }}
    >
      {label}
    </span>
  )
}
