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
}

const COLLAPSE_KEY = 'ceoSidebarCollapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
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
    // Collapsed rail: show just the shield mark (the wordmark is illegible at this size)
    <span className="block h-10 w-11 overflow-hidden">
      <img src="/saanvika-logo.png" alt="Saanvika Solutions" className="max-w-none" style={{ width: 120, marginLeft: -38, marginTop: -2, filter: 'brightness(1.35) saturate(1.1)' }} />
    </span>
  ) : (
    <img src="/saanvika-logo.png" alt="Saanvika Solutions" className="h-20 w-auto" style={{ filter: 'brightness(1.35) saturate(1.1)' }} />
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
              <div className="mx-3 mb-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }} />
            ) : (
              <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--ink-faint)' }}>
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
                    className={`flex items-center gap-3 rounded-xl py-2.5 text-[13px] font-medium transition-colors hover:bg-white/5 ${collapsed ? 'justify-center px-0' : 'px-3'}`}
                    style={{
                      background: isActive ? 'var(--sidebar-active-bg)' : undefined,
                      color: isActive ? 'var(--sidebar-ink-active)' : 'var(--sidebar-ink)',
                      boxShadow: isActive ? '0 6px 16px rgba(29,95,232,0.35)' : undefined,
                    }}
                  >
                    {Icon && <Icon size={18} strokeWidth={2} />}
                    {!collapsed && item.display}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
      {/* Profile / Log out live only in the header's name dropdown (see the
          menuOpen block below) -- no longer duplicated as a sidebar footer. */}
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
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
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
      style={{ background: 'linear-gradient(160deg, #E8F0FF 0%, #F3F7FF 45%, #EAF2FF 100%)', color: 'var(--ink)' }}
    >
      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden flex-col transition-[width] duration-200 lg:flex"
        style={{ width: collapsed ? 76 : 250, background: 'var(--sidebar-bg)' }}
      >
        <SidebarBody {...sidebarProps} collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[272px] flex-col" style={{ background: 'var(--sidebar-bg)' }}>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-white/70 hover:bg-white/10"
            >
              <X size={18} />
            </button>
            <SidebarBody {...sidebarProps} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <style>{`@media (min-width:1024px){ .ceo-main{ margin-left:${collapsed ? 76 : 250}px } }`}</style>
      <div className="ceo-main flex min-w-0 flex-1 flex-col transition-[margin] duration-200">
        <header
          className="sticky top-0 z-20 flex min-h-[76px] flex-wrap items-center gap-x-3 gap-y-2 sm:flex-nowrap px-4 py-3 sm:px-8"
          style={{ background: 'rgba(238,244,255,0.85)', backdropFilter: 'blur(8px)' }}
        >
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="rounded-xl bg-white p-2.5 shadow-sm lg:hidden"
          >
            <Menu size={18} />
          </button>
          <button
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
            className="hidden rounded-xl bg-white p-2.5 shadow-sm lg:block"
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>

          <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
            {crumbs.length > 0 && (
              <nav aria-label="Breadcrumb" className="mb-0.5 flex flex-wrap items-center gap-1 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
                {crumbs.map((c, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight size={12} />}
                    <span style={i === crumbs.length - 1 ? { color: 'var(--ink-muted)', fontWeight: 600 } : undefined}>{c}</span>
                  </span>
                ))}
              </nav>
            )}
            <h1 className="truncate text-xl font-bold sm:text-2xl">{title}</h1>
            {headerSubtitle && (
              <p className="truncate text-[13px]" style={{ color: 'var(--ink-muted)' }}>
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
              className="flex items-center gap-2.5 rounded-2xl bg-white py-1.5 pl-1.5 pr-3 shadow-sm"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: 'var(--accent)' }}>
                {initial}
              </span>
              {cfg.showRole ? (
                <span className="hidden text-left sm:block">
                  <span className="block text-[13px] font-semibold leading-tight">{displayName}</span>
                  <span className="block text-[11px] leading-tight" style={{ color: 'var(--ink-muted)' }}>
                    {user?.roleName || cfg.fallbackName}
                  </span>
                </span>
              ) : (
                <span className="hidden text-[13px] font-semibold sm:block">{displayName}</span>
              )}
              <ChevronDown size={16} color="var(--ink-muted)" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl border bg-white p-1.5 shadow-xl" style={{ borderColor: 'var(--border)' }}>
                <Link to={profileHref} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] hover:bg-slate-50">
                  <UserCircle size={16} /> Profile
                </Link>
                <button type="button" onClick={handleLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] hover:bg-slate-50">
                  <LogOut size={16} /> Log out
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
