// Client-side payslip PDF (FRS Section 31: Payslips -- "list, view, download PDF").
//
// The payslip object comes from the same authorized payslip endpoints the
// screens already use (GET /employees/:id/payslips), so no extra backend
// route or access rule is needed: a viewer can only download what they can
// already see. jsPDF is loaded on demand so it stays out of the main bundle.

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// jsPDF's built-in fonts have no rupee glyph (it would print as garbage),
// so amounts are written as "Rs. 1,23,456.00" using Indian digit grouping.
function money(amount) {
  const n = Number(amount) || 0
  return `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export async function downloadPayslipPdf(payslip) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  const left = 15
  const right = 195
  const pageBottom = 275
  let y = 20

  const period = `${MONTH_NAMES[payslip.periodMonth] || payslip.periodMonth} ${payslip.periodYear}`
  const employee = payslip.employee || {}
  const employeeName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || '-'

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Payslip', left, y)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')
  doc.text(period, right, y, { align: 'right' })
  y += 4
  doc.setDrawColor(180)
  doc.line(left, y, right, y)
  y += 9

  // Employee block
  const details = [
    ['Employee', employeeName],
    ['Employee Code', employee.employeeCode || '-'],
    ['Designation', employee.designation || '-'],
    ['Pay Period', period],
    ['Payment Status', (payslip.paymentStatus || '-').replace(/_/g, ' ')],
  ]
  doc.setFontSize(10)
  for (const [label, value] of details) {
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(110)
    doc.text(label, left, y)
    doc.setTextColor(20)
    doc.setFont('helvetica', 'bold')
    doc.text(String(value), left + 40, y)
    y += 6
  }
  y += 4

  function ensureSpace(needed) {
    if (y + needed > pageBottom) {
      doc.addPage()
      y = 20
    }
  }

  function section(title, lines, sign) {
    ensureSpace(14)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(20)
    doc.text(title, left, y)
    y += 2
    doc.line(left, y, right, y)
    y += 6
    doc.setFontSize(10)
    if (lines.length === 0) {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(120)
      doc.text('None', left, y)
      y += 7
      return
    }
    for (const line of lines) {
      ensureSpace(7)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(20)
      doc.text(String(line.label), left, y)
      doc.text(`${sign}${money(line.amount)}`, right, y, { align: 'right' })
      y += 6
    }
    y += 3
  }

  const lines = payslip.lines || []
  section('Earnings', lines.filter((l) => l.type === 'EARNING'), '')
  section('Deductions', lines.filter((l) => l.type === 'DEDUCTION'), '-')

  // Totals
  ensureSpace(34)
  doc.line(left, y, right, y)
  y += 7
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Gross Earnings', left, y)
  doc.text(money(payslip.grossEarnings), right, y, { align: 'right' })
  y += 6
  doc.text('Total Deductions', left, y)
  doc.text(`-${money(payslip.totalDeductions)}`, right, y, { align: 'right' })
  y += 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('Net Salary', left, y)
  doc.text(money(payslip.netSalary), right, y, { align: 'right' })
  y += 10

  if (payslip.paidAt) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(110)
    const via = payslip.paymentMethod ? ` via ${payslip.paymentMethod.replace(/_/g, ' ')}` : ''
    const ref = payslip.paymentReferenceNo ? ` (Ref: ${payslip.paymentReferenceNo})` : ''
    doc.text(`Paid on ${formatDate(payslip.paidAt)}${via}${ref}`, left, y)
    y += 6
  }

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(140)
  doc.text('This is a computer-generated payslip and does not require a signature.', left, 285)

  const safeName = employeeName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'employee'
  const month = String(payslip.periodMonth).padStart(2, '0')
  doc.save(`Payslip_${safeName}_${payslip.periodYear}-${month}.pdf`)
}
