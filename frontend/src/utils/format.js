const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

export function formatCurrency(amount) {
  return currencyFormatter.format(Number(amount) || 0)
}

export function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// <input type="date"> gives "YYYY-MM-DD"; the backend requires a full ISO
// datetime string (z.string().datetime()).
export function toIsoDateTime(dateOnlyString) {
  return new Date(`${dateOnlyString}T00:00:00.000Z`).toISOString()
}
