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
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const LOGO_SRC = '/saanvika-logo.png'
const BACKGROUND_SRC = '/login-background.png'

const BLUE = '#1D5FE8'
const NAVY = '#0B1B3F'
const MUTED = '#5B6785'

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
      <div className="text-3xl font-bold tracking-[0.18em]">
        SAANVIKA SOLUTIONS
      </div>
    )
  }

  return (
    <img
      src={LOGO_SRC}
      alt="Saanvika Solutions"
      className="w-[260px] sm:w-[300px] lg:w-[340px] h-auto max-w-full object-contain"
      onError={() => setFailed(true)}
    />
  )
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const result = await login(email, password)

      if (result.success) {
        navigate('/dashboard', { replace: true })
      } else {
        setError(result.message)
      }
    } catch {
      setError('Unable to sign in. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border bg-white/90 py-3 pl-11 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100'

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden lg:flex-row"
      style={{
        backgroundImage: `url("${BACKGROUND_SRC}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#EDF4FF',
        color: NAVY,
      }}
    >
      {/* Left: Branding */}
      <section className="relative z-10 flex flex-col items-center justify-between px-6 py-10 sm:px-12 lg:flex-[58] lg:py-14">
        <div className="relative flex flex-1 flex-col items-center justify-center text-center">
          <Logo />

          <h2
            className="mt-6 text-base font-bold tracking-[0.12em] sm:text-xl sm:tracking-[0.18em]"
            style={{ color: BLUE }}
          >
            INTERNAL FINANCE MANAGEMENT SYSTEM
          </h2>

          <p
            className="mt-4 max-w-md text-base leading-relaxed"
            style={{ color: MUTED }}
          >
            A centralized platform to manage our financial operations,
            streamline workflows, and ensure transparency across the
            organization.
          </p>
        </div>

        {/* Feature Highlights */}
        <ul className="relative mt-10 grid w-full max-w-3xl gap-6 sm:grid-cols-3">
          {HIGHLIGHTS.map((h) => (
            <li
              key={h.title}
              className="flex flex-col items-center text-center"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-md shadow-blue-900/10">
                <h.icon size={22} color={BLUE} />
              </span>

              <div className="mt-3 text-sm font-semibold">{h.title}</div>

              <div
                className="mt-1 text-xs leading-snug"
                style={{ color: MUTED }}
              >
                {h.desc}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Right: Login Card */}
      <section className="relative z-10 flex items-center justify-center px-4 pb-12 pt-2 sm:px-8 lg:flex-[42] lg:py-10">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-[600px] rounded-3xl border border-white/80 bg-white/95 p-7 shadow-2xl shadow-blue-900/10 backdrop-blur-sm sm:p-9 lg:p-12"
          style={{ borderColor: '#E3EAF7' }}
        >
          <span
            className="inline-block rounded-full bg-blue-50 px-4 py-2 text-xs font-semibold"
            style={{ color: BLUE }}
          >
            Welcome Back
          </span>

          <h1 className="mt-5 text-2xl font-bold sm:text-[30px]">
            Sign in to your account
          </h1>

          <p
            className="mb-8 mt-2 text-sm leading-relaxed sm:text-base"
            style={{ color: MUTED }}
          >
            Access your Saanvika Solutions Account.
          </p>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg px-3 py-2 text-[13px]"
              style={{
                background: 'var(--danger-soft)',
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          )}

          {/* Email */}
          <div className="mb-5">
            <label
              htmlFor="email"
              className="mb-2 block text-[13px] font-medium sm:text-base"
            >
              Email Address
            </label>

            <div className="relative">
              <Mail
                size={19}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
                color={MUTED}
              />

              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                style={{ borderColor: '#D9E2F3' }}
              />
            </div>
          </div>

          {/* Password */}
          <div className="mb-8">
            <label
              htmlFor="password"
              className="mb-2 block text-[13px] font-medium sm:text-base"
            >
              Password
            </label>

            <div className="relative">
              <Lock
                size={19}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
                color={MUTED}
              />

              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputCls} pr-11`}
                style={{ borderColor: '#D9E2F3' }}
              />

              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-slate-100"
              >
                {showPassword ? (
                  <EyeOff size={19} color={MUTED} />
                ) : (
                  <Eye size={19} color={MUTED} />
                )}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex w-full items-center justify-center gap-3 rounded-xl py-4 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:brightness-110 disabled:opacity-60"
            style={{ background: BLUE }}
          >
            {isSubmitting ? (
              'Signing in…'
            ) : (
              <>
                Sign In <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </section>
    </div>
  )
}