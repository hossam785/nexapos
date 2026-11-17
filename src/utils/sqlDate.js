// created_at is written by SQLite's CURRENT_TIMESTAMP as UTC ('YYYY-MM-DD HH:MM:SS'), so it is read as UTC.
// (A plain `new Date('YYYY-MM-DD HH:MM:SS')` reads it as local time and shows the wrong hour.)
export function parseSqlDate(value) {
  if (!value) return null
  const s = String(value)
  const date = new Date(s.includes(' ') && !s.includes('Z') ? s.replace(' ', 'T') + 'Z' : s)
  return Number.isNaN(date.getTime()) ? null : date
}
