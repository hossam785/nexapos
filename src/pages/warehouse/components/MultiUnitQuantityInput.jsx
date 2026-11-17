function normalizeDigits(val) {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩'
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹'
  return String(val ?? '')
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
}

export default function MultiUnitQuantityInput({
  product,
  physicalPacks = '',
  physicalUnits = '',
  physicalQuantity = '',
  isUncounted = false,
  onChange,
  onEnter,
  disabled = false,
  autoFocus = false,
  className = '',
}) {
  const packsInputRef = useRef(null)
  const unitsInputRef = useRef(null)

  const isMultiUnit = Boolean(product?.dozen_enabled && Number(product?.dozen_quantity) > 1)
  const packSize = isMultiUnit ? Number(product.dozen_quantity) : 1
  const isPiece = product?.unit === 'piece'

  useEffect(() => {
    if (autoFocus) {
      if (isMultiUnit && packsInputRef.current) {
        packsInputRef.current.focus()
        packsInputRef.current.select?.()
      } else if (unitsInputRef.current) {
        unitsInputRef.current.focus()
        unitsInputRef.current.select?.()
      }
    }
  }, [autoFocus, isMultiUnit])

  const handlePacksChange = (e) => {
    const val = normalizeDigits(e.target.value).trim()
    if (val === '') {
      const unitsVal = physicalUnits === '' ? 0 : Number(physicalUnits)
      onChange?.({
        packs: '',
        units: physicalUnits,
        total: unitsVal,
        isUncounted: unitsVal === 0 && val === '',
      })
      return
    }
    const num = Math.max(0, parseInt(val, 10) || 0)
    const unitsVal = physicalUnits === '' ? 0 : Number(physicalUnits)
    const total = (num * packSize) + unitsVal
    onChange?.({
      packs: num,
      units: physicalUnits === '' ? 0 : unitsVal,
      total,
      isUncounted: false,
    })
  }

  const handleUnitsChange = (e) => {
    const val = normalizeDigits(e.target.value).trim()
    if (val === '') {
      const packsVal = physicalPacks === '' ? 0 : Number(physicalPacks)
      const total = packsVal * packSize
      onChange?.({
        packs: physicalPacks,
        units: '',
        total,
        isUncounted: packsVal === 0 && val === '',
      })
      return
    }
    const num = isPiece
      ? Math.max(0, parseInt(val, 10) || 0)
      : Math.max(0, parseFloat(val) || 0)

    const packsVal = physicalPacks === '' ? 0 : Number(physicalPacks)
    const total = (packsVal * packSize) + num
    onChange?.({
      packs: physicalPacks === '' && isMultiUnit ? 0 : packsVal,
      units: num,
      total,
      isUncounted: false,
    })
  }

  const handleKeyDown = (e, field) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (field === 'packs' && unitsInputRef.current) {
        unitsInputRef.current.focus()
        unitsInputRef.current.select?.()
      } else {
        onEnter?.()
      }
    }
  }

  if (!isMultiUnit) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <div className="relative flex-1 min-w-[90px]">
          <input
            ref={unitsInputRef}
            type="number"
            min="0"
            step={isPiece ? '1' : '0.01'}
            disabled={disabled}
            placeholder={isUncounted ? 'غير مجرود' : '0'}
            value={isUncounted ? '' : (physicalQuantity ?? physicalUnits ?? '')}
            onChange={handleUnitsChange}
            onKeyDown={(e) => handleKeyDown(e, 'units')}
            className={`w-full text-center font-mono font-bold text-sm px-2.5 py-1.5 rounded-lg border transition-all duration-150 focus:outline-none focus:ring-2 ${
              isUncounted
                ? 'bg-slate-50  text-slate-400 border-slate-200  placeholder:text-slate-400 placeholder:text-xs'
                : 'bg-white  text-slate-800  border-slate-300  focus:border-emerald-500 focus:ring-emerald-500/20'
            } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
        </div>
        <span className="text-[11px] font-bold text-slate-400  shrink-0 select-none">
          {product?.unit || 'قطعة'}
        </span>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {/* Packs (Cartons/Dozens) input */}
      <div className="relative w-20">
        <input
          ref={packsInputRef}
          type="number"
          min="0"
          step="1"
          disabled={disabled}
          placeholder="0"
          value={isUncounted ? '' : (physicalPacks ?? '')}
          onChange={handlePacksChange}
          onKeyDown={(e) => handleKeyDown(e, 'packs')}
          className={`w-full text-center font-mono font-bold text-sm px-2 py-1.5 rounded-lg border transition-all duration-150 focus:outline-none focus:ring-2 ${
            isUncounted
              ? 'bg-slate-50  text-slate-400 border-slate-200 '
              : 'bg-white  text-slate-800  border-slate-300  focus:border-emerald-500 focus:ring-emerald-500/20'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        />
        <span className="absolute -bottom-4 right-1 text-[9px] font-black text-emerald-600  select-none">
          كرتونة (×{packSize})
        </span>
      </div>

      <span className="text-slate-400  font-bold select-none text-xs pb-1">+</span>

      {/* Loose units input */}
      <div className="relative w-16">
        <input
          ref={unitsInputRef}
          type="number"
          min="0"
          step={isPiece ? '1' : '0.01'}
          disabled={disabled}
          placeholder="0"
          value={isUncounted ? '' : (physicalUnits ?? '')}
          onChange={handleUnitsChange}
          onKeyDown={(e) => handleKeyDown(e, 'units')}
          className={`w-full text-center font-mono font-bold text-sm px-2 py-1.5 rounded-lg border transition-all duration-150 focus:outline-none focus:ring-2 ${
            isUncounted
              ? 'bg-slate-50  text-slate-400 border-slate-200 '
              : 'bg-white  text-slate-800  border-slate-300  focus:border-emerald-500 focus:ring-emerald-500/20'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        />
        <span className="absolute -bottom-4 right-1 text-[9px] font-bold text-slate-400 select-none">
          قطع فرط
        </span>
      </div>

      {/* Total display badge */}
      {!isUncounted && (
        <span
          className="text-xs font-mono font-black text-slate-700  bg-slate-100  px-2 py-1 rounded-md border border-slate-200  shrink-0 select-none"
          title={`الإجمالي المعياري: ${physicalQuantity || 0} ${product?.unit || 'قطعة'}`}
        >
          ={physicalQuantity || 0}
        </span>
      )}
    </div>
  )
}
