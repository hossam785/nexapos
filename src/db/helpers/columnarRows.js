// Sends a long list of same-shaped rows as { columns, rows } instead of one object per row.
// With tens of thousands of products the repeated field names are most of the bytes that cross
// from the backend to the window, so this keeps loading fast however large the shop grows.
function packRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return { columns: [], rows: [] }
  const columns = Object.keys(list[0])
  return { columns, rows: list.map((row) => columns.map((column) => row[column])) }
}

function unpackRows(packed) {
  if (!packed || !Array.isArray(packed.columns) || !Array.isArray(packed.rows)) return []
  const { columns } = packed
  return packed.rows.map((values) => {
    const row = {}
    for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i]
    return row
  })
}

module.exports = { packRows, unpackRows }
