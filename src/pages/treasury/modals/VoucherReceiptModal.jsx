import React, { useRef } from 'react'
import {
  X,
  Printer,
  FileText,
  CheckCircle2,
  Landmark,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  Building,
  User,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { tafqeetCurrency } from '../../../utils/tafqeet'
import { escapeHtml } from '../../../utils/htmlEscape'
import { parseSqlDate } from '../../../utils/sqlDate'

export default function VoucherReceiptModal({ isOpen, onClose, voucher, settings }) {
  const printingRef = useRef(false) // ضغطتين على الطباعة = نافذة واحدة

  if (!isOpen || !voucher) return null

  const currency = settings?.currency_symbol || settings?.currency || 'ج.م'
  const storeName = settings?.store_name || settings?.shop_name || 'NEXA POS'
  const storeAddress = settings?.address || ''
  const storePhone = settings?.phone || ''

  const isDeposit = voucher.type === 'deposit'
  const isTransfer = voucher.type === 'transfer'
  const isWithdrawal = voucher.type === 'withdrawal'

  const voucherTitle = isDeposit
    ? 'سند قبض نقدية (Cash Receipt)'
    : isTransfer
    ? 'سند تحويل داخلي (Cash Transfer)'
    : 'سند صرف نقدية (Payment Voucher)'

  const totalBill = voucher.total_bill_amount || voucher.amount
  const paidAmt = voucher.paid_amount || voucher.amount
  const remainingAmt = voucher.remaining_amount || 0

  // كل قيمة جاية من المستخدم أو من بيانات المحل بتتهرّب (escapeHtml) قبل ما تدخل الـHTML بتاع الطباعة
  const handlePrint = async () => {
    if (printingRef.current) return
    printingRef.current = true
    try {
      await printVoucher()
    } finally {
      printingRef.current = false
    }
  }

  const printVoucher = async () => {
    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(voucher.voucher_number || 'Voucher')}</title>
        <style>
          @page { size: auto; margin: 15mm; }
          body {
            font-family: system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif;
            color: #0f172a;
            direction: rtl;
            text-align: right;
            margin: 0;
            padding: 24px;
            background: #fff;
          }
          .header {
            text-align: center;
            border-bottom: 2px solid #064e3b;
            padding-bottom: 16px;
            margin-bottom: 20px;
          }
          .header h1 { margin: 0 0 6px; font-size: 24px; color: #064e3b; font-weight: 900; }
          .header p { margin: 0; font-size: 13px; color: #475569; }
          .voucher-title {
            display: inline-block;
            background: #ecfdf5;
            border: 1px solid #a7f3d0;
            color: #065f46;
            padding: 8px 24px;
            border-radius: 9999px;
            font-size: 16px;
            font-weight: 900;
            margin-top: 12px;
          }
          .meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 20px;
            font-size: 13px;
            background: #f8fafc;
            padding: 12px 16px;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
          }
          .box {
            border: 2px solid #059669;
            border-radius: 12px;
            padding: 16px;
            background: #f0fdf4;
            margin-bottom: 20px;
            text-align: center;
          }
          .amount-row {
            font-size: 24px;
            font-weight: 900;
            color: #064e3b;
            margin-bottom: 8px;
            font-family: monospace;
          }
          .tafqeet {
            font-size: 14px;
            color: #047857;
            font-weight: bold;
          }
          .details-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            margin-bottom: 30px;
          }
          .details-table td {
            padding: 10px 14px;
            border-bottom: 1px solid #e2e8f0;
          }
          .details-table td:first-child {
            font-weight: bold;
            color: #475569;
            width: 28%;
            background: #f8fafc;
          }
          .signatures {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 20px;
            text-align: center;
            margin-top: 60px;
            font-size: 13px;
          }
          .sig-line {
            border-top: 1px dashed #94a3b8;
            margin-top: 45px;
            padding-top: 8px;
            color: #64748b;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${escapeHtml(storeName)}</h1>
          ${storeAddress ? `<p>${escapeHtml(storeAddress)}</p>` : ''}
          ${storePhone ? `<p>هاتف: ${escapeHtml(storePhone)}</p>` : ''}
          <div class="voucher-title">${voucherTitle}</div>
        </div>

        <div class="meta-grid">
          <div><strong>رقم السند:</strong> ${escapeHtml(voucher.voucher_number || `VCH-${voucher.id}`)}</div>
          <div><strong>التاريخ:</strong> ${escapeHtml(parseSqlDate(voucher.created_at)?.toLocaleString('ar-EG') || new Date().toLocaleString('ar-EG'))}</div>
          <div><strong>المستخدم / المسؤول:</strong> ${escapeHtml(voucher.user_name || 'المدير')}</div>
          <div><strong>الجهة:</strong> ${voucher.source_container === 'drawer' ? 'درج الكاشير' : 'الخزنة الرئيسية'}</div>
        </div>

        <div class="box">
          <div class="amount-row">
            ${Number(paidAmt || 0).toFixed(2)} ${escapeHtml(currency)}
          </div>
          <div class="tafqeet">
            فقط وقدره: ${escapeHtml(tafqeetCurrency(Number(paidAmt || 0), currency))} لا غير.
          </div>
        </div>

        <table class="details-table">
          <tr>
            <td>البيان / العنوان:</td>
            <td><strong>${escapeHtml(voucher.title || '—')}</strong></td>
          </tr>
          ${voucher.beneficiary_name ? `
            <tr>
              <td>المستفيد / الطرف:</td>
              <td>${escapeHtml(voucher.beneficiary_name)} (${voucher.beneficiary_type === 'employee' ? 'موظف' : voucher.beneficiary_type === 'partner' ? 'شريك' : 'طرف خارجي'})</td>
            </tr>
          ` : ''}
          <tr>
            <td>التصنيف المحاسبي:</td>
            <td>${escapeHtml(voucher.category || 'عام')}</td>
          </tr>
          ${remainingAmt > 0 ? `
            <tr>
              <td>إجمالي قيمة الفاتورة:</td>
              <td>${Number(totalBill || 0).toFixed(2)} ${escapeHtml(currency)}</td>
            </tr>
            <tr>
              <td>المتبقي كالتزام آجل:</td>
              <td><strong style="color: #b91c1c;">${Number(remainingAmt || 0).toFixed(2)} ${escapeHtml(currency)}</strong></td>
            </tr>
          ` : ''}
          ${voucher.notes ? `
            <tr>
              <td>ملاحظات:</td>
              <td>${escapeHtml(voucher.notes)}</td>
            </tr>
          ` : ''}
        </table>

        <div class="signatures">
          <div>
            <div>توقيع المستلم</div>
            <div class="sig-line">الاسم والتوقيع</div>
          </div>
          <div>
            <div>أمين الخزنة / المحاسب</div>
            <div class="sig-line">${escapeHtml(voucher.user_name || 'المحاسب')}</div>
          </div>
          <div>
            <div>الاعتماد / الإدارة</div>
            <div class="sig-line">توقيع المسؤول</div>
          </div>
        </div>
      </body>
      </html>
    `

    if (window.mgpos?.printA4) {
      await window.mgpos.printA4(html, { title: voucher.voucher_number || 'Voucher' })
    } else {
      const win = window.open('', '_blank')
      if (win) {
        win.document.write(html)
        win.document.close()
        win.focus()
        win.print()
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-lg overflow-hidden flex flex-col text-slate-800 max-h-[92vh] font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-slate-50">
          <div className="flex items-center gap-3.5">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-md ${
                isDeposit
                  ? 'bg-gradient-to-br from-emerald-500 to-teal-700 shadow-emerald-950/20'
                  : isWithdrawal
                  ? 'bg-gradient-to-br from-rose-500 to-rose-700 shadow-rose-950/20'
                  : 'bg-gradient-to-br from-teal-600 to-cyan-800 shadow-teal-950/20'
              }`}
            >
              {isDeposit ? (
                <ArrowUpRight size={22} />
              ) : isWithdrawal ? (
                <ArrowDownRight size={22} />
              ) : (
                <ArrowLeftRight size={22} />
              )}
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-slate-900">{voucherTitle}</h3>
              <p className="text-xs text-slate-500 font-mono font-bold">
                {voucher.voucher_number || `VCH-${voucher.id}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="text-slate-400 hover:text-slate-700 p-2 rounded-2xl hover:bg-slate-100 transition active:scale-90"
          >
            <X size={20} />
          </button>
        </div>

        {/* Voucher Preview Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Amount Box */}
          <div className="p-5 rounded-3xl bg-gradient-to-b from-emerald-50/80 to-teal-50/50 border border-emerald-200/90 text-center space-y-2 shadow-2xs">
            <span className="text-xs font-black text-emerald-900">المبلغ المدفوع / المقبوض بالسند</span>
            <div className="text-3xl font-black text-slate-900 font-mono">
              {Number(paidAmt || 0).toFixed(2)}{' '}
              <span className="text-base text-emerald-700 font-bold">{currency}</span>
            </div>
            <p className="text-xs text-emerald-950 font-bold pt-2 border-t border-emerald-200/70">
              فقط وقدره: {tafqeetCurrency(Number(paidAmt || 0), currency)} لا غير.
            </p>
          </div>

          {/* Details Table */}
          <div className="space-y-2.5 text-xs text-slate-700 bg-slate-50/80 p-4 rounded-3xl border border-slate-200/90">
            <div className="flex justify-between py-1 border-b border-slate-200/70">
              <span className="text-slate-500 font-medium">البيان:</span>
              <span className="font-black text-slate-900 text-left">{voucher.title}</span>
            </div>

            {voucher.beneficiary_name && (
              <div className="flex justify-between py-1 border-b border-slate-200/70">
                <span className="text-slate-500 font-medium">المستفيد:</span>
                <span className="font-bold text-slate-800">
                  {voucher.beneficiary_name} (
                  {voucher.beneficiary_type === 'employee'
                    ? 'موظف'
                    : voucher.beneficiary_type === 'partner'
                    ? 'شريك'
                    : 'طرف خارجي'}
                  )
                </span>
              </div>
            )}

            <div className="flex justify-between py-1 border-b border-slate-200/70">
              <span className="text-slate-500 font-medium">التصنيف المحاسبي:</span>
              <span className="font-bold text-slate-800">{voucher.category || 'عام'}</span>
            </div>

            <div className="flex justify-between py-1 border-b border-slate-200/70">
              <span className="text-slate-500 font-medium">الجهة / الحاوية:</span>
              <span className="font-bold text-slate-800">
                {voucher.source_container === 'drawer' || voucher.destination_container === 'drawer'
                  ? 'درج الكاشير'
                  : 'الخزنة الرئيسية'}
              </span>
            </div>

            {remainingAmt > 0 && (
              <div className="flex justify-between py-1 border-b border-slate-200/70 text-rose-700 font-bold">
                <span>المتبقي كالتزام آجل:</span>
                <span className="font-mono font-black">{Number(remainingAmt).toFixed(2)} {currency}</span>
              </div>
            )}

            {voucher.notes && (
              <div className="flex justify-between py-1 text-slate-600">
                <span className="text-slate-500 font-medium">ملاحظات:</span>
                <span className="text-left font-medium">{voucher.notes}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between p-4 px-6 border-t border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-2xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
          >
            إغلاق
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-600 hover:to-emerald-700 text-white text-xs font-black shadow-lg shadow-emerald-950/20 transition active:scale-95 flex items-center gap-2 cursor-pointer"
          >
            <Printer size={16} />
            <span>طباعة الإيصال المالي</span>
          </button>
        </div>
      </div>
    </div>
  )
}
