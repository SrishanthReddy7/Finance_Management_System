import { Check } from 'lucide-react'

export default function WorkflowStepper({ steps, currentIndex, warningIndex }) {
  return (
    <div className="flex w-full items-center">
      {steps.map((label, idx) => {
        const isDone = idx < currentIndex
        const isCurrent = idx === currentIndex
        const isWarning = idx === warningIndex
        const isLast = idx === steps.length - 1

        const circleColor = isWarning
          ? 'var(--warning)'
          : isDone || isCurrent
            ? 'var(--success)'
            : 'var(--border)'
        const circleBg = isWarning
          ? 'var(--warning-soft)'
          : isDone
            ? 'var(--success)'
            : isCurrent
              ? 'var(--success-soft)'
              : 'var(--surface)'
        const textColor = isDone ? '#fff' : circleColor

        return (
          <div key={label} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 text-[13px] font-semibold"
                style={{ borderColor: circleColor, background: circleBg, color: textColor }}
              >
                {isDone ? <Check size={15} strokeWidth={2.5} /> : idx + 1}
              </div>
              <span
                className="max-w-[100px] text-center text-[12px] font-medium"
                style={{ color: isWarning ? 'var(--warning)' : isCurrent ? 'var(--ink)' : 'var(--ink-muted)' }}
              >
                {label}
              </span>
            </div>
            {!isLast && (
              <div
                className="mx-2 h-0.5 flex-1"
                style={{ background: idx < currentIndex ? 'var(--success)' : 'var(--border)' }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
