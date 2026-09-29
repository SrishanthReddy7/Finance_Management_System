const SUBLABEL_COLORS = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  muted: 'var(--ink-muted)',
}

export default function StatCard({ label, value, sublabel, sublabelColor = 'muted' }) {
  return (
    <div
      className="stat-card rounded-xl border p-5"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="text-[13px] font-medium" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </div>
      <div className="num mt-2 text-[26px] font-bold" style={{ color: 'var(--ink)' }}>
        {value}
      </div>
      {sublabel && (
        <div
          className="num mt-1.5 text-[12px] font-medium"
          style={{ color: SUBLABEL_COLORS[sublabelColor] || SUBLABEL_COLORS.muted }}
        >
          {sublabel}
        </div>
      )}
    </div>
  )
}
