import { Link } from 'react-router-dom'
import { ArrowRight, FileText } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'

// Each card's visibility follows its OWN real backend gate -- most of the
// hub is flatly VIEW_FINANCIAL_REPORTS, but three reports are scoped
// differently (salary-expense also accepts VIEW_COMPANY_SALARY;
// employee-reimbursement and project-profitability have no route gate at
// all, scoped in-service) -- a single blanket permission check here would
// be wrong for those three.
function buildGroups(can) {
  const financialReports = can('VIEW_FINANCIAL_REPORTS')
  return [
    {
      title: 'Financial',
      cards: [
        { key: 'revenue', label: 'Revenue', visible: financialReports },
        { key: 'expenses', label: 'Expenses', visible: financialReports },
        { key: 'profit-loss', label: 'Profit & Loss', visible: financialReports },
        { key: 'financial-summary', label: 'Financial Summary', visible: financialReports },
        { key: 'cash-flow', label: 'Cash Flow', visible: financialReports },
        { key: 'payment-transactions', label: 'Payment Transactions', visible: financialReports },
      ],
    },
    {
      title: 'People',
      cards: [
        { key: 'salary-expense', label: 'Salary Expense', visible: financialReports || can('VIEW_COMPANY_SALARY') },
        { key: 'employee-reimbursement', label: 'Employee Reimbursement', visible: true },
      ],
    },
    {
      title: 'Projects',
      cards: [{ key: 'project-profitability', label: 'Project Profitability', visible: true }],
    },
    {
      title: 'AR / AP / GST / Budgets',
      cards: [
        { href: '/invoices/payments', label: 'Client Payments', visible: financialReports },
        { href: '/vendor-bills', label: 'Vendor Bills & Payable', visible: financialReports || can('MANAGE_VENDORS') },
        { href: '/gst', label: 'GST Summary', visible: can('VIEW_GST') },
        { href: '/budgets', label: 'Budget Summary', visible: financialReports || can('MANAGE_BUDGETS') },
      ],
    },
  ]
}

export default function ReportsHub() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)
  const showIcons = user?.roleType === 'USER' || (user?.roleType === 'ADMIN' && ['Manager', 'Team Lead', 'Finance Admin'].includes(user?.roleName))
  const groups = buildGroups(can).map((g) => ({ ...g, cards: g.cards.filter((c) => c.visible) })).filter((g) => g.cards.length > 0)

  return (
    <AppShell navItems={navItems} title="Reports" subtitle="Financial, people and project reports available to you.">
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <div key={group.title}>
            <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
              {group.title}
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {group.cards.map((card) => (
                <Link
                  key={card.href || card.key}
                  to={card.href || `/reports/${card.key}`}
                  className="rounded-xl border p-4 text-[13px] font-semibold transition-shadow hover:shadow-sm"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--accent)' }}
                >
                  {showIcons ? (
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                          <FileText size={18} />
                        </span>
                        {card.label}
                      </span>
                      <ArrowRight size={16} />
                    </span>
                  ) : (
                    card.label
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
            No reports are available to your role yet.
          </p>
        )}
      </div>
    </AppShell>
  )
}
