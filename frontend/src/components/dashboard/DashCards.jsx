import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight } from 'lucide-react'

// Futuristic minimalist presentational building blocks for dashboards across all roles.
export function Card({ className = '', children }) {
  return (
    <div
      className={`rounded-2xl border bg-white p-5 transition-all duration-200 hover:shadow-md ${className}`}
      style={{
        borderColor: 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      {children}
    </div>
  )
}

export function IconTile({ icon: Icon, color = '#2563EB', bg = '#EFF6FF' }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-transform duration-200"
      style={{
        background: bg,
        color,
        borderColor: 'rgba(0, 0, 0, 0.04)',
      }}
    >
      <Icon size={20} strokeWidth={2} />
    </span>
  )
}

export function SectionHeader({ icon, title, to }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <IconTile icon={icon} color="#2563EB" bg="#EFF6FF" />
        <h3 className="text-[16px] font-bold tracking-tight" style={{ color: 'var(--ink)' }}>{title}</h3>
      </div>
      {to && (
        <Link
          to={to}
          className="group flex shrink-0 items-center gap-1 text-[13px] font-semibold transition-colors"
          style={{ color: 'var(--accent)' }}
        >
          View all <ArrowRight size={13} className="transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  )
}

export function EmptyPanel({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm border border-slate-100">
        <Icon size={22} />
      </span>
      <div className="mt-3 text-[14px] font-semibold text-slate-800">{title}</div>
      <div className="mt-1 text-[12.5px] text-slate-500 max-w-xs">{hint}</div>
    </div>
  )
}

export function KpiCard({ icon, color = '#2563EB', bg = '#EFF6FF', label, value, sublabel, sublabelColor = 'var(--ink-muted)', to }) {
  return (
    <Card className="group relative overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <IconTile icon={icon} color={color} bg={bg} />
          <div className="text-[13px] font-medium text-slate-500">{label}</div>
        </div>
        {to && (
          <Link
            to={to}
            aria-label={`Open ${label}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-400 border border-slate-200/60 transition-all duration-150 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200"
          >
            <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
      <div className="mt-3.5 whitespace-nowrap text-[26px] font-bold tracking-tight text-slate-900 num">{value}</div>
      {sublabel && (
        <div className="mt-1 flex items-center gap-1.5 text-[12.5px]" style={{ color: sublabelColor }}>
          {sublabel}
        </div>
      )}
    </Card>
  )
}
