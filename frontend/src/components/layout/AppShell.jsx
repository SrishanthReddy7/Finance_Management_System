import { useState } from 'react'
import { ChevronDown, LogOut, UserCircle } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import CeoShell from './CeoShell'

/**
 * navItems: Array<{ label, icon: LucideIcon, href, active?, section? }>
 * Items sharing the same `section` are grouped under an uppercase section label.
 * `active` is optional -- when omitted it's derived from the current route.
 */
export default function AppShell({ navItems = [], title, subtitle, topbarActions, children }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const profileHref = user?.employee?.id ? `/employees/${user.employee.id}` : '/dashboard'
  const [menuOpen, setMenuOpen] = useState(false)

  // The redesigned shell is chosen from the authenticated user's role (never the URL):
  // SUPER_ADMIN, Manager, Team Lead, Finance Admin and Employee (roleType USER) get it; every other role falls through unchanged.
  const shellVariant =
    user?.roleType === 'SUPER_ADMIN'
      ? 'ceo'
      : user?.roleType === 'ADMIN' && user?.roleName === 'Manager'
        ? 'manager'
        : user?.roleType === 'ADMIN' && user?.roleName === 'Team Lead'
          ? 'teamlead'
          : user?.roleType === 'ADMIN' && user?.roleName === 'Finance Admin'
            ? 'finance'
            : user?.roleType === 'USER'
              ? 'employee'
              : null
  if (shellVariant) {
    return (
      <CeoShell variant={shellVariant} navItems={navItems} title={title} subtitle={subtitle} topbarActions={topbarActions}>
        {children}
      </CeoShell>
    )
  }

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const sections = []
  const seen = new Map()
  for (const item of navItems) {
    const key = item.section || '__none__'
    if (!seen.has(key)) {
      seen.set(key, { label: item.section, items: [] })
      sections.push(seen.get(key))
    }
    seen.get(key).items.push(item)
  }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg)' }}>
      <aside
        className="fixed inset-y-0 left-0 flex w-[236px] flex-col justify-between px-4 py-5"
        style={{ background: 'var(--sidebar-bg)' }}
      >
        <div>
          <div className="mb-6 flex items-center gap-2 px-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ background: 'var(--accent)' }}
            >
              M
            </div>
            <span className="text-[15px] font-semibold text-white">Meridian Finance</span>
          </div>

          <nav className="flex flex-col gap-4">
            {sections.map((section, idx) => (
              <div key={idx}>
                {section.label && (
                  <div
                    className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--ink-faint)' }}
                  >
                    {section.label}
                  </div>
                )}
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon
                    const isActive = item.active ?? (!!item.href && pathname === item.href)
                    return (
                      <Link
                        key={item.label}
                        to={item.href || '#'}
                        className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors"
                        style={{
                          background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
                          color: isActive ? 'var(--sidebar-ink-active)' : 'var(--sidebar-ink)',
                        }}
                      >
                        {Icon && <Icon size={17} strokeWidth={2} />}
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>
        {/* Profile / Log out live only in the header's name dropdown below --
            no longer duplicated as a sidebar footer. */}
      </aside>

      <div className="ml-[236px] flex flex-1 flex-col">
        <header
          className="flex h-16 items-center justify-between border-b px-8"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <h1 className="text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
            {title}
          </h1>
          <div className="flex items-center gap-3">
            {topbarActions}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium"
                style={{ color: 'var(--ink)' }}
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  {(user?.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user?.email || '?').charAt(0).toUpperCase()}
                </span>
                {user?.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user?.email}
                <ChevronDown size={16} />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-48 rounded-lg border bg-white p-1.5 shadow-xl"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <Link
                    to={profileHref}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] hover:bg-slate-50"
                  >
                    <UserCircle size={16} /> Profile
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-slate-50"
                  >
                    <LogOut size={16} /> Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-8 py-7">{children}</main>
      </div>
    </div>
  )
}
