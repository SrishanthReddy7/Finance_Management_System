export default function ProgressBar({ value, max, showLabel }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  const clamped = Math.min(pct, 100)

  const color = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)'

  return (
    <div className="w-full">
      <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamped}%`, background: color }}
        />
      </div>
      {showLabel && (
        <div className="num mt-1.5 text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          {Math.round(pct)}%
        </div>
      )}
    </div>
  )
}
