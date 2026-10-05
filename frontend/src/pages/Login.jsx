import { useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Workflow,
  CheckCircle2,
  X,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const LOGO_SRC = '/saanvika-logo.png'
const BACKGROUND_SRC = '/login-background.png'

const BLUE = '#2563EB'
const NAVY = '#0F172A'
const MUTED = '#64748B'

const HIGHLIGHTS = [
  {
    title: 'Streamlined Operations',
    desc: 'Simplify and automate finance workflows.',
    icon: Workflow,
  },
  {
    title: 'Better Visibility',
    desc: 'Real-time insights across the organization.',
    icon: BarChart3,
  },
  {
    title: 'Secure & Compliant',
    desc: 'Role-based access and data protection.',
    icon: ShieldCheck,
  },
]

function Logo() {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div className="text-2xl font-bold tracking-[0.16em]">
        SAANVIKA SOLUTIONS
      </div>
    )
  }

  return (
    <img
      src={LOGO_SRC}
      alt="Saanvika Solutions"
      className="w-[180px] sm:w-[210px] lg:w-[240px] h-auto max-w-full object-contain"
      onError={() => setFailed(true)}
    />
  )
}

export default function Login() {
  const { login, forgotPassword, resetPassword } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isSessionExpired = searchParams.get('expired') === '1'

  // Credentials State
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Forgot Password Modal State
  const [forgotModalVisible, setForgotModalVisible] = useState(false)
  const [forgotStep, setForgotStep] = useState('REQUEST_CODE') // 'REQUEST_CODE' | 'ENTER_NEW_PASSWORD'
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotOtp, setForgotOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const [forgotSuccess, setForgotSuccess] = useState('')
  const [resetCodePreview, setResetCodePreview] = useState('')

  // Submit Credentials (Direct Login - No forced OTP step)
  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Please provide both work email and password.')
      return
    }

    setError('')
    setIsSubmitting(true)

    try {
      const result = await login(email.trim(), password)
      if (result.success) {
        navigate('/dashboard', { replace: true })
      } else {
        setError(result.message || 'Invalid email or password.')
      }
    } catch {
      setError('Unable to sign in. Please verify your credentials.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Forgot Password: Request Code
  async function handleForgotRequest(e) {
    e.preventDefault()
    if (!forgotEmail.trim()) {
      setForgotError('Please enter your work email.')
      return
    }

    setForgotError('')
    setForgotLoading(true)

    const res = await forgotPassword(forgotEmail.trim())
    setForgotLoading(false)

    if (res.success) {
      setResetCodePreview(res.data?.resetCodePreview || res.resetCodePreview || '')
      setForgotStep('ENTER_NEW_PASSWORD')
    } else {
      setForgotError(res.message || 'Account not found.')
    }
  }

  // Forgot Password: Reset Password
  async function handleResetSubmit(e) {
    e.preventDefault()
    if (!forgotOtp.trim()) {
      setForgotError('Please enter the 6-digit reset code.')
      return
    }
    if (newPassword.length < 8) {
      setForgotError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setForgotError('Passwords do not match.')
      return
    }

    setForgotError('')
    setForgotLoading(true)

    const res = await resetPassword(forgotEmail.trim(), forgotOtp.trim(), newPassword)
    setForgotLoading(false)

    if (res.success) {
      setForgotSuccess('Password updated successfully! You can now log in.')
      setTimeout(() => {
        setForgotModalVisible(false)
        setForgotSuccess('')
        setEmail(forgotEmail.trim())
        setPassword('')
      }, 1800)
    } else {
      setForgotError(res.message || 'Failed to reset password.')
    }
  }

  const inputCls =
    'w-full rounded-lg border bg-white/90 py-2.5 pl-10 pr-3 text-xs sm:text-[13px] outline-none transition focus:border-blue-500 focus:ring-3 focus:ring-blue-100'

  return (
    <div
      className="relative flex min-h-screen w-full flex-col overflow-x-hidden overflow-y-auto lg:flex-row"
      style={{
        backgroundImage: `url("${BACKGROUND_SRC}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Decorative gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse at 15% 20%, rgba(37, 99, 235, 0.12) 0%, transparent 50%), radial-gradient(ellipse at 85% 80%, rgba(15, 23, 42, 0.45) 0%, transparent 60%)',
        }}
      />

      {/* Left: Branding */}
      <section className="relative z-10 flex flex-col justify-between px-6 py-6 sm:px-10 lg:flex-1 lg:px-10 lg:py-10 xl:px-14 xl:py-12 2xl:px-16">
        <div className="flex justify-center lg:justify-start">
          <Logo />
        </div>

        <ul className="mb-4 mt-6 hidden lg:flex flex-col gap-3 max-w-[390px]">
          {HIGHLIGHTS.map((item) => (
            <li
              key={item.title}
              className="flex items-center gap-3.5 rounded-xl border border-white/60 bg-white/80 px-3.5 py-3 shadow-sm backdrop-blur-sm transition-transform hover:-translate-y-0.5"
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white shadow-md shadow-blue-500/20"
                style={{ background: BLUE }}
              >
                <item.icon size={18} />
              </div>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold" style={{ color: NAVY }}>
                  {item.title}
                </h3>
                <p className="text-[11.5px] leading-tight" style={{ color: MUTED }}>
                  {item.desc}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Right: Login Card */}
      <section className="relative z-10 flex w-full items-center justify-center px-4 py-4 sm:px-6 lg:w-[420px] xl:w-[450px] lg:shrink-0 lg:p-6 xl:p-8">
        <div
          className="w-full max-w-[380px] sm:max-w-[400px] rounded-2xl border border-white/80 bg-white/95 p-5 sm:p-7 shadow-xl shadow-blue-900/10 backdrop-blur-sm"
          style={{ borderColor: '#E3EAF7' }}
        >
          <form onSubmit={handleSubmit}>
            <span
              className="inline-block rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold"
              style={{ color: BLUE }}
            >
              Welcome Back
            </span>

            <h1 className="mt-2.5 text-lg sm:text-xl font-bold">
              Sign in to your account
            </h1>

            <p
              className="mb-4 mt-1 text-xs leading-relaxed"
              style={{ color: MUTED }}
            >
              Access your Saanvika Solutions Account.
            </p>

            {isSessionExpired && !error && (
              <div
                role="status"
                className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              >
                Your session has expired after 15 minutes of activity. Please sign in again to continue.
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mb-3 rounded-lg px-3 py-1.5 text-xs"
                style={{
                  background: 'var(--danger-soft)',
                  color: 'var(--danger)',
                }}
              >
                {error}
              </div>
            )}

            {/* Email */}
            <div className="mb-3.5">
              <label
                htmlFor="email"
                className="mb-1.5 block text-xs font-medium sm:text-[13px]"
              >
                Email Address
              </label>

              <div className="relative">
                <Mail
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                  color={MUTED}
                />

                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="username"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (error) setError('')
                  }}
                  className={inputCls}
                  style={{ borderColor: '#D9E2F3' }}
                />
              </div>
            </div>

            {/* Password */}
            <div className="mb-2">
              <label
                htmlFor="password"
                className="mb-1.5 block text-xs font-medium sm:text-[13px]"
              >
                Password
              </label>

              <div className="relative">
                <Lock
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                  color={MUTED}
                />

                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (error) setError('')
                  }}
                  className={`${inputCls} pr-10`}
                  style={{ borderColor: '#D9E2F3' }}
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-slate-100"
                >
                  {showPassword ? (
                    <EyeOff size={17} color={MUTED} />
                  ) : (
                    <Eye size={17} color={MUTED} />
                  )}
                </button>
              </div>
            </div>

            {/* Forgot Password Link */}
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setForgotEmail(email)
                  setForgotStep('REQUEST_CODE')
                  setForgotError('')
                  setForgotSuccess('')
                  setForgotModalVisible(true)
                }}
                className="text-[11px] font-semibold text-blue-600 transition hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg py-2.5 sm:py-3 text-[13px] font-semibold text-white shadow-md shadow-blue-500/25 transition hover:brightness-110 disabled:opacity-60"
              style={{ background: BLUE }}
            >
              {isSubmitting ? (
                'Signing in…'
              ) : (
                <>
                  Sign In <ArrowRight size={16} />
                </>
              )}
            </button>

            {/* Quick Demo Presets */}
            <div className="mt-4 border-t pt-3 border-slate-100">
              <p className="mb-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Quick Demo Logins
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {[
                  { label: 'HR Admin', email: 'hr@company.test' },
                  { label: 'CEO', email: 'ceo@company.test' },
                  { label: 'Finance', email: 'finance@company.test' },
                  { label: 'Manager', email: 'manager@company.test' },
                  { label: 'Employee', email: 'employee.a@company.test' },
                ].map((p) => (
                  <button
                    key={p.email}
                    type="button"
                    onClick={() => {
                      setEmail(p.email)
                      setPassword('Passw0rd!123')
                      setError('')
                    }}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10.5px] font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </form>
        </div>
      </section>

      {/* Forgot Password Modal */}
      {forgotModalVisible && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
          style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(3px)' }}
          onClick={() => setForgotModalVisible(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md my-auto max-h-[90vh] overflow-y-auto rounded-2xl border bg-white p-5 sm:p-6 shadow-2xl"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="mb-4 flex items-start justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Reset Password</h3>
                <p className="text-xs text-slate-500">
                  {forgotStep === 'REQUEST_CODE'
                    ? 'Enter your work email to receive a reset code.'
                    : `Enter the code sent to ${forgotEmail}.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForgotModalVisible(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            {forgotError && (
              <div className="mb-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
                {forgotError}
              </div>
            )}

            {forgotSuccess && (
              <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800">
                <CheckCircle2 size={15} className="text-emerald-600" />
                <span>{forgotSuccess}</span>
              </div>
            )}

            {forgotStep === 'REQUEST_CODE' ? (
              <form onSubmit={handleForgotRequest}>
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Work Email
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="name@company.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {forgotLoading ? 'Sending…' : 'Send Reset Code'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetSubmit}>
                {resetCodePreview && (
                  <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
                    Demo Reset Code:{' '}
                    <button
                      type="button"
                      onClick={() => setForgotOtp(resetCodePreview)}
                      className="font-mono font-bold text-blue-700 underline"
                    >
                      {resetCodePreview} (Click to fill)
                    </button>
                  </div>
                )}

                <div className="mb-3">
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    6-Digit Reset Code
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="• • • • • •"
                    value={forgotOtp}
                    onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, ''))}
                    className="w-full font-mono text-center text-base tracking-[0.2em] rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
                  />
                </div>

                <div className="mb-3">
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    New Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForgotStep('REQUEST_CODE')}
                    className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="flex-2 rounded-xl bg-blue-600 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    {forgotLoading ? 'Updating…' : 'Set New Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}