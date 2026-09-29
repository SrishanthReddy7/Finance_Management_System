import { createContext, useContext, useEffect, useState } from 'react'
import { api } from '../api/client'
import { unwrap, unwrapError } from '../api/unwrap'

const AuthContext = createContext(null)

// The backend's /auth/me response nests the role name under `role.name`;
// login's own response nests it under a top-level `roleName`. We always
// resolve the session through /auth/me (see AuthProvider below), so
// normalize its shape to the flat { roleType, roleName, employee,
// permissionCodes } shape the rest of the app relies on.
function normalizeUser(meResponse) {
  if (!meResponse) return null
  return { ...meResponse, roleName: meResponse.role?.name || null }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  async function restoreSession() {
    const token = localStorage.getItem('accessToken')
    if (!token) {
      setIsLoading(false)
      return
    }
    try {
      const res = await api.get('/auth/me')
      setUser(normalizeUser(unwrap(res)))
    } catch {
      localStorage.clear()
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    restoreSession()
  }, [])

  async function login(email, password) {
    try {
      const loginRes = await api.post('/auth/login', { email, password })
      const { accessToken, refreshToken } = unwrap(loginRes)
      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('refreshToken', refreshToken)

      const meRes = await api.get('/auth/me')
      setUser(normalizeUser(unwrap(meRes)))
      return { success: true }
    } catch (err) {
      return { success: false, message: unwrapError(err, 'Invalid email or password.') }
    }
  }

  function logout() {
    localStorage.clear()
    setUser(null)
  }

  function can(code) {
    return user?.roleType === 'SUPER_ADMIN' || !!user?.permissionCodes?.includes(code)
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
