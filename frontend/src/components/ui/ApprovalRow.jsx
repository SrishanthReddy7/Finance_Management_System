import { Check, Undo2, X } from 'lucide-react'

function ActionButton({ onClick, color, bg, Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
      style={{ background: bg, color }}
    >
      <Icon size={16} strokeWidth={2.25} />
    </button>
  )
}

export default function ApprovalRow({ item, renderContent, children, onApprove, onReject, onReturn }) {
  return (
    <div
      className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="min-w-0 flex-1">{renderContent ? renderContent(item) : children}</div>
      <div className="flex shrink-0 items-center gap-2">
        {onApprove && (
          <ActionButton
            onClick={() => onApprove(item)}
            color="var(--success)"
            bg="var(--success-soft)"
            Icon={Check}
            label="Approve"
          />
        )}
        {onReturn && (
          <ActionButton
            onClick={() => onReturn(item)}
            color="var(--warning)"
            bg="var(--warning-soft)"
            Icon={Undo2}
            label="Return for changes"
          />
        )}
        {onReject && (
          <ActionButton
            onClick={() => onReject(item)}
            color="var(--danger)"
            bg="var(--danger-soft)"
            Icon={X}
            label="Reject"
          />
        )}
      </div>
    </div>
  )
}
