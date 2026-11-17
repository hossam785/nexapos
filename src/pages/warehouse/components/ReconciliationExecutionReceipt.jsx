import React, { useState } from 'react'
import {
  CheckCircle2,
  FileText,
  Printer,
  Download,
  TrendingDown,
  TrendingUp,
  Layers,
  Calendar,
  User,
  Warehouse,
  Loader2
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { safeRows } from '../../../utils/spreadsheetSafe.js'
import { escapeHtml } from '../../../utils/htmlEscape.js'

/**
 * ReconciliationExecutionReceipt.jsx
 * 
 * Phase 19: Executive Audit Receipt, Dual Voucher Showcase & Print/Export Engine.
 */
export default function ReconciliationExecutionReceipt({
  executionResult = null,
  matchedRows = [],
  warehouse = null,
  user = null,
  currency = 'ج.م',
  onClose = () => {},
  onStartNew = null
}) {
  const [isPrinting, setIsPrinting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const rec = executionResult?.reconciliation || {}
  const recNumber = rec.reconciliation_number || 'REC-PENDING'
  const warehouseName = rec.warehouse_name || warehouse?.name || 'المخزن الرئيسي'
  const actorName = rec.username || user?.username || 'admin'
  const createdAtFormatted = rec.created_at
    ? new Date(rec.created_at).toLocaleString('ar-EG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : new Date().toLocaleString('ar-EG')

  const outVoucherNumber = rec.out_voucher_number
  const inVoucherNumber = rec.in_voucher_number

  const totalItems = rec.total_items || matchedRows.length || 0
  const shortageItemsCount = rec.shortage_items || 0
  const overageItemsCount = rec.overage_items || 0
  const matchedItemsCount = rec.matched_items || 0

  const totalShortageQty = Math.abs(rec.total_shortage_qty || 0)
  const totalOverageQty = Math.abs(rec.total_overage_qty || 0)
  const netDiffQty = rec.net_difference_qty || 0

  const costImpact = rec.cost_financial_impact || 0
  const isNetDeficit = costImpact < 0
  const isNetSurplus = costImpact > 0

  // ───────────────────────────────────────────────────────────────────────────
  // A4 OFFICIAL AUDIT REPORT PRINT ENGINE
  // ───────────────────────────────────────────────────────────────────────────
  const handlePrintAuditReport = async () => {
    setIsPrinting(true)
    try {
      const shortageList = matchedRows.filter((r) => (r.difference_quantity || r.diffQty || 0) < 0)
      const overageList = matchedRows.filter((r) => (r.difference_quantity || r.diffQty || 0) > 0)

      const html = `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>محضر تسوية جرد - ${recNumber}</title>
          <style>
            @page { size: A4; margin: 15mm; }
            body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; color: #1e293b; margin: 0; padding: 0; font-size: 12px; }
            .header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start; }
            .title { font-size: 20px; font-weight: 900; color: #0f172a; margin: 0; }
            .subtitle { font-size: 11px; color: #64748b; margin-top: 4px; }
            .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
            .meta-item { font-size: 11px; }
            .meta-label { color: #64748b; font-weight: bold; margin-bottom: 2px; }
            .meta-value { color: #0f172a; font-weight: 900; font-size: 13px; font-family: monospace; }
            .summary-box { display: flex; gap: 12px; margin-bottom: 18px; }
            .kpi-card { flex: 1; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; text-align: center; }
            .kpi-title { font-size: 10px; font-weight: bold; color: #64748b; }
            .kpi-num { font-size: 16px; font-weight: 900; margin-top: 3px; font-family: monospace; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
            th { background: #f1f5f9; color: #334155; font-weight: 900; text-align: right; padding: 6px 8px; border: 1px solid #cbd5e1; }
            td { padding: 5px 8px; border: 1px solid #e2e8f0; text-align: right; }
            .num { font-family: monospace; direction: ltr; text-align: left; }
            .shortage-color { color: #dc2626; font-weight: bold; }
            .overage-color { color: #16a34a; font-weight: bold; }
            .section-title { font-size: 13px; font-weight: 900; margin: 14px 0 6px; color: #0f172a; display: flex; align-items: center; justify-content: space-between; }
            .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 36px; padding-top: 16px; border-top: 1px dashed #cbd5e1; }
            .sig-block { text-align: center; }
            .sig-title { font-weight: bold; font-size: 11px; color: #475569; margin-bottom: 40px; }
            .sig-line { border-bottom: 1px solid #94a3b8; width: 80%; margin: 0 auto; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 class="title">محضر جرد وتسوية مخزنية معتمد</h1>
              <div class="subtitle">نظام إدارة المخازن ونقاط البيع • إشعار اعتماد إلكتروني رسمي</div>
            </div>
            <div style="text-align: left; font-family: monospace;">
              <div style="font-size: 14px; font-weight: 900; color: #0f172a;">${recNumber}</div>
              <div style="font-size: 10px; color: #64748b;">${createdAtFormatted}</div>
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-item">
              <div class="meta-label">المخزن محل الجرد:</div>
              <div class="meta-value">${escapeHtml(warehouseName)}</div>
            </div>
            <div class="meta-item">
              <div class="meta-label">المسؤول عن الاعتماد:</div>
              <div class="meta-value">${escapeHtml(actorName)}</div>
            </div>
            <div class="meta-item">
              <div class="meta-label">إذن الصرف (عجز):</div>
              <div class="meta-value" style="color: #dc2626;">${outVoucherNumber || 'لا يوجد عجز'}</div>
            </div>
            <div class="meta-item">
              <div class="meta-label">إذن الإضافة (زيادة):</div>
              <div class="meta-value" style="color: #16a34a;">${inVoucherNumber || 'لا يوجد فائض'}</div>
            </div>
          </div>

          <div class="summary-box">
            <div class="kpi-card" style="background: #f8fafc;">
              <div class="kpi-title">إجمالي الأصناف المجرودة</div>
              <div class="kpi-num" style="color: #0f172a;">${totalItems}</div>
            </div>
            <div class="kpi-card" style="background: #fef2f2;">
              <div class="kpi-title">أصناف العجز (نقص)</div>
              <div class="kpi-num" style="color: #dc2626;">${shortageItemsCount} (${totalShortageQty} ق)</div>
            </div>
            <div class="kpi-card" style="background: #f0fdf4;">
              <div class="kpi-title">أصناف الفائض (زيادة)</div>
              <div class="kpi-num" style="color: #16a34a;">${overageItemsCount} (${totalOverageQty} ق)</div>
            </div>
            <div class="kpi-card" style="background: ${isNetDeficit ? '#fef2f2' : isNetSurplus ? '#f0fdf4' : '#f8fafc'};">
              <div class="kpi-title">صافي الأثر المالي (تكلفة)</div>
              <div class="kpi-num" style="color: ${isNetDeficit ? '#dc2626' : isNetSurplus ? '#16a34a' : '#0f172a'};">
                ${costImpact.toLocaleString()} ${currency}
              </div>
            </div>
          </div>

          ${
            shortageList.length > 0
              ? `
            <div class="section-title">
              <span>🔻 تفاصيل أصناف العجز (إذن صرف رقم: ${outVoucherNumber || '—'})</span>
              <span style="font-size: 10px; color: #dc2626;">عدد البنود: ${shortageList.length}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th style="width: 35px;">#</th>
                  <th>اسم الصنف</th>
                  <th>الباركود</th>
                  <th style="width: 70px;">الرصيد الدفتري</th>
                  <th style="width: 70px;">الفعلي بالشيت</th>
                  <th style="width: 60px;">العجز</th>
                  <th style="width: 70px;">سعر التكلفة</th>
                  <th style="width: 80px;">قيمة العجز</th>
                </tr>
              </thead>
              <tbody>
                ${shortageList
                  .map(
                    (it, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td style="font-weight: bold;">${escapeHtml(it.product_name)}</td>
                    <td class="num">${escapeHtml(it.barcode || '—')}</td>
                    <td class="num">${it.system_quantity}</td>
                    <td class="num">${it.physical_quantity}</td>
                    <td class="num shortage-color">${it.difference_quantity || it.diffQty}</td>
                    <td class="num">${Number(it.cost_price || 0).toLocaleString()}</td>
                    <td class="num shortage-color">${Math.abs(Number(it.cost_difference || it.costDiff || 0)).toLocaleString()} ${currency}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          `
              : ''
          }

          ${
            overageList.length > 0
              ? `
            <div class="section-title">
              <span>🔺 تفاصيل أصناف الزيادة (إذن إضافة رقم: ${inVoucherNumber || '—'})</span>
              <span style="font-size: 10px; color: #16a34a;">عدد البنود: ${overageList.length}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th style="width: 35px;">#</th>
                  <th>اسم الصنف</th>
                  <th>الباركود</th>
                  <th style="width: 70px;">الرصيد الدفتري</th>
                  <th style="width: 70px;">الفعلي بالشيت</th>
                  <th style="width: 60px;">الزيادة</th>
                  <th style="width: 70px;">سعر التكلفة</th>
                  <th style="width: 80px;">قيمة الزيادة</th>
                </tr>
              </thead>
              <tbody>
                ${overageList
                  .map(
                    (it, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td style="font-weight: bold;">${escapeHtml(it.product_name)}</td>
                    <td class="num">${escapeHtml(it.barcode || '—')}</td>
                    <td class="num">${it.system_quantity}</td>
                    <td class="num">${it.physical_quantity}</td>
                    <td class="num overage-color">+${it.difference_quantity || it.diffQty}</td>
                    <td class="num">${Number(it.cost_price || 0).toLocaleString()}</td>
                    <td class="num overage-color">${Number(it.cost_difference || it.costDiff || 0).toLocaleString()} ${currency}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          `
              : ''
          }

          <div class="signatures">
            <div class="sig-block">
              <div class="sig-title">أمين المخزن</div>
              <div class="sig-line"></div>
            </div>
            <div class="sig-block">
              <div class="sig-title">لجنة الجرد والتدقيق</div>
              <div class="sig-line"></div>
            </div>
            <div class="sig-block">
              <div class="sig-title">مدير الحسابات / الاعتماد</div>
              <div class="sig-line"></div>
            </div>
          </div>
        </body>
        </html>
      `

      if (window.mgpos?.printA4) {
        await window.mgpos.printA4(html, { title: `محضر_جرد_${recNumber}` })
      } else {
        const printWindow = window.open('', '_blank')
        printWindow.document.write(html)
        printWindow.document.close()
        printWindow.focus()
        printWindow.print()
      }
    } catch (err) {
      console.error('Print Error:', err)
    } finally {
      setIsPrinting(false)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EXPORT AUDITED RECONCILIATION TO EXCEL FILE
  // ───────────────────────────────────────────────────────────────────────────
  const handleExportExcel = () => {
    setIsExporting(true)
    try {
      const exportData = matchedRows.map((item, idx) => ({
        'م': idx + 1,
        'اسم الصنف': item.product_name,
        'الباركود': item.barcode || '—',
        'الرصيد الدفتري': item.system_quantity,
        'الكمية الفعلية المعتمدة': item.physical_quantity,
        'الفارق': item.difference_quantity || item.diffQty || 0,
        'الحالة': (item.difference_quantity || item.diffQty || 0) < 0 ? 'عجز' : (item.difference_quantity || item.diffQty || 0) > 0 ? 'زيادة' : 'مطابق',
        'الاستراتيجية المطبقة': item.strategy === 'add' ? 'تجميع (إضافة)' : item.strategy === 'keep' ? 'احتفاظ' : 'استبدال',
        'سعر التكلفة': item.cost_price || 0,
        'الأثر المالي (تكلفة)': item.cost_difference || item.costDiff || 0,
        'سعر البيع': item.sell_price || 0,
        'ملاحظات': item.note || '',
      }))

      // names and notes come from files and screens: a text that starts with = + - @ is kept as text
      const ws = XLSX.utils.json_to_sheet(safeRows(exportData))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'محضر التسوية المعتمد')
      XLSX.writeFile(wb, `محضر_تسوية_${warehouseName}_${recNumber}.xlsx`)
    } catch (err) {
      console.error('Export Error:', err)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-4 animate-[fadeIn_0.3s_ease-out]" dir="rtl">
      {/* 1. Executive Top Hero Card */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm text-center relative overflow-hidden">
        <div className="absolute top-0 right-0 left-0 h-2 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600" />

        <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/10 mb-4 animate-[scaleIn_0.2s_ease-out]">
          <CheckCircle2 size={36} />
        </div>

        <h3 className="text-xl font-black text-slate-900">
          تم اعتماد وترحيل التسوية المخزنية بنجاح!
        </h3>
        <p className="text-xs text-slate-400 font-bold mt-1">
          تم تحديث أرصدة المخازن آلياً وإصدار أذون الصرف والإضافة وتوثيق الحركات في سجل التدقيق.
        </p>

        {/* Metadata Pills */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-4 pt-4 border-t border-slate-100">
          <span className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-mono text-xs font-black flex items-center gap-1.5">
            <FileText size={13} className="text-slate-500" />
            <span>رقم المحضر: {recNumber}</span>
          </span>

          <span className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1.5">
            <Warehouse size={13} className="text-slate-500" />
            <span>المخزن: {warehouseName}</span>
          </span>

          <span className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1.5">
            <Calendar size={13} className="text-slate-500" />
            <span>{createdAtFormatted}</span>
          </span>

          <span className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1.5">
            <User size={13} className="text-slate-500" />
            <span>بواسطة: {actorName}</span>
          </span>
        </div>
      </div>

      {/* 2. Dual Generated Vouchers Showcase Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Out Voucher Card (Deficit) */}
        <div
          className={`p-5 rounded-3xl border-2 transition flex flex-col justify-between gap-3 ${
            outVoucherNumber
              ? 'border-rose-200 bg-rose-50/50'
              : 'border-slate-200 bg-slate-50/50 opacity-75'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-black px-2.5 py-1 rounded-xl bg-rose-100 text-rose-800 flex items-center gap-1">
                <TrendingDown size={13} />
                <span>إذن صرف مخزني (عجز)</span>
              </span>
              <span className="text-[10px] font-bold text-slate-400">حركة صرف OUT</span>
            </div>

            <h4 className="text-sm font-black font-mono text-slate-900 mt-1">
              {outVoucherNumber || 'لا يوجد عجز'}
            </h4>
            <p className="text-xs text-slate-500 font-bold mt-0.5">
              {outVoucherNumber
                ? `تم خصم ${totalShortageQty.toLocaleString()} قطعة موزعة على ${shortageItemsCount} أصناف`
                : 'رصيد الأصناف لم يشهد أي عجز دفتري.'}
            </p>
          </div>

          {outVoucherNumber && (
            <div className="pt-2 border-t border-rose-100 flex items-center justify-between text-xs font-black">
              <span className="text-rose-700">قيمة العجز المشطوب:</span>
              <span className="text-rose-800 font-mono">
                {Math.abs(costImpact < 0 ? costImpact : 0).toLocaleString()} {currency}
              </span>
            </div>
          )}
        </div>

        {/* In Voucher Card (Overage) */}
        <div
          className={`p-5 rounded-3xl border-2 transition flex flex-col justify-between gap-3 ${
            inVoucherNumber
              ? 'border-emerald-200 bg-emerald-50/50'
              : 'border-slate-200 bg-slate-50/50 opacity-75'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-black px-2.5 py-1 rounded-xl bg-emerald-100 text-emerald-800 flex items-center gap-1">
                <TrendingUp size={13} />
                <span>إذن إضافة مخزني (زيادة)</span>
              </span>
              <span className="text-[10px] font-bold text-slate-400">حركة إضافة IN</span>
            </div>

            <h4 className="text-sm font-black font-mono text-slate-900 mt-1">
              {inVoucherNumber || 'لا توجد زيادة'}
            </h4>
            <p className="text-xs text-slate-500 font-bold mt-0.5">
              {inVoucherNumber
                ? `تمت إضافة ${totalOverageQty.toLocaleString()} قطعة موزعة على ${overageItemsCount} أصناف`
                : 'رصيد الأصناف لم يشهد أي فائض دفتري.'}
            </p>
          </div>

          {inVoucherNumber && (
            <div className="pt-2 border-t border-emerald-100 flex items-center justify-between text-xs font-black">
              <span className="text-emerald-700">قيمة الفائض المضاف:</span>
              <span className="text-emerald-800 font-mono">
                {Math.abs(costImpact > 0 ? costImpact : 0).toLocaleString()} {currency}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Executive Financial Net Summary Card */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
        <h4 className="text-xs font-black text-slate-700 flex items-center gap-2">
          <Layers size={14} className="text-emerald-600" />
          <span>ملخص الأثر المالي والكمي المعتمد للجرد</span>
        </h4>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 text-center">
            <div className="text-[10px] text-slate-400 font-bold">إجمالي بنود الجرد</div>
            <div className="text-sm font-black font-mono text-slate-800 mt-0.5">{totalItems} صنف</div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 text-center">
            <div className="text-[10px] text-slate-400 font-bold">أصناف متطابقة تماماً</div>
            <div className="text-sm font-black font-mono text-slate-700 mt-0.5">{matchedItemsCount} صنف</div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 text-center">
            <div className="text-[10px] text-slate-400 font-bold">صافي فارق القطع</div>
            <div
              className={`text-sm font-black font-mono mt-0.5 ${
                netDiffQty < 0 ? 'text-rose-600' : netDiffQty > 0 ? 'text-emerald-600' : 'text-slate-800'
              }`}
            >
              {netDiffQty > 0 ? `+${netDiffQty}` : netDiffQty} قطعة
            </div>
          </div>

          <div
            className={`p-3 rounded-2xl border text-center ${
              isNetDeficit
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : isNetSurplus
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-slate-50 border-slate-200 text-slate-800'
            }`}
          >
            <div className="text-[10px] font-bold">صافي الأثر المالي (تكلفة)</div>
            <div className="text-sm font-black font-mono mt-0.5">
              {costImpact.toLocaleString()} {currency}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Executive Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          {/* Print A4 Official Report */}
          <button
            type="button"
            onClick={handlePrintAuditReport}
            disabled={isPrinting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800 shadow-md transition disabled:opacity-50"
          >
            {isPrinting ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
            <span>طباعة محضر الجرد الرسمي (A4)</span>
          </button>

          {/* Export Reconciled Excel */}
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={isExporting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-50 transition shadow-sm disabled:opacity-50"
          >
            {isExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            <span>تصدير إلى Excel (.xlsx)</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {onStartNew && (
            <button
              type="button"
              onClick={onStartNew}
              className="px-4 py-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-black hover:bg-emerald-100 transition"
            >
              بدء جرد جديد
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-2xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-500 shadow-lg shadow-emerald-600/20 transition"
          >
            إغلاق ومغادرة
          </button>
        </div>
      </div>
    </div>
  )
}
