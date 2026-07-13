import { useEffect, useRef, useState } from 'react'
import { X, Printer, Tag, Plus, Minus } from 'lucide-react'
import JsBarcode from 'jsbarcode'

export default function BarcodeModal({ product, settings, onClose }) {
  const svgRef = useRef()
  const [copies, setCopies] = useState(1)
  const [error, setError] = useState(false)
  const [labelMode, setLabelMode] = useState('unit')
  const [barcodeWidth, setBarcodeWidth] = useState(220)
  const [barcodeHeight, setBarcodeHeight] = useState(70)

  const currency = settings?.currency || '\u062c.\u0645'
  const storeName = String(settings?.store_name || '').trim() || 'MGIVIA'
  const safeBarcodeWidth = Math.max(120, Math.min(420, Number(barcodeWidth) || 220))
  const safeBarcodeHeight = Math.max(35, Math.min(160, Number(barcodeHeight) || 70))
  const productTaxValue = Math.max(0, Number(product?.product_tax_rate || 0) || 0)
  const applyProductTax = (price) => {
    const basePrice = Number(price || 0)
    return basePrice + (
      product?.product_tax_type === 'fixed'
        ? productTaxValue
        : basePrice * (productTaxValue / 100)
    )
  }
  const unitDisplayPrice = applyProductTax(product?.sell_price || 0)
  const dozenQuantity = Math.max(1, Number(product?.dozen_quantity || 0) || 1)
  const dozenDisplayPrice = product?.dozen_price_same_as_unit
    ? applyProductTax(Number(product?.sell_price || 0) * dozenQuantity)
    : applyProductTax(product?.dozen_price || 0)
  const canPrintDozen = Boolean(product?.dozen_enabled)
  const activeBarcode = labelMode === 'dozen' ? product?.dozen_barcode : product?.barcode
  const activeName = labelMode === 'dozen'
    ? `${product?.name || ''} - \u062f\u0633\u062a\u0629 x ${dozenQuantity}`
    : product?.name
  const activePrice = labelMode === 'dozen' ? dozenDisplayPrice : unitDisplayPrice

  useEffect(() => {
    if (labelMode === 'dozen' && !canPrintDozen) {
      setLabelMode('unit')
    }
  }, [canPrintDozen, labelMode])

  useEffect(() => {
    if (!svgRef.current || !activeBarcode) {
      setError(true)
      return
    }
    try {
      JsBarcode(svgRef.current, activeBarcode, {
        format: product?.barcode_type || 'CODE128',
        width: 2,
        height: safeBarcodeHeight,
        displayValue: false,
        margin: 8,
        background: 'transparent',
      })
      setError(false)
    } catch {
      setError(true)
    }
  }, [activeBarcode, product?.barcode_type, safeBarcodeHeight])

  async function handlePrint() {
    if (!activeBarcode) return

    const svgEl = svgRef.current
    const svgString = svgEl ? svgEl.outerHTML : ''
    const labels = Array.from({ length: copies }, () => `
      <div class="label">
        <div class="store-name">${storeName}</div>
        <div class="prod-name">${activeName}</div>
        <div class="barcode-wrap">${svgString}</div>
        <div class="barcode-num">${activeBarcode}</div>
        <div class="price">${activePrice.toFixed(2)} ${currency}</div>
      </div>
    `).join('')

    const html = `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8"/>
        <title>Print Barcode - ${activeName}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; background: #fff; }
          .wrapper { display: flex; flex-wrap: wrap; gap: 12px; padding: 12px; }
          .label {
            text-align: center;
            border: 1px dashed #ccc;
            padding: 10px 14px;
            border-radius: 8px;
            width: ${Math.max(180, safeBarcodeWidth + 36)}px;
          }
          .store-name { font-size: 12px; font-weight: 800; color: #111827; margin-bottom: 3px; }
          .prod-name { font-size: 13px; font-weight: bold; margin-bottom: 6px; }
          .barcode-wrap svg { width: ${safeBarcodeWidth}px; height: ${safeBarcodeHeight}px; max-width: 100%; }
          .barcode-num { font-size: 10px; color: #555; margin-top: 4px; }
          .price { font-size: 14px; font-weight: bold; color: #1a6b2e; margin-top: 4px; }
        </style>
      </head>
      <body>
        <div class="wrapper">${labels}</div>
      </body>
      </html>
    `

    await window.mgpos.print(html, {})
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 backdrop-blur-sm" dir="rtl">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
        style={{ animation: 'modalSlideUp 0.25s ease-out' }}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <Tag size={20} className="text-emerald-800" />
            {'\u0637\u0628\u0627\u0639\u0629 \u0628\u0627\u0631\u0643\u0648\u062f'}
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <div className="bg-slate-50 rounded-2xl p-6 flex flex-col items-center gap-3 border border-slate-100">
            <div className="text-sm font-black text-slate-700">{storeName}</div>
            <h3 className="text-lg font-black text-slate-800">{activeName}</h3>

            {canPrintDozen && (
              <div className="grid w-full grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setLabelMode('unit')}
                  className={`rounded-lg px-3 py-2 text-xs font-black transition ${labelMode === 'unit' ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {'\u0628\u0627\u0631\u0643\u0648\u062f \u0627\u0644\u0642\u0637\u0639\u0629'}
                </button>
                <button
                  type="button"
                  onClick={() => setLabelMode('dozen')}
                  className={`rounded-lg px-3 py-2 text-xs font-black transition ${labelMode === 'dozen' ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {'\u0628\u0627\u0631\u0643\u0648\u062f \u0627\u0644\u062f\u0633\u062a\u0629'}
                </button>
              </div>
            )}

            {!activeBarcode ? (
              <div className="text-red-500 text-sm font-medium py-4">
                {'\u0647\u0630\u0627 \u0627\u0644\u0627\u062e\u062a\u064a\u0627\u0631 \u0644\u064a\u0633 \u0644\u0647 \u0628\u0627\u0631\u0643\u0648\u062f'}
              </div>
            ) : error ? (
              <div className="text-red-500 text-sm font-medium py-4">
                {'\u062e\u0637\u0623 \u0641\u064a \u062a\u0648\u0644\u064a\u062f \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f'}
              </div>
            ) : (
              <svg
                ref={svgRef}
                className="max-w-full"
                style={{ width: `${safeBarcodeWidth}px`, height: `${safeBarcodeHeight}px` }}
              />
            )}

            {activeBarcode && !error && (
              <span className="text-slate-500 text-sm font-mono">{activeBarcode}</span>
            )}

            <span className="text-green-600 font-black text-xl">
              {activePrice.toFixed(2)} {currency}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-black text-slate-600">{'\u0639\u0631\u0636 \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f'}</label>
              <input
                type="number"
                min="120"
                max="420"
                value={barcodeWidth}
                onChange={(e) => setBarcodeWidth(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-black text-slate-800 focus:border-emerald-500 focus:outline-none"
                dir="ltr"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-black text-slate-600">{'\u0637\u0648\u0644 \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f'}</label>
              <input
                type="number"
                min="35"
                max="160"
                value={barcodeHeight}
                onChange={(e) => setBarcodeHeight(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-black text-slate-800 focus:border-emerald-500 focus:outline-none"
                dir="ltr"
              />
            </div>
          </div>

          <div className="flex items-center justify-between mt-5">
            <label className="text-sm font-bold text-slate-600">{'\u0639\u062f\u062f \u0627\u0644\u0646\u0633\u062e:'}</label>
            <div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1">
              <button
                onClick={() => setCopies(c => Math.max(1, c - 1))}
                className="w-9 h-9 rounded-lg bg-white shadow-sm flex items-center justify-center text-slate-600 hover:text-red-500 transition"
              >
                <Minus size={15} />
              </button>
              <span className="w-10 text-center font-black text-slate-800 text-lg">{copies}</span>
              <button
                onClick={() => setCopies(c => Math.min(100, c + 1))}
                className="w-9 h-9 rounded-lg bg-white shadow-sm flex items-center justify-center text-slate-600 hover:text-green-600 transition"
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={handlePrint}
            disabled={!activeBarcode || error}
            className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl shadow-lg shadow-green-600/20 transition"
          >
            <Printer size={18} />
            {'\u0637\u0628\u0627\u0639\u0629 \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes modalSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)     scale(1); }
        }
      `}</style>
    </div>
  )
}