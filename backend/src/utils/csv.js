// Minimal CSV writer for report exports (FRS Section 22's export-format note,
// resolved with the user as: build CSV now, skip PDF/Excel). No dependency --
// this is a small, well-understood format that doesn't need one.

/**
 * `rows` must already be flat objects (numbers/strings/dates/null) -- callers
 * decide which array represents "the rows" for a given report, rather than
 * this function guessing at a nested shape.
 */
export function toCsv(rows) {
  if (!rows || rows.length === 0) return "";

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    if (value == null) return "";
    const s = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
    return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c])).join(","));
  }
  return lines.join("\r\n");
}

/** Sends `rows` as a CSV file attachment instead of the usual JSON envelope. */
export function sendCsv(res, filename, rows) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(toCsv(rows));
}
