import * as XLSX from 'xlsx'
import { safeRows } from './spreadsheetSafe.js'

/**
 * Formats a float to 2 decimal places safely as a number for Excel math.
 * @param {number|string} val 
 * @returns {number}
 */
function num(val) {
  const n = parseFloat(val)
  return isNaN(n) ? 0 : Math.round((n + Number.EPSILON) * 100) / 100
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
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
 * Standard 24-column Tax Breakdown Template Column Keys
 * Matches the official tax inspection and accounting template.
 */
export const STANDARD_TAX_TEMPLATE_BRACKETS = [
  { rate: 0, salesKey: 'Sales0', taxKey: null },
  { rate: 1, salesKey: 'Sales1', taxKey: 'Tax1' },
  { rate: 2, salesKey: 'Sales2', taxKey: 'Tax2' },
  { rate: 4, salesKey: 'Sales4', taxKey: 'Tax4' },
  { rate: 5, salesKey: 'Sales5', taxKey: 'Tax5' },
  { rate: 8, salesKey: 'Sales8', taxKey: 'Tax8' },
  { rate: 10, salesKey: 'Sales10', taxKey: 'Tax10' },
  { rate: 14, salesKey: 'Sales14', taxKey: 'Tax14' },
  { rate: 16, salesKey: 'Sales16', taxKey: 'Tax16' },
]

/**
 * Exports the dynamic tax invoices journal and itemized products to an official Excel workbook (XLSX).
 * Sheet 1: كشف الفواتير الضريبية (24 عمود المطابق للنموذج المحاسبي)
 * Sheet 2: كشف بنود وأصناف الفواتير التفصيلي (Itemized Products Breakdown)
 * Sheet 3: ملخص الإقرار الضريبي (Tax Declaration Summary)
 * 
 * @param {Object} params
 */
export function exportTaxInvoicesToExcel({
  journalData = {},
  filteredRows,
  journalRows,
  brackets,
  summary,
  from = '',
  to = '',
  settings = {},
  currency = 'ج.م',
}) {
  const activeRows = journalRows || filteredRows || journalData.rows || []
  const activeBrackets = brackets || journalData.brackets || []
  const activeSummary = summary || journalData.summary || {}

  const storeName = settings.store_name || settings.company_name || 'المنشأة التجارية'
  const storeTaxNo = settings.tax_number || settings.tax_card || 'غير مسجل'
  const storeCommReg = settings.commercial_registry || settings.commercial_record || '—'

  // Discover any non-standard rates that may exist in transactions
  const extraBrackets = activeBrackets.filter(b => 
    !STANDARD_TAX_TEMPLATE_BRACKETS.some(std => std.rate === b.rate)
  )

  // ─────────────────────────────────────────────────────────────────────────────
  // SHEET 1: كشف الفواتير الضريبية (نموذج 24 عمود المعتمد)
  // ─────────────────────────────────────────────────────────────────────────────
  const sheet1Data = []

  // Totals accumulator
  const sheet1Totals = {
    SalesFr: 0,
    Sales0: 0,
    SubTot: 0,
    TotalTax: 0,
    NetTot: 0,
  }
  for (const std of STANDARD_TAX_TEMPLATE_BRACKETS) {
    if (std.salesKey) sheet1Totals[std.salesKey] = 0
    if (std.taxKey) sheet1Totals[std.taxKey] = 0
  }
  for (const ext of extraBrackets) {
    sheet1Totals[ext.salesKeyName] = 0
    if (ext.taxKeyName) sheet1Totals[ext.taxKeyName] = 0
  }

  for (const row of activeRows) {
    const isReturn = row.type === 'return'
    const sign = isReturn ? -1 : 1

    const docNum = row.Invoice || row.doc_number || `#${row.id}`
    const docDate = formatDate(row.InvoiceDate || row.created_at)
    const docKind = row.DocKind || (isReturn ? 'فاتورة مردودات مبيعات' : 'فاتورة مبيعات')

    const rowObj = {
      Invoice: docNum,
      InvoiceDate: docDate,
      DocKind: docKind,
      SalesFr: num(row.SalesFr || 0),
      Sales0: num(row.Sales0 || 0),
    }
    sheet1Totals.SalesFr += rowObj.SalesFr
    sheet1Totals.Sales0 += rowObj.Sales0

    // Standard rate brackets 1% -> 16%
    for (const std of STANDARD_TAX_TEMPLATE_BRACKETS) {
      if (std.rate === 0) continue
      const sVal = num(row[std.salesKey] || 0)
      const tVal = num(row[std.taxKey] || 0)
      rowObj[std.salesKey] = sVal
      rowObj[std.taxKey] = tVal
      sheet1Totals[std.salesKey] += sVal
      sheet1Totals[std.taxKey] += tVal
    }

    // Extra dynamic brackets if any
    for (const ext of extraBrackets) {
      const sVal = num(row[ext.salesKeyName] || row[ext.salesKey] || 0)
      const tVal = num(row[ext.taxKeyName] || row[ext.taxKey] || 0)
      rowObj[ext.salesKeyName] = sVal
      rowObj[ext.taxKeyName] = tVal
      sheet1Totals[ext.salesKeyName] += sVal
      sheet1Totals[ext.taxKeyName] += tVal
    }

    const subTot = num(row.SubTot != null ? row.SubTot : row.subtotal)
    const totalTax = num(row.TotalTax != null ? row.TotalTax : row.total_tax)
    const netTot = num(row.NetTot != null ? row.NetTot : row.net_total)

    rowObj.SubTot = subTot
    rowObj.TotalTax = totalTax
    rowObj.NetTot = netTot

    sheet1Totals.SubTot += subTot
    sheet1Totals.TotalTax += totalTax
    sheet1Totals.NetTot += netTot

    sheet1Data.push(rowObj)
  }

  // Grand Totals Row for Sheet 1
  const grandTotalRow = {
    Invoice: 'الإجمالي العام',
    InvoiceDate: `${activeRows.length} مستند`,
    DocKind: 'صافي الفترة بعد خصم المردودات',
    SalesFr: num(sheet1Totals.SalesFr),
    Sales0: num(sheet1Totals.Sales0),
  }
  for (const std of STANDARD_TAX_TEMPLATE_BRACKETS) {
    if (std.rate === 0) continue
    grandTotalRow[std.salesKey] = num(sheet1Totals[std.salesKey])
    grandTotalRow[std.taxKey] = num(sheet1Totals[std.taxKey])
  }
  for (const ext of extraBrackets) {
    grandTotalRow[ext.salesKeyName] = num(sheet1Totals[ext.salesKeyName])
    grandTotalRow[ext.taxKeyName] = num(sheet1Totals[ext.taxKeyName])
  }
  grandTotalRow.SubTot = num(sheet1Totals.SubTot)
  grandTotalRow.TotalTax = num(sheet1Totals.TotalTax)
  grandTotalRow.NetTot = num(sheet1Totals.NetTot)

  sheet1Data.push(grandTotalRow)

  // ─────────────────────────────────────────────────────────────────────────────
  // SHEET 2: كشف بنود وأصناف الفواتير التفصيلي (Itemized Products Breakdown)
  // ─────────────────────────────────────────────────────────────────────────────
  const sheet2Data = []
  let itemSequence = 0

  const sheet2Totals = {
    quantity: 0,
    base_total: 0,
    tax_total: 0,
    net_total: 0,
  }

  for (const row of activeRows) {
    const isReturn = row.type === 'return'
    const sign = isReturn ? -1 : 1
    const docNum = row.Invoice || row.doc_number || `#${row.id}`
    const docDate = formatDate(row.InvoiceDate || row.created_at)
    const docKind = row.DocKind || (isReturn ? 'فاتورة مردودات مبيعات' : 'فاتورة مبيعات')
    const customer = row.customer_name || 'عميل نقدي عام'
    const taxNo = row.customer_tax_no || '—'

    const items = row.items || []
    if (items.length === 0) {
      // If doc has no item details, output single summary row
      itemSequence += 1
      const qty = sign * 1
      const subTot = num(row.SubTot != null ? row.SubTot : row.subtotal)
      const totTax = num(row.TotalTax != null ? row.TotalTax : row.total_tax)
      const netTot = num(row.NetTot != null ? row.NetTot : row.net_total)

      sheet2Totals.quantity += qty
      sheet2Totals.base_total += subTot
      sheet2Totals.tax_total += totTax
      sheet2Totals.net_total += netTot

      sheet2Data.push({
        'م': itemSequence,
        'رقم الفاتورة': docNum,
        'تاريخ الفاتورة': docDate,
        'نوع المستند': docKind,
        'اسم العميل': customer,
        'الرقم الضريبي للعميل': taxNo,
        'باركود الصنف': '—',
        'اسم الصنف والبيان': 'إجمالي مستند مبيعات مجمع',
        'الكمية': qty,
        'سعر الوحدة قبل الضريبة': subTot,
        'نسبة الضريبة': '—',
        'قيمة الضريبة للوحدة': totTax,
        'سعر الوحدة شامل الضريبة': netTot,
        'إجمالي الوعاء قبل الضريبة': subTot,
        'إجمالي الضريبة': totTax,
        'إجمالي الصافي شامل الضريبة': netTot,
      })
    } else {
      for (const item of items) {
        itemSequence += 1
        const qty = num(item.quantity != null ? item.quantity : (item.qty || 1))
        const rate = num(item.tax_rate != null ? item.tax_rate : (item.rate || 0))
        const unitBase = num(item.unit_base_price != null ? item.unit_base_price : (item.price || 0))
        const unitTax = num(item.unit_tax_amount != null ? item.unit_tax_amount : 0)
        const unitNet = num(item.unit_price_with_tax != null ? item.unit_price_with_tax : (item.sell_price || item.price || 0))

        const lineBase = num(item.line_base_total != null ? item.line_base_total : (item.subtotal || (unitBase * qty)))
        const lineTax = num(item.line_tax_total != null ? item.line_tax_total : (item.tax_amount || (unitTax * qty)))
        const lineNet = num(item.line_net_total != null ? item.line_net_total : (item.total || (unitNet * qty)))

        sheet2Totals.quantity += qty
        sheet2Totals.base_total += lineBase
        sheet2Totals.tax_total += lineTax
        sheet2Totals.net_total += lineNet

        sheet2Data.push({
          'م': itemSequence,
          'رقم الفاتورة': docNum,
          'تاريخ الفاتورة': docDate,
          'نوع المستند': docKind,
          'اسم العميل': customer,
          'الرقم الضريبي للعميل': taxNo,
          'باركود الصنف': item.barcode || '—',
          'اسم الصنف والبيان': item.name || item.product_name || 'صنف غير مسمى',
          'الكمية': qty,
          'سعر الوحدة قبل الضريبة': unitBase,
          'نسبة الضريبة': `${rate}%`,
          'قيمة الضريبة للوحدة': unitTax,
          'سعر الوحدة شامل الضريبة': unitNet,
          'إجمالي الوعاء قبل الضريبة': lineBase,
          'إجمالي الضريبة': lineTax,
          'إجمالي الصافي شامل الضريبة': lineNet,
        })
      }
    }
  }

  // Append Grand Totals Row for Sheet 2
  sheet2Data.push({
    'م': 'الإجمالي الصافي',
    'رقم الفاتورة': `إجمالي الأصناف: ${itemSequence}`,
    'تاريخ الفاتورة': '',
    'نوع المستند': 'صافي البنود بعد خصم المردودات',
    'اسم العميل': '',
    'الرقم الضريبي للعميل': '',
    'باركود الصنف': '',
    'اسم الصنف والبيان': '',
    'الكمية': num(sheet2Totals.quantity),
    'سعر الوحدة قبل الضريبة': '',
    'نسبة الضريبة': '',
    'قيمة الضريبة للوحدة': '',
    'سعر الوحدة شامل الضريبة': '',
    'إجمالي الوعاء قبل الضريبة': num(sheet2Totals.base_total),
    'إجمالي الضريبة': num(sheet2Totals.tax_total),
    'إجمالي الصافي شامل الضريبة': num(sheet2Totals.net_total),
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // SHEET 3: ملخص الإقرار الضريبي (Tax Declaration Summary)
  // ─────────────────────────────────────────────────────────────────────────────
  const sheet3Data = [
    { 'البيان': 'اسم المنشأة المسجلة', 'القيمة': storeName },
    { 'البيان': 'رقم التسجيل الضريبي', 'القيمة': storeTaxNo },
    { 'البيان': 'رقم السجل التجاري', 'القيمة': storeCommReg },
    { 'البيان': 'الفترة الضريبية المستخرجة', 'القيمة': `من ${from || 'البداية'} إلى ${to || 'اليوم'}` },
    { 'البيان': 'تاريخ ووقت استخراج التقرير', 'القيمة': new Date().toLocaleString('ar-EG') },
    { 'البيان': '', 'القيمة': '' },
    { 'البيان': '=== ملخص النسب والشرائح الضريبية الفعلية المسجلة ===', 'القيمة': '' },
  ]

  for (const b of activeBrackets) {
    const bTotal = activeSummary.bracket_totals?.[b.slot] || { sales: 0, tax: 0 }
    sheet3Data.push({
      'البيان': `مبيعات النسبة (${b.label})`,
      'القيمة': num(bTotal.sales),
    })
    sheet3Data.push({
      'البيان': `ضريبة النسبة المحصلة (${b.label})`,
      'القيمة': num(bTotal.tax),
    })
  }

  sheet3Data.push(
    { 'البيان': '', 'القيمة': '' },
    { 'البيان': '=== المؤشرات التنفيذية وصافي الاستحقاق الضريبي ===', 'القيمة': '' },
    { 'البيان': 'إجمالي مبيعات الفترة قبل الضريبة (Gross Sales Base)', 'القيمة': num(activeSummary.gross_sales_base) },
    { 'البيان': 'إجمالي مرتجعات الفترة قبل الضريبة (Returned Sales Base)', 'القيمة': num(activeSummary.returned_sales_base) },
    { 'البيان': 'صافي الوعاء الخاضع للضريبة (Net Taxable Base)', 'القيمة': num(activeSummary.net_taxable_base) },
    { 'البيان': 'إجمالي ضريبة المبيعات المحصلة (Output VAT)', 'القيمة': num(activeSummary.output_vat) },
    { 'البيان': 'إجمالي ضريبة المرتجعات المخصومة (Returned VAT)', 'القيمة': num(activeSummary.returned_vat) },
    { 'البيان': 'صافي ضريبة القيمة المضافة المستحقة للسداد (Net Payable VAT)', 'القيمة': num(activeSummary.net_payable_vat) },
    { 'البيان': 'حالة الرصيد الضريبي', 'القيمة': activeSummary.net_payable_vat >= 0 ? 'مستحق للسداد لمصلحة الضرائب' : 'رصيد ضريبي دائن لصالح المنشأة' },
    { 'البيان': 'عدد فواتير المبيعات', 'القيمة': activeSummary.sales_docs_count || 0 },
    { 'البيان': 'عدد إشعارات المرتجع', 'القيمة': activeSummary.returns_docs_count || 0 },
    { 'البيان': 'إجمالي المعاملات الخاضعة', 'القيمة': activeSummary.total_docs_count || 0 }
  )

  // ─────────────────────────────────────────────────────────────────────────────
  // CONSTRUCT WORKBOOK & COLS
  // ─────────────────────────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()

  // 1. Worksheet 1: 24 Columns Tax Invoices
  const ws1 = XLSX.utils.json_to_sheet(safeRows(sheet1Data))
  ws1['!views'] = [{ RTL: true }]
  const ws1Cols = [
    { wch: 14 }, // Invoice
    { wch: 14 }, // InvoiceDate
    { wch: 22 }, // DocKind
    { wch: 12 }, // SalesFr
    { wch: 12 }, // Sales0
  ]
  for (let i = 0; i < 8; i++) {
    ws1Cols.push({ wch: 12 }) // SalesX
    ws1Cols.push({ wch: 12 }) // TaxX
  }
  for (let i = 0; i < extraBrackets.length; i++) {
    ws1Cols.push({ wch: 12 })
    ws1Cols.push({ wch: 12 })
  }
  ws1Cols.push({ wch: 15 }) // SubTot
  ws1Cols.push({ wch: 15 }) // TotalTax
  ws1Cols.push({ wch: 16 }) // NetTot
  ws1['!cols'] = ws1Cols
  XLSX.utils.book_append_sheet(wb, ws1, 'كشف الفواتير الضريبية')

  // 2. Worksheet 2: Itemized Products Sheet
  const ws2 = XLSX.utils.json_to_sheet(safeRows(sheet2Data))
  ws2['!views'] = [{ RTL: true }]
  ws2['!cols'] = [
    { wch: 6 },  // م
    { wch: 14 }, // رقم الفاتورة
    { wch: 14 }, // تاريخ الفاتورة
    { wch: 20 }, // نوع المستند
    { wch: 24 }, // اسم العميل
    { wch: 18 }, // الرقم الضريبي
    { wch: 16 }, // باركود الصنف
    { wch: 30 }, // اسم الصنف
    { wch: 10 }, // الكمية
    { wch: 18 }, // سعر الوحدة قبل الضريبة
    { wch: 12 }, // نسبة الضريبة
    { wch: 16 }, // قيمة الضريبة للوحدة
    { wch: 18 }, // سعر الوحدة شامل الضريبة
    { wch: 20 }, // إجمالي الوعاء
    { wch: 16 }, // إجمالي الضريبة
    { wch: 20 }, // إجمالي الصافي
  ]
  XLSX.utils.book_append_sheet(wb, ws2, 'كشف بنود وأصناف الفواتير')

  // 3. Worksheet 3: Tax Declaration Summary
  const ws3 = XLSX.utils.json_to_sheet(safeRows(sheet3Data))
  ws3['!views'] = [{ RTL: true }]
  ws3['!cols'] = [{ wch: 48 }, { wch: 32 }]
  XLSX.utils.book_append_sheet(wb, ws3, 'ملخص الإقرار الضريبي')

  // Set RTL on workbook level
  if (!wb.Workbook) wb.Workbook = {}
  if (!wb.Workbook.Views) wb.Workbook.Views = []
  wb.Workbook.Views[0] = Object.assign(wb.Workbook.Views[0] || {}, { RTL: true })

  // File Download
  const fromClean = (from || '').slice(0, 10) || 'البداية'
  const toClean = (to || '').slice(0, 10) || 'اليوم'
  const fileName = `كشف_الضرائب_بالفواتير_والأصناف_من_${fromClean}_إلى_${toClean}.xlsx`

  XLSX.writeFile(wb, fileName)
  return { success: true, fileName, wb }
}
