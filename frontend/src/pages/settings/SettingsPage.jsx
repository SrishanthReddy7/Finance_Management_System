import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as gstApi from '../../api/gst'
import ExpenseCategoriesPanel from './ExpenseCategoriesPanel'

const ROLES = ['Finance Admin', 'Manager', 'Team Lead', 'HR Admin']

// Static reference matrix from the real seed data (prisma/seed.js
// ROLE_DEFINITIONS) -- there is no live "edit permissions" endpoint anywhere
// in this backend, so this is intentionally not an editable UI.
const ROLE_PERMISSIONS = {
  'Finance Admin': [
    'VIEW_EMPLOYEE', 'VIEW_COMPANY_SALARY', 'MANAGE_SALARY',
    'VERIFY_EXPENSE', 'PROCESS_REIMBURSEMENT', 'MANAGE_CLIENTS',
    'CREATE_INVOICE', 'APPROVE_INVOICE', 'RECORD_CLIENT_PAYMENT',
    'MANAGE_VENDORS', 'VERIFY_VENDOR_BILL', 'APPROVE_VENDOR_BILL', 'RECORD_VENDOR_PAYMENT',
    'VIEW_GST', 'PREPARE_GST_FILING', 'SUBMIT_GST_FILING',
    'MANAGE_BUDGETS', 'APPROVE_PAYROLL',
    'INITIATE_REFUND', 'APPROVE_REFUND',
    'INITIATE_PAYOUT', 'APPROVE_PAYOUT', 'VIEW_PAYOUT', 'MANAGE_PAYOUT_ACCOUNTS',
    'VIEW_FINANCIAL_REPORTS',
  ],
  Manager: ['VIEW_EMPLOYEE', 'VIEW_TEAM_SALARY', 'APPROVE_EXPENSE', 'MANAGE_PROJECTS', 'MANAGE_CLIENTS'],
  'Team Lead': ['VIEW_EMPLOYEE', 'VIEW_TEAM_SALARY', 'APPROVE_EXPENSE'],
  'HR Admin': ['VIEW_EMPLOYEE', 'VIEW_COMPANY_SALARY', 'MANAGE_SALARY', 'CREATE_EMPLOYEE', 'MANAGE_USERS'],
}

const ALL_CODES = [
  'CREATE_ADMIN', 'CREATE_EMPLOYEE', 'MANAGE_USERS', 'VIEW_EMPLOYEE', 'VIEW_TEAM_SALARY', 'VIEW_COMPANY_SALARY', 'MANAGE_SALARY',
  'APPROVE_EXPENSE', 'VERIFY_EXPENSE', 'PROCESS_REIMBURSEMENT',
  'MANAGE_CLIENTS', 'MANAGE_PROJECTS',
  'CREATE_INVOICE', 'APPROVE_INVOICE', 'RECORD_CLIENT_PAYMENT',
  'MANAGE_VENDORS', 'VERIFY_VENDOR_BILL', 'APPROVE_VENDOR_BILL', 'RECORD_VENDOR_PAYMENT',
  'VIEW_GST', 'PREPARE_GST_FILING', 'SUBMIT_GST_FILING',
  'MANAGE_BUDGETS', 'APPROVE_PAYROLL',
  'INITIATE_REFUND', 'APPROVE_REFUND',
  'INITIATE_PAYOUT', 'APPROVE_PAYOUT', 'VIEW_PAYOUT', 'MANAGE_PAYOUT_ACCOUNTS',
  'VIEW_FINANCIAL_REPORTS', 'VIEW_AUDIT_LOGS',
]

const BASE_TABS = ['Roles & Permissions', 'GST Registration']
const CATEGORIES_TAB = 'Expense Categories'

export default function SettingsPage() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)
  const [activeTab, setActiveTab] = useState('Roles & Permissions')
  const [gstConfig, setGstConfig] = useState(null)
  const [gstError, setGstError] = useState('')
  // FRS 11.2: Finance (VERIFY_EXPENSE) and the CEO manage the category list.
  const TABS = can('VERIFY_EXPENSE') ? [...BASE_TABS, CATEGORIES_TAB] : BASE_TABS

  useEffect(() => {
    if (activeTab !== 'GST Registration' || !can('VIEW_GST') || gstConfig) return
    gstApi.getConfig().then(setGstConfig).catch(() => setGstError('GST configuration is not available to your role.'))
  }, [activeTab, can, gstConfig])

  return (
    <AppShell navItems={navItems} title="Settings" subtitle="Roles, permissions, expense categories and company GST registration.">
      <div className="flex flex-col gap-6">
        <div className="page-tabs flex gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              aria-current={activeTab === tab ? 'page' : undefined}
              onClick={() => setActiveTab(tab)}
              className="pb-2.5 text-[13px] font-medium"
              style={{
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: '-1px',
                color: activeTab === tab ? 'var(--accent)' : 'var(--ink-muted)',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'Roles & Permissions' && (
          <div>
            <p className="mb-3 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
              Reference only — there is no live permission-editing endpoint in this backend. The permission table is
              fixed at seed time.
            </p>
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr style={{ background: '#FAFAFC' }}>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)', borderBottom: '1px solid var(--border)' }}>
                      Permission
                    </th>
                    {ROLES.map((role) => (
                      <th key={role} className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)', borderBottom: '1px solid var(--border)' }}>
                        {role}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALL_CODES.map((code, idx) => (
                    <tr key={code} style={{ borderBottom: idx === ALL_CODES.length - 1 ? 'none' : '1px solid var(--border)' }}>
                      <td className="num px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                        {code}
                      </td>
                      {ROLES.map((role) => (
                        <td key={role} className="px-4 py-2.5 text-center">
                          {ROLE_PERMISSIONS[role].includes(code) && <Check size={15} className="mx-auto" style={{ color: 'var(--success)' }} />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
              Super Admin bypasses every check and is omitted here since it always shows every permission granted.
            </p>
          </div>
        )}

        {activeTab === CATEGORIES_TAB && can('VERIFY_EXPENSE') && <ExpenseCategoriesPanel />}

        {activeTab === 'GST Registration' && (
          <div>
            {!can('VIEW_GST') ? (
              <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                GST configuration is not available to your role.
              </p>
            ) : gstError ? (
              <p className="text-[13px]" style={{ color: 'var(--danger)' }}>
                {gstError}
              </p>
            ) : !gstConfig ? (
              <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                Loading…
              </p>
            ) : (
              <div className="max-w-md rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <p className="mb-4 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
                  Read-only — the registered GSTIN comes from a server environment variable and cannot be edited
                  from this UI.
                </p>
                <dl className="flex flex-col gap-3 text-[13px]">
                  <div className="flex items-center justify-between">
                    <dt style={{ color: 'var(--ink-muted)' }}>GSTIN</dt>
                    <dd className="num font-semibold" style={{ color: 'var(--ink)' }}>
                      {gstConfig.registration?.companyGstin || 'Not configured'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt style={{ color: 'var(--ink-muted)' }}>Configured</dt>
                    <dd style={{ color: gstConfig.registration?.configured ? 'var(--success)' : 'var(--warning)' }}>
                      {gstConfig.registration?.configured ? 'Yes' : 'No'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt style={{ color: 'var(--ink-muted)' }}>State Code</dt>
                    <dd className="num" style={{ color: 'var(--ink)' }}>
                      {gstConfig.registration?.stateCode || '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
