import { Link } from 'react-router-dom'
import ApprovalRow from '../ui/ApprovalRow'

// Read-only slice-to-N preview of an approval queue, used by dashboards.
// Acting on an item happens on the full Expense Approvals page, not here.
export default function MiniApprovalList({ items, renderContent, limit = 3, emptyText = 'Nothing pending.', viewAllHref }) {
  const sliced = items.slice(0, limit)

  return (
    <div className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {sliced.length === 0 ? (
        <p className="p-4 text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          {emptyText}
        </p>
      ) : (
        sliced.map((item) => <ApprovalRow key={item.id} item={item} renderContent={renderContent} />)
      )}
      <div className="border-t px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
        <Link to={viewAllHref} className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
          View all →
        </Link>
      </div>
    </div>
  )
}
