const assert = require('assert')
const XLSX = require('xlsx')
const values = ['=HYPERLINK("https://example.invalid","x")', '=cmd|\'/C calc\'!A0', '+cmd', '-cmd', '@cmd', '\tcmd', '\rcmd', '\ncmd', '\u2003=cmd', '"quoted"', 'عربي', '-12.00', '001', 0, -12]
const sheet = XLSX.utils.json_to_sheet(values.map(value => ({value})))
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, 'سجل العمليات')
const read = XLSX.read(XLSX.write(wb, {type:'buffer', bookType:'xlsx'}), {type:'buffer'}).Sheets['سجل العمليات']
let checks=0
for (let i=0; i<values.length; i++) {
  const cell=read[`A${i+2}`]
  assert.strictEqual(cell.v, values[i]); assert.strictEqual(cell.t, typeof values[i] === 'number' ? 'n' : 's'); assert.strictEqual(cell.f, undefined); assert.strictEqual(cell.l, undefined); checks++
}
console.log(`ALL ${checks} CHECKS PASSED`)
