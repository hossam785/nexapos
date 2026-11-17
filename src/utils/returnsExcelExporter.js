import * as XLSX from 'xlsx'
import { safeRows } from './spreadsheetSafe.js'

function fmt(n) {
  const num = parseFloat(n) || 0
  return num.toFixed(2)
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  try {
    const d = new Date(typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr)
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch (e) {
    return dateStr
  }
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr)
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch (e) {
    return ''
  }
}

/**
 * Exports an accounting-grade Returns Ledger Excel workbook.
 * - Forces RTL orientation.
 * - String typing (cell.t = 's') on barcode, session IDs, and invoice numbers to prevent scientific notation (6.22E+12).
 * - Comprehensive column structure including warehouses, payment/refund modes, and taxes if present.
 * - Appends dynamic summary totals row.
 * 
 * @param {Object} params
 * @param {Array} params.returns - List of return records
 * @param {string} params.from - Start date
 * @param {string} params.to - End date
 * @param {Object} params.settings - Store settings
 * @param {boolean} params.skipFileWrite - If true, returns workbook instead of writing to disk (useful for QA)
 * @returns {Object} { workbook, filename, rowCount }
 */
export function exportReturnsExcel({
  returns = [],
  from = '',
  to = '',
  settings = {},
  skipFileWrite = false,
}) {
  const storeName = settings.store_name || settings.company_name || 'NEXA POS'

  let totalQty = 0
  let totalAmount = 0

  const rows = returns.map((r, idx) => {
    const qty = parseFloat(r.quantity) || 1
    const price = parseFloat(r.price) || 0
    const amt = Math.abs(parseFloat(r.total) || (qty * price))
    totalQty += qty
    totalAmount += amt

    const isSupplier = r.type === 'supplier'
    const sessionCode = String(r.return_session_id || (r.id ? `RET-${r.id}` : '—'))
    const originalInv = String(r.original_invoice_number ? `#${r.original_invoice_number}` : (r.invoice_id ? `#${r.invoice_id}` : 'مرتجع مباشر'))
    const barcodeStr = r.barcode ? String(r.barcode) : '—'
    const refundMethodStr = isSupplier
      ? 'خصم من كشف حساب المورد'
      : (r.refund_method === 'credit' ? 'آجل (إشعار دائن بالحساب)' : 'نقدي (مسترد من الدرج)')

    const partyStr = isSupplier
      ? (r.supplier_name || 'مورد غير محدد')
      : (r.customer_name || 'عميل نقدي')

    return {
      'م': idx + 1,
      'رقم إشعار المرتجع': sessionCode,
      'رقم الفاتورة الأصلية': originalInv,
      'تاريخ الإرجاع': r.created_at ? formatDate(r.created_at) : '—',
      'وقت الإرجاع': r.created_at ? formatTime(r.created_at) : '—',
      'نوع الإرجاع': isSupplier ? 'مرتجع إلى مورد' : 'مرتجع من عميل',
      'الجهة المقابلة': partyStr,
      'رقم الهاتف': r.customer_phone ? String(r.customer_phone) : '—',
      'باركود الصنف': barcodeStr,
      'اسم الصنف': r.product_name || '—',
      'الكمية المرتجعة': qty,
      'سعر الوحدة': parseFloat(fmt(price)),
      'إجمالي المبلغ المسترد': parseFloat(fmt(amt)),
      'طريقة الاسترداد': refundMethodStr,
      'المخزن المستلم': r.warehouse_name || 'المخزن الرئيسي',
      'سبب الإرجاع': r.reason || '—',
      'المسؤول (الكاشير)': r.cashier_name || r.user_name || '—',
    }
  })

  // Append Summary Totals Row
  rows.push({
    'م': 'الإجمالي',
    'رقم إشعار المرتجع': `عدد الحركات: ${returns.length}`,
    'رقم الفاتورة الأصلية': '—',
    'تاريخ الإرجاع': '—',
    'وقت الإرجاع': '—',
    'نوع الإرجاع': '—',
    'الجهة المقابلة': '—',
    'رقم الهاتف': '—',
    'باركود الصنف': '—',
    'اسم الصنف': 'إجمالي كافة المرتجعات',
    'الكمية المرتجعة': totalQty,
    'سعر الوحدة': '—',
    'إجمالي المبلغ المسترد': parseFloat(fmt(totalAmount)),
    'طريقة الاسترداد': '—',
    'المخزن المستلم': '—',
    'سبب الإرجاع': '—',
    'المسؤول (الكاشير)': '—',
  })

  const ws = XLSX.utils.json_to_sheet(safeRows(rows))

  // Configure Column Widths
  ws['!cols'] = [
    { wch: 6 },  // م
    { wch: 22 }, // رقم إشعار المرتجع
    { wch: 20 }, // رقم الفاتورة الأصلية
    { wch: 14 }, // تاريخ الإرجاع
    { wch: 12 }, // وقت الإرجاع
    { wch: 18 }, // نوع الإرجاع
    { wch: 24 }, // الجهة المقابلة
    { wch: 16 }, // رقم الهاتف
    { wch: 18 }, // باركود الصنف
    { wch: 32 }, // اسم الصنف
    { wch: 14 }, // الكمية المرتجعة
    { wch: 14 }, // سعر الوحدة
    { wch: 20 }, // إجمالي المبلغ المسترد
    { wch: 26 }, // طريقة الاسترداد
    { wch: 18 }, // المخزن المستلم
    { wch: 24 }, // سبب الإرجاع
    { wch: 18 }, // المسؤول (الكاشير)
  ]

  // Enforce Right-to-Left View
  ws['!views'] = [{ RTL: true }]

  // Enforce String Typing on Barcodes, IDs, and Phone numbers across all rows
  // to permanently prevent Excel scientific notation (e.g. 6.22E+12)
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:Q1')
  for (let R = range.s.r + 1; R <= range.e.r; R++) {
    // Column B: Return Voucher Number (Col index 1)
    const cellB = ws[XLSX.utils.encode_cell({ r: R, c: 1 })]
    if (cellB && cellB.v != null) {
      cellB.t = 's'
      cellB.v = String(cellB.v)
    }

    // Column C: Original Invoice Number (Col index 2)
    const cellC = ws[XLSX.utils.encode_cell({ r: R, c: 2 })]
    if (cellC && cellC.v != null) {
      cellC.t = 's'
      cellC.v = String(cellC.v)
    }

    // Column H: Phone Number (Col index 7)
    const cellH = ws[XLSX.utils.encode_cell({ r: R, c: 7 })]
    if (cellH && cellH.v != null) {
      cellH.t = 's'
      cellH.v = String(cellH.v)
    }

    // Column I: Barcode (Col index 8)
    const cellI = ws[XLSX.utils.encode_cell({ r: R, c: 8 })]
    if (cellI && cellI.v != null) {
      cellI.t = 's'
      cellI.v = String(cellI.v)
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'سجل المرتجعات المفصل')

  const fromPart = from ? from.slice(0, 10) : 'بداية_الفترة'
  const toPart = to ? to.slice(0, 10) : 'نهاية_الفترة'
  const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const filename = `سجل_المرتجعات_${fromPart}_إلى_${toPart}_تاريخ_${stamp}.xlsx`

  if (!skipFileWrite && typeof window !== 'undefined') {
    XLSX.writeFile(wb, filename)
  }

  return {
    workbook: wb,
    filename,
    rowCount: returns.length,
    totalQty,
    totalAmount,
  }
}
