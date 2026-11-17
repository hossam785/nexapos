// Text that starts with = + - @ (or a tab / carriage return) is run as a formula when an Excel or CSV file is
// opened, so a product or customer named "=HYPERLINK(...)" could do harm. Such text gets a leading apostrophe,
// which makes Excel show it as plain text. Numbers and numeric text (for example "-12.00") are left as they are.
const FORMULA_START = /^[=+\-@\t\r]/

export function safeCell(value) {
  if (typeof value !== 'string' || value === '' || !FORMULA_START.test(value)) return value
  if (Number.isFinite(Number(value))) return value
  return `'${value}`
}

export function safeRows(rows) {
  return (rows || []).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeCell(value)])))
}
