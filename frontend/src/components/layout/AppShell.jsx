import { useAuth } from '../../context/AuthContext'
import CeoShell from './CeoShell'

/**
 * Global AppShell wrapper for all authenticated pages.
 * Resolves the authenticated user's role type to the appropriate shell variant:
 * - SUPER_ADMIN -> 'ceo'
 * - HR Admin -> 'hr'
 * - Manager -> 'manager'
 * - Team Lead -> 'teamlead'
 * - Finance Admin -> 'finance'
 * - Employee (USER) -> 'employee'
 */
export default function AppShell({ navItems = [], title, subtitle, topbarActions, children }) {
  const { user } = useAuth()

  const shellVariant =
    user?.roleType === 'SUPER_ADMIN'
      ? 'ceo'
      : user?.roleType === 'ADMIN' && user?.roleName === 'HR Admin'
        ? 'hr'
        : user?.roleType === 'ADMIN' && user?.roleName === 'Manager'
          ? 'manager'
          : user?.roleType === 'ADMIN' && user?.roleName === 'Team Lead'
            ? 'teamlead'
            : user?.roleType === 'ADMIN' && user?.roleName === 'Finance Admin'
              ? 'finance'
              : user?.roleType === 'USER'
                ? 'employee'
                : 'hr'

  return (
    <CeoShell
      variant={shellVariant}
      navItems={navItems}
      title={title}
      subtitle={subtitle}
      topbarActions={topbarActions}
    >
      {children}
    </CeoShell>
  )
}
