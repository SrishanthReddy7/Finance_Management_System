import AppShell from '../components/layout/AppShell'
import { useAuth } from '../context/AuthContext'
import { buildNavItems } from '../routes/navConfig'
import SuperAdminDashboard from './dashboard/SuperAdminDashboard'
import FinanceAdminDashboard from './dashboard/FinanceAdminDashboard'
import HRAdminDashboard from './dashboard/HRAdminDashboard'
import ManagerDashboard from './dashboard/ManagerDashboard'
import TeamLeadDashboard from './dashboard/TeamLeadDashboard'
import EmployeeDashboard from './dashboard/EmployeeDashboard'

// Employee (roleType USER) has no Role row and so no roleName -- every other
// seeded role is distinguished by roleName. Fall back to roleType for that
// one case, and for Super Admin, whose roleName is also null.
const BODY_BY_ROLE_NAME = {
  'Team Lead': TeamLeadDashboard,
  Manager: ManagerDashboard,
  'Finance Admin': FinanceAdminDashboard,
  'HR Admin': HRAdminDashboard,
}

export default function Dashboard() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const Body = user?.roleName
    ? BODY_BY_ROLE_NAME[user.roleName] || EmployeeDashboard
    : user?.roleType === 'SUPER_ADMIN'
      ? SuperAdminDashboard
      : EmployeeDashboard

  return (
    <AppShell navItems={navItems} title="Dashboard">
      <Body user={user} />
    </AppShell>
  )
}
