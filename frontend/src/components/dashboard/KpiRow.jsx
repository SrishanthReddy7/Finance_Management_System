import StatCard from '../ui/StatCard'

// `stats`: array of StatCard props (label, value, sublabel?, sublabelColor?).
export default function KpiRow({ stats }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))` }}>
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  )
}
