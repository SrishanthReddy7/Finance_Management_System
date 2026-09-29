import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight } from 'lucide-react'

// Presentational building blocks for the redesigned role dashboards (Team Lead).
// They read only theme tokens, so they take the look of whichever shell wraps them.

export function Card({ className = '', children }) {
  return (
    <div className={`rounded-2xl border bg-white p-5 ${className}`} style={{ borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      {children}
    </div>
  )
}

export function IconTile({ icon: Icon, color, bg }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: bg, color }}>
      <Icon size={22} />
    </span>
  )
}

export function SectionHeader({ icon, title, to }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <IconTile icon={icon} color="#1D5FE8" bg="#EAF1FF" />
        <h3 className="text-[17px] font-bold">{title}</h3>
      </div>
      {to && (
        <Link to={to} className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>
          View all <ArrowRight size={14} />
        </Link>
      )}
    </div>
  )
}

export function EmptyPanel({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center rounded-2xl px-4 py-6 text-center" style={{ background: '#F6F9FF' }}>
      <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: '#E4ECFB', color: '#5B7BB8' }}>
        <Icon size={24} />
      </span>
      <div className="mt-3 text-[15px] font-semibold">{title}</div>
      <div className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        {hint}
      </div>
    </div>
  )
}

export function KpiCard({ icon, color, bg, label, value, sublabel, sublabelColor = 'var(--ink-muted)', to }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <IconTile icon={icon} color={color} bg={bg} />
          <div className="text-[13px] font-medium" style={{ color: 'var(--ink-muted)' }}>
            {label}
          </div>
        </div>
        <Link to={to} aria-label={`Open ${label}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100">
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="mt-3 whitespace-nowrap text-[28px] font-bold leading-tight">{value}</div>
      <div className="mt-1 text-[13px]" style={{ color: sublabelColor }}>
        {sublabel}
      </div>
    </Card>
  )
}
