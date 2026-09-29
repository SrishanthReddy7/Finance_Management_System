import { api } from './client'
import { unwrap } from './unwrap'

// Hierarchy-gated (self / reviewable subordinate / VIEW_COMPANY_SALARY). A
// denied caller gets a 404, not a 403 -- deliberate, so callers should treat
// a 404 here as "not visible to me", not "this employee doesn't exist".
// Returns { employeeId, current, history } -- the full version history, not
// just the active structure.
export async function getSalaryStructure(employeeId) {
  const res = await api.get(`/employees/${employeeId}/salary-structure`)
  return unwrap(res)
}

// Always creates a new effective-dated version -- there is no update/delete.
// body: { effectiveFrom?, components: [{ label, type: 'EARNING'|'DEDUCTION', amount }] }
export async function setSalaryStructure(employeeId, body) {
  const res = await api.put(`/employees/${employeeId}/salary-structure`, body)
  return unwrap(res)
}
