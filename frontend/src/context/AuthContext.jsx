import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { unwrap, unwrapError } from '../api/unwrap'

const AuthContext = createContext(null)

// 15-minute token/session validity lifetime
const SESSION_DURATION_MS = 15 * 60 * 1000

function normalizeUser(meResponse) {
  if (!meResponse) return null
  return { ...meResponse, roleName: meResponse.role?.name || null }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const logoutTimerRef = useRef(null)

  function clearSession() {
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current)
      logoutTimerRef.current = null
    }
    sessionStorage.clear()
    // Clean up any legacy items from localStorage as well
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    setUser(null)
  }

  function scheduleAutoLogout(expiresAt) {
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current)
    }
    const remainingMs = Number(expiresAt) - Date.now()
    if (remainingMs <= 0) {
      clearSession()
      window.location.href = '/login?expired=1'
      return
    }
    logoutTimerRef.current = setTimeout(() => {
      clearSession()
      window.location.href = '/login?expired=1'
    }, remainingMs)
  }

  function startSession(accessToken, refreshToken) {
    const expiresAt = Date.now() + SESSION_DURATION_MS
    sessionStorage.setItem('accessToken', accessToken)
    if (refreshToken) {
      sessionStorage.setItem('refreshToken', refreshToken)
    }
    sessionStorage.setItem('sessionExpiresAt', String(expiresAt))
    scheduleAutoLogout(expiresAt)
  }

  async function restoreSession() {
    const token = sessionStorage.getItem('accessToken')
    const expiresAt = sessionStorage.getItem('sessionExpiresAt')

    if (!token || !expiresAt || Date.now() > Number(expiresAt)) {
      clearSession()
      setIsLoading(false)
      return
    }

    scheduleAutoLogout(expiresAt)

    try {
      const res = await api.get('/auth/me')
      setUser(normalizeUser(unwrap(res)))
    } catch {
      clearSession()
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    restoreSession()
    return () => {
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current)
      }
    }
  }, [])

  async function login(email, password, otp) {
    try {
      const payload = { email, password }
      if (otp) payload.otp = otp
      const loginRes = await api.post('/auth/login', payload)
      const data = unwrap(loginRes)

      // If backend requires OTP 2FA step
      if (data?.requiresOtp) {
        return {
          success: true,
          requiresOtp: true,
          email: data.email,
          maskedEmail: data.maskedEmail,
          otpPreview: data.otpPreview,
          message: data.message,
        }
      }

      const { accessToken, refreshToken } = data
      if (accessToken) {
        startSession(accessToken, refreshToken)
      }

      const meRes = await api.get('/auth/me')
      const normalized = normalizeUser(unwrap(meRes))
      setUser(normalized)
      return { success: true, user: normalized }
    } catch (err) {
      return { success: false, message: unwrapError(err, 'Invalid email or password.') }
    }
  }

  async function verifyOtp(email, otp) {
    try {
      const res = await api.post('/auth/verify-otp', { email, otp })
      const data = unwrap(res)
      const { accessToken, refreshToken } = data
      if (accessToken) {
        startSession(accessToken, refreshToken)
      }

      const meRes = await api.get('/auth/me')
      const normalized = normalizeUser(unwrap(meRes))
      setUser(normalized)
      return { success: true, user: normalized }
    } catch (err) {
      return { success: false, message: unwrapError(err, 'Invalid or expired verification code.') }
    }
  }

  async function resendOtp(email) {
    try {
      const res = await api.post('/auth/resend-otp', { email })
      return { success: true, data: unwrap(res) }
    } catch (err) {
      return { success: false, message: unwrapError(err, 'Could not resend OTP.') }
    }
  }

  async function forgotPassword(email) {
    try {
      const res = await api.post('/auth/forgot-password', { email })
      return { success: true, data: unwrap(res) }
    } catch (err) {
      return { success: false, message: unwrapError(err, 'Could not process password reset.') }
    }
  }

  async function resetPassword(email, otp, newPassword) {
    try {
      const res = await api.post('/auth/reset-password', { email, otp, newPassword })
      return { success: true, data: unwrap(res) }
    } catch (err) {
      return { success: false, message: unwrapError(err, 'Could not reset password.') }
    }
  }

  function logout() {
    clearSession()
  }

  function can(code) {
    return user?.roleType === 'SUPER_ADMIN' || !!user?.permissionCodes?.includes(code)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        verifyOtp,
        resendOtp,
        forgotPassword,
        resetPassword,
        logout,
        can,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
