import { Link, useLocation } from 'react-router-dom'

// Underline section tabs, distinct from the pill-shaped filter chips used
// elsewhere -- these switch between whole pages/routes (Clients <-> Projects,
// Invoices <-> Client Payments), not a filter within one page.
export default function PageTabs({ tabs }) {
  const { pathname } = useLocation()

  return (
    <div className="page-tabs flex gap-5 border-b" style={{ borderColor: 'var(--border)' }}>
      {tabs.map((tab) => {
        const isActive = pathname === tab.href
        return (
          <Link
            key={tab.href}
            to={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className="pb-2.5 text-[13px] font-medium"
            style={{
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-1px',
              color: isActive ? 'var(--accent)' : 'var(--ink-muted)',
            }}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
