import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// /auth/login and /auth/refresh return 401 for ordinary "wrong credentials"
// / "expired refresh token" failures, which the caller (AuthContext) needs
// to turn into an on-page error message -- not this global expired-session
// redirect, which would hard-navigate away before that message ever renders.
const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh']

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isAuthEndpoint = AUTH_ENDPOINTS.some((path) => err.config?.url?.includes(path))
    if (err.response?.status === 401 && !isAuthEndpoint) {
      localStorage.clear()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)
