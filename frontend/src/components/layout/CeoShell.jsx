import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, LogOut, Menu, PanelLeftClose, PanelLeftOpen, UserCircle, X } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// CEO / Super Admin sidebar grouping. Items come from navConfig's permission-
// filtered list (looked up by label), so nothing here grants access -- it only
// arranges what buildNavItems already allowed.
//
// The same shell serves three roles; `variant` picks the grouping and
// theme (`data-theme`), so the scoped CSS in index.css applies to exactly those.
const VARIANTS = {
  ceo: {
    fallbackName: 'Super Admin',
    groups: [
      { title: 'Overview', labels: ['Dashboard'] },
      {
        title: 'Finance',
        labels: ['Invoices & Payments', 'Vendors & Bills', 'My Expenses', 'Expense Approvals', 'Reimbursements', 'Payouts', 'GST & Filings', 'Budgets'],
      },
      { title: 'People', labels: ['Employee Directory', 'Org & Teams', 'Salary Structures', 'Payroll', 'My Payslips'] },
      { title: 'Business Operations', labels: ['Clients & Projects'] },
      { title: 'Insights', labels: ['Reports', 'Audit Logs'] },
      { title: 'Administration', labels: ['Settings'] },
    ],
    labelOverrides: { 'My Expenses': 'Expenses' },
    // Extra route prefixes that keep an item highlighted (sibling tabs / sub-pages)
    also: { 'Vendors & Bills': ['/vendor-bills'], 'Clients & Projects': ['/projects'] },
  },
  employee: {
    fallbackName: 'Employee',
    // Header shows the employee's role under their name
    showRole: true,
    groups: [
      { title: 'Overview', labels: ['Dashboard'] },
      { title: 'Expenses', labels: ['My Expenses'] },
      { title: 'Payroll', labels: ['My Payslips'] },
      { title: 'Reports', labels: ['Reports'] },
    ],
    labelOverrides: {},
    also: {},
    // Any other nav item an employee is permitted to see still gets listed
    catchAll: 'More',
  },
  finance: {
    fallbackName: 'Finance Admin',
    groups: [
      { title: 'Overview', labels: ['Dashboard'] },
      { title: 'People', labels: ['Employee Directory', 'Org & Teams'] },
      { title: 'Business', labels: ['Clients & Projects', 'Invoices & Payments'] },
      { title: 'Finance', labels: ['Vendors & Bills', 'Salary Structures', 'Payroll', 'Payouts'] },
      { title: 'Compliance', labels: ['GST & Filings', 'Budgets', 'Reports'] },
      { title: 'Workspace', labels: ['Expense Approvals', 'Reimbursements', 'My Expenses', 'My Payslips'] },
      { title: 'Account', labels: ['Settings'] },
    ],
    labelOverrides: {},
    also: { 'Vendors & Bills': ['/vendor-bills'], 'Clients & Projects': ['/projects'] },
    // Any other nav item this Finance Admin is permitted to see still gets listed
    catchAll: 'More',
  },
  teamlead: {
    fallbackName: 'Team Lead',
    groups: [
      { title: 'Overview', labels: ['Dashboard'] },
      { title: 'People', labels: ['Employee Directory', 'Org & Teams'] },
      { title: 'Expenses', labels: ['Expense Approvals', 'My Expenses', 'My Payslips'] },
      { title: 'Reports', labels: ['Reports'] },
    ],
    labelOverrides: {},
    also: {},
    // Any other nav item this Team Lead is permitted to see still gets listed
    catchAll: 'More',
  },
  manager: {
    fallbackName: 'Manager',
    groups: [
      { title: 'Overview', labels: ['Dashboard'] },
      { title: 'People', labels: ['Employee Directory', 'Org & Teams'] },
      { title: 'Projects', labels: ['Clients & Projects', 'Budgets'] },
      { title: 'Expenses', labels: ['Expense Approvals', 'My Expenses', 'My Payslips'] },
      { title: 'Reports', labels: ['Reports'] },
    ],
    labelOverrides: { Budgets: 'Project Budgets' },
    also: { 'Clients & Projects': ['/projects'] },
    // Any other nav item this Manager is permitted to see (none today) still gets listed
    catchAll: 'More',
  },
  hr: {
    fallbackName: 'HR Admin',
    groups: [
      { title: 'Overview', labels: ['Dashboard'] },
      { title: 'Workforce', labels: ['HR Portal', 'Employee Directory', 'Org & Teams'] },
      { title: 'Compensation', labels: ['Salary Structures', 'Payroll'] },
      { title: 'Workspace', labels: ['My Expenses', 'My Payslips'] },
      { title: 'Insights', labels: ['Reports'] },
    ],
    labelOverrides: { 'HR Portal': 'HR Admin Hub' },
    also: {
      'HR Portal': ['/hr-admin'],
      'Employee Directory': ['/employees'],
      'Org & Teams': ['/org-teams'],
      'Salary Structures': ['/salary-structures'],
      Payroll: ['/payroll'],
    },
    catchAll: 'More',
  },
}

const COLLAPSE_KEY = 'ceoSidebarCollapsed'

function readCollapsed() {
  try {
    return sessionStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

// The longest matching prefix wins, so /expenses/approvals lights up
// "Expense Approvals" rather than "Expenses".
function findActiveLabel(items, pathname, also) {
  let best = null
  let bestLen = -1
  for (const item of items) {
    for (const p of [item.href, ...(also[item.label] || [])]) {
      if ((pathname === p || pathname.startsWith(`${p}/`)) && p.length > bestLen) {
        best = item.label
        bestLen = p.length
      }
    }
  }
  return best
}

function Brand({ collapsed }) {
  return collapsed ? (
    // Collapsed rail: show just the shield mark
    <span className="block h-10 w-11 overflow-hidden">
      <img src="/saanvika-logo.png" alt="Saanvika Solutions" className="max-w-none" style={{ width: 120, marginLeft: -38, marginTop: -2, filter: 'brightness(1.2) contrast(1.05)' }} />
    </span>
  ) : (
    <img src="/saanvika-logo.png" alt="Saanvika Solutions" className="h-16 w-auto" style={{ filter: 'brightness(1.2) contrast(1.05)' }} />
  )
}

function SidebarBody({ groups, activeLabel, collapsed, onNavigate }) {
  const navRef = useRef(null)
  // Keep the highlighted item visible when the list is longer than the viewport
  useEffect(() => {
    navRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [activeLabel])

  return (
    <>
      <div className={`flex items-center justify-center pb-2 pt-5 ${collapsed ? 'px-2' : 'px-4'}`}>
        <Brand collapsed={collapsed} />
      </div>

      <nav ref={navRef} className="ceo-scroll flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.title} className="mt-4">
            {collapsed ? (
              <div className="mx-3 mb-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />
            ) : (
              <div className="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {group.title}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = item.label === activeLabel
                return (
                  <Link
                    key={item.label}
                    to={item.href}
                    onClick={onNavigate}
                    data-active={isActive}
                    title={collapsed ? item.display : undefined}
                    className={`group relative flex items-center gap-3 rounded-xl py-2.5 text-[13px] font-medium transition-all ${
                      collapsed ? 'justify-center px-0' : 'px-3'
                    }`}
                    style={{
                      background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
                      color: isActive ? 'var(--sidebar-ink-active)' : 'var(--sidebar-ink)',
                      boxShadow: isActive ? '0 4px 14px rgba(37,99,235,0.32)' : undefined,
                    }}
                  >
                    {Icon && (
                      <Icon
                        size={18}
                        strokeWidth={isActive ? 2.2 : 1.8}
                        className={isActive ? 'text-white' : 'text-slate-400 transition-colors group-hover:text-slate-200'}
                      />
                    )}
                    {!collapsed && <span>{item.display}</span>}
                    {isActive && !collapsed && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white/90 shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </>
  )
}

/**
 * Application shell for SUPER_ADMIN. Rendered by AppShell (which every page
 * already uses), so no page needed to change to adopt it.
 * Props mirror AppShell: navItems, title, topbarActions, children; `subtitle`
 * is optional.
 */
export default function CeoShell({ variant = 'ceo', navItems = [], title, subtitle, topbarActions, children }) {
  const cfg = VARIANTS[variant] || VARIANTS.ceo
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Close transient UI whenever the route changes
  useEffect(() => {
    setDrawerOpen(false)
    setMenuOpen(false)
  }, [pathname])

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    try {
      sessionStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const profileHref = user?.employee?.id ? `/employees/${user.employee.id}` : '/dashboard'
  const byLabel = new Map(navItems.map((i) => [i.label, i]))
  const groups = cfg.groups
    .map((g) => ({
      title: g.title,
      items: g.labels.filter((l) => byLabel.has(l)).map((l) => ({ ...byLabel.get(l), display: cfg.labelOverrides[l] || l })),
    }))
    .filter((g) => g.items.length > 0)
  if (cfg.catchAll) {
    const listed = new Set(cfg.groups.flatMap((g) => g.labels))
    const rest = navItems.filter((i) => !listed.has(i.label)).map((i) => ({ ...i, display: i.label }))
    if (rest.length > 0) groups.push({ title: cfg.catchAll, items: rest })
  }
  const activeLabel = findActiveLabel(groups.flatMap((g) => g.items), pathname, cfg.also)

  const displayName = user?.employee ? `${user.employee.firstName} ${user.employee.lastName}`.trim() : cfg.fallbackName
  const initial = displayName.charAt(0).toUpperCase()
  const headerSubtitle = subtitle ?? (pathname === '/dashboard' ? `Welcome back, ${user?.employee?.firstName || cfg.fallbackName}` : null)

  // Breadcrumb: Group / Module (/ page title on detail & form pages)
  const activeGroup = groups.find((g) => g.items.some((i) => i.label === activeLabel))
  const activeItem = activeGroup?.items.find((i) => i.label === activeLabel)
  const crumbs = pathname === '/dashboard' || !activeItem ? [] : [...(activeGroup.title !== activeItem.display ? [activeGroup.title] : []), activeItem.display, ...(title && title !== activeItem.display && title !== activeItem.label ? [title] : [])]

  const sidebarProps = { groups, activeLabel }

  return (
    <div
      data-theme={variant}
      className="flex min-h-screen"
      style={{
        background: 'radial-gradient(ellipse at 12% 0%, rgba(37, 99, 235, 0.035) 0px, transparent 55%), radial-gradient(ellipse at 88% 0%, rgba(99, 102, 241, 0.03) 0px, transparent 55%), #F8FAFC',
        color: 'var(--ink)',
      }}
    >
      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r transition-[width] duration-200 lg:flex"
        style={{
          width: collapsed ? 76 : 252,
          background: 'var(--sidebar-bg)',
          borderColor: 'rgba(255, 255, 255, 0.06)',
        }}
      >
        <SidebarBody {...sidebarProps} collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[272px] flex-col border-r border-white/10" style={{ background: 'var(--sidebar-bg)' }}>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-white/70 hover:bg-white/10 transition-colors"
            >
              <X size={18} />
            </button>
            <SidebarBody {...sidebarProps} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <style>{`@media (min-width:1024px){ .ceo-main{ margin-left:${collapsed ? 76 : 252}px } }`}</style>
      <div className="ceo-main flex min-w-0 flex-1 flex-col transition-[margin] duration-200">
        <header
          className="sticky top-0 z-20 flex min-h-[72px] flex-wrap items-center gap-x-3 gap-y-2 sm:flex-nowrap px-4 py-3 sm:px-8 border-b transition-colors"
          style={{
            background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(12px)',
            borderColor: 'rgba(226, 232, 240, 0.8)',
          }}
        >
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="rounded-xl border border-slate-200/80 bg-white/90 p-2 text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 lg:hidden"
          >
            <Menu size={18} />
          </button>
          <button
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
            className="hidden rounded-xl border border-slate-200/80 bg-white/90 p-2 text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 lg:block"
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>

          <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
            {crumbs.length > 0 && (
              <nav aria-label="Breadcrumb" className="mb-0.5 flex flex-wrap items-center gap-1 text-[11.5px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                {crumbs.map((c, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight size={11} className="text-slate-400" />}
                    <span style={i === crumbs.length - 1 ? { color: 'var(--ink-muted)', fontWeight: 600 } : undefined}>{c}</span>
                  </span>
                ))}
              </nav>
            )}
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl text-slate-900">{title}</h1>
            {headerSubtitle && (
              <p className="truncate text-[13px] font-normal" style={{ color: 'var(--ink-muted)' }}>
                {headerSubtitle}
              </p>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3 sm:ml-0">{topbarActions}</div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              className="flex items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/90 py-1 pl-1 pr-3 shadow-sm transition hover:bg-slate-50"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm" style={{ background: 'var(--accent)' }}>
                {initial}
              </span>
              {cfg.showRole ? (
                <span className="hidden text-left sm:block">
                  <span className="block text-[13px] font-semibold leading-tight text-slate-900">{displayName}</span>
                  <span className="block text-[11px] font-medium leading-tight" style={{ color: 'var(--ink-muted)' }}>
                    {user?.roleName || cfg.fallbackName}
                  </span>
                </span>
              ) : (
                <span className="hidden text-[13px] font-semibold sm:block text-slate-900">{displayName}</span>
              )}
              <ChevronDown size={15} color="var(--ink-muted)" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl border bg-white p-1.5 shadow-xl transition-all" style={{ borderColor: 'var(--border)' }}>
                <Link to={profileHref} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                  <UserCircle size={16} className="text-slate-400" /> Profile
                </Link>
                <button type="button" onClick={handleLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-medium text-rose-600 hover:bg-rose-50 transition-colors">
                  <LogOut size={16} className="text-rose-500" /> Log out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pb-10 pt-2 sm:px-8">{children}</main>
      </div>
    </div>
  )
}
