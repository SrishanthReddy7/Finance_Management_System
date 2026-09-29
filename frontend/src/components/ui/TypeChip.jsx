export default function TypeChip({ label, color = 'var(--ink-muted)' }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}
