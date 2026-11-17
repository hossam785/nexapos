// Anything typed by a person (product, customer and store names, footer text) must be escaped before it
// goes into the HTML of a receipt: a name like  A&B <2>  would otherwise break the printed page, and
// a crafted name could run script in the print window.
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ENTITIES[char])
}
