import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1',
})

// Authentication endpoints that should not be blocked by session expiration checks
// or trigger automatic redirect on 401s (since the calling UI handles auth failures directly)
const AUTH_ENDPOINTS = [
  '/auth/login',
  '/auth/verify-otp',
  '/auth/resend-otp',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/me',
]

// Attach token from sessionStorage and enforce 15-minute validity for non-auth requests
api.interceptors.request.use((config) => {
  const isAuthEndpoint = AUTH_ENDPOINTS.some((path) => config.url?.includes(path))

  // For protected non-auth endpoints, verify session expiration
  if (!isAuthEndpoint) {
    const expiresAt = sessionStorage.getItem('sessionExpiresAt')
    if (expiresAt && Date.now() > Number(expiresAt)) {
      sessionStorage.clear()
      localStorage.clear()
      window.location.href = '/login?expired=1'
      return Promise.reject(new Error('Session expired after 15 minutes.'))
    }
  }

  const token = sessionStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isAuthEndpoint = AUTH_ENDPOINTS.some((path) => err.config?.url?.includes(path))
    if (err.response?.status === 401 && !isAuthEndpoint) {
      sessionStorage.clear()
      localStorage.clear()
      window.location.href = '/login?expired=1'
    }
    return Promise.reject(err)
  }
)
