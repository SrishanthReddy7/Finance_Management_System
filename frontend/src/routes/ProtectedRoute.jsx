import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ require, requireRoleType, children }) {
  const { user, isLoading, can } = useAuth()
  const expiresAt = sessionStorage.getItem('sessionExpiresAt')
  const isExpired = expiresAt ? Date.now() > Number(expiresAt) : true
  const hasToken = !!sessionStorage.getItem('accessToken') && !isExpired

  if (!hasToken) return <Navigate to="/login" replace />

  // Wait for the /auth/me restore (triggered on load whenever a token
  // exists) to finish before evaluating `require` -- otherwise a page
  // refresh would bounce a permitted user to /dashboard for a moment
  // because `user` hasn't been populated yet.
  if (isLoading) return null

  // `require` may be a single permission code or an array -- an array is an
  // OR: any one match is enough (e.g. Expense Approvals needs
  // APPROVE_EXPENSE or VERIFY_EXPENSE).
  const codes = Array.isArray(require) ? require : require ? [require] : []
  if (codes.length > 0 && !codes.some((code) => can(code))) {
    return <Navigate to="/dashboard" replace />
  }

  // `requireRoleType` gates on the user's roleType directly rather than a
  // permission code -- needed for GET /users, which the backend gates with
  // requireRoleType("SUPER_ADMIN", "ADMIN"), not a permission code.
  const roleTypes = Array.isArray(requireRoleType) ? requireRoleType : requireRoleType ? [requireRoleType] : []
  if (roleTypes.length > 0 && !roleTypes.includes(user?.roleType)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
