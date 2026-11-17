import { Fragment, useState, useEffect, useCallback, useRef } from 'react'
import { MonitorSmartphone, RefreshCw, AlertTriangle, Copy, Check, Link2, Eye, EyeOff, ChevronDown, ChevronUp, Wifi } from 'lucide-react'

const fmtQty = (n) => Number(n || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 })
const fmtMoney = (n) => Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const parseDate = (d) => new Date(typeof d === 'string' && d.includes(' ') && !/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? `${d.replace(' ', 'T')}Z` : d)
const fmtTime = (d) => (d ? parseDate(d).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const cleanError = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * Admin page: every device of the store, how to connect a new one, and stock sold without
 * stock on record (e.g. two cashiers selling the same last pieces while disconnected).
 * The shortage list is computed from the movements every device has, so it is the same on all
 * devices once they have exchanged their data.
 */
export default function StoreSyncView({ from, to }) {
  const [devices, setDevices] = useState([])
  const [status, setStatus] = useState(null)
  const [shortages, setShortages] = useState({ products: [], totals: { products: 0, openShortage: 0, totalShortage: 0 } })
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [showCode, setShowCode] = useState(false)
  const [copied, setCopied] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinMessage, setJoinMessage] = useState(null)
  // a device that already has data: merge back into the store it left, or wipe and take the store's data
  const [joinMode, setJoinMode] = useState('merge')
  const [replacePassword, setReplacePassword] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [leaveConfirm, setLeaveConfirm] = useState(null) // null | { unsent?: string }
  const [peers, setPeers] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [savingPeers, setSavingPeers] = useState(false)
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(async () => {
    if (!window.mgpos?.store) return
    setError('')
    try {
      const [d, st, sh] = await Promise.all([
        window.mgpos.store.getDevices(),
        window.mgpos.store.getStatus(),
        window.mgpos.store.getShortages({ from, to, onlyOpen }),
      ])
      setDevices(d || [])
      setStatus(st || null)
      setShortages(sh || { products: [], totals: {} })
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setLoading(false)
    }
  }, [from, to, onlyOpen])

  useEffect(() => {
    load()
    const off = window.mgpos?.store?.onDataChanged?.(() => load())
    return () => { if (typeof off === 'function') off() }
  }, [load])

  async function revealCode() {
    if (showCode) { setShowCode(false); return }
    try {
      setPairingCode((await window.mgpos.store.getPairingCode()) || '')
      setShowCode(true)
    } catch (e) {
      setError(cleanError(e))
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(pairingCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      setError('تعذر النسخ، انسخ الكود يدويًا')
    }
  }

  // a second click before the screen re-renders must not run the join twice (a replace wipes the device)
  const joinGuard = useRef(false)
  const hasOwnData = status?.canJoinAnotherStore === false
  const effectiveJoinMode = hasOwnData ? (status?.leftStore ? joinMode : 'replace') : 'fresh'

  async function join() {
    if (joining || joinGuard.current || !joinCode.trim()) return
    joinGuard.current = true
    if (effectiveJoinMode === 'replace' && !replacePassword) {
      setJoinMessage({ ok: false, text: 'اكتب كلمة مرور المدير: بيانات الجهاز ده هتتمسح (بعد نسخة احتياطية تلقائية) وهتنزل بيانات المحل مكانها.' })
      return
    }
    setJoining(true)
    setJoinMessage(null)
    try {
      await window.mgpos.store.join(joinCode.trim(), { mode: effectiveJoinMode, adminPassword: effectiveJoinMode === 'replace' ? replacePassword : undefined })
      setJoinMessage({
        ok: true,
        text: effectiveJoinMode === 'merge'
          ? 'رجع الجهاز للمحل. اللي اتعمل عليه وهو مفصول بيوصل للأجهزة التانية، واللي اتعمل عندهم بينزل عليه.'
          : 'تم ربط الجهاز بالمحل. البيانات بتنزل من الأجهزة التانية دلوقتي.',
      })
      setJoinCode('')
      setReplacePassword('')
      load()
    } catch (e) {
      setJoinMessage({ ok: false, text: cleanError(e) })
    } finally {
      joinGuard.current = false
      setJoining(false)
    }
  }

  async function leave(force = false) {
    if (leaving) return
    setLeaving(true)
    setJoinMessage(null)
    try {
      await window.mgpos.store.leave({ force })
      setLeaveConfirm(null)
      setJoinMessage({ ok: true, text: 'اتفصل الجهاز عن المحل، وبقى محل لوحده ببياناته. الأجهزة التانية ماتأثرتش. تقدر ترجّعه بكود ربط نفس المحل وتختار الدمج.' })
      load()
    } catch (e) {
      const text = cleanError(e)
      // own events nobody received yet: say so and let the owner decide
      if (/لسه ماوصلتش/.test(text)) setLeaveConfirm({ unsent: text })
      else setJoinMessage({ ok: false, text })
    } finally {
      setLeaving(false)
    }
  }

  async function savePeers() {
    if (savingPeers) return
    setSavingPeers(true)
    try {
      setPeers(await window.mgpos.store.setPeers(peers))
      setJoinMessage({ ok: true, text: 'تم حفظ عناوين الأجهزة' })
    } catch (e) {
      setJoinMessage({ ok: false, text: cleanError(e) })
    } finally {
      setSavingPeers(false)
    }
  }

  async function syncNow() {
    if (syncing) return
    setSyncing(true)
    try {
      await window.mgpos.store.syncNow()
      await load()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setSyncing(false)
    }
  }

  const peerByUuid = new Map((status?.peers || []).map((p) => [p.deviceUuid, p]))
  const card = 'rounded-2xl border border-slate-200 bg-white p-5'

  return (
    <div className="space-y-5" dir="rtl">
      {error && <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>}

      {/* Shortages */}
      <section className={card} aria-labelledby="shortage-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 id="shortage-title" className="flex items-center gap-2 text-base font-black text-slate-900">
            <AlertTriangle size={18} className="text-amber-600" /> عجز المخزون (اتباع أكتر من الرصيد)
          </h3>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} className="h-4 w-4 accent-emerald-700" />
            اللي لسه رصيدها بالسالب بس
          </label>
        </div>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">أصناف فيها عجز</p><p className="text-xl font-black text-slate-900">{fmtQty(shortages.totals?.products)}</p></div>
          <div className="rounded-xl bg-amber-50 p-3"><p className="text-xs font-bold text-amber-700">العجز المفتوح دلوقتي</p><p className="text-xl font-black text-amber-800">{fmtQty(shortages.totals?.openShortage)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">إجمالي اللي اتباع من غير رصيد في الفترة</p><p className="text-xl font-black text-slate-900">{fmtQty(shortages.totals?.totalShortage)}</p></div>
        </div>
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-500">جاري التحميل…</p>
        ) : shortages.products.length === 0 ? (
          <p className="py-6 text-center text-sm font-bold text-emerald-700">مفيش عجز في الفترة دي. كل البيع كان على رصيد موجود.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-slate-200 text-right text-xs text-slate-500">
                <th className="py-2 font-bold">الصنف</th><th className="py-2 font-bold">الرصيد الحالي</th><th className="py-2 font-bold">العجز المفتوح</th><th className="py-2 font-bold">اتباع بدون رصيد</th><th className="py-2 font-bold">مرات</th><th />
              </tr></thead>
              <tbody>
                {shortages.products.map((p) => (
                  <Fragment key={p.productId}>
                    <tr className="border-b border-slate-100">
                      <td className="py-2 font-bold text-slate-900">{p.productName}<span className="block text-xs font-normal text-slate-500" dir="ltr">{p.barcode || ''}</span></td>
                      <td className={`py-2 font-black ${p.currentQuantity < 0 ? 'text-rose-700' : 'text-slate-800'}`} dir="ltr" style={{ textAlign: 'right' }}>{fmtQty(p.currentQuantity)}</td>
                      <td className="py-2 font-black text-amber-800">{fmtQty(p.openShortage)}</td>
                      <td className="py-2">{fmtQty(p.totalShortage)}</td>
                      <td className="py-2">{p.events.length}</td>
                      <td className="py-2 text-left">
                        <button type="button" onClick={() => setExpanded(expanded === p.productId ? null : p.productId)} aria-expanded={expanded === p.productId} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                          التفاصيل {expanded === p.productId ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                    </tr>
                    {expanded === p.productId && (
                      <tr><td colSpan={6} className="bg-slate-50 p-3">
                        <table className="w-full text-xs">
                          <thead><tr className="text-right text-slate-500"><th className="py-1">الوقت</th><th className="py-1">الجهاز</th><th className="py-1">الكاشير</th><th className="py-1">الفاتورة</th><th className="py-1">الرصيد قبل</th><th className="py-1">اتباع</th><th className="py-1">بعد</th><th className="py-1">العجز</th></tr></thead>
                          <tbody>
                            {p.events.map((e) => (
                              <tr key={e.deltaUuid} className="border-t border-slate-200">
                                <td className="py-1">{fmtTime(e.createdAt)}</td><td className="py-1 font-bold">{e.deviceCode || '—'}</td><td className="py-1">{e.cashier || '—'}</td>
                                <td className="py-1" dir="ltr" style={{ textAlign: 'right' }}>{e.invoiceNumber || '—'}</td><td className="py-1">{fmtQty(e.quantityBefore)}</td>
                                <td className="py-1">{fmtQty(e.sold)}</td><td className="py-1">{fmtQty(e.quantityAfter)}</td><td className="py-1 font-black text-amber-800">{fmtQty(e.shortage)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-2 text-xs text-slate-500">للتسوية: اعمل جرد أو إضافة مخزون للصنف من شاشة المخازن، والتسوية هتتزامن لكل الأجهزة.</p>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Devices */}
      <section className={card} aria-labelledby="devices-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 id="devices-title" className="flex items-center gap-2 text-base font-black text-slate-900"><MonitorSmartphone size={18} className="text-emerald-700" /> أجهزة المحل</h3>
          <button type="button" onClick={syncNow} disabled={syncing} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-60">
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> مزامنة الآن
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-slate-200 text-right text-xs text-slate-500">
              <th className="py-2 font-bold">الجهاز</th><th className="py-2 font-bold">الحالة على الشبكة</th><th className="py-2 font-bold">آخر تواصل</th><th className="py-2 font-bold">فواتيره</th><th className="py-2 font-bold">مبيعاته</th>
            </tr></thead>
            <tbody>
              {devices.map((d) => {
                const peer = peerByUuid.get(d.deviceUuid)
                const online = d.isThisDevice || (peer?.lastSyncAt && Date.now() - new Date(peer.lastSyncAt).getTime() < 60000)
                return (
                  <tr key={d.deviceUuid} className="border-b border-slate-100">
                    <td className="py-2 font-black text-slate-900" dir="ltr" style={{ textAlign: 'right' }}>{d.deviceCode || '—'}{d.isThisDevice && <span className="mr-2 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">الجهاز ده</span>}</td>
                    <td className="py-2"><span className={`inline-flex items-center gap-1 text-xs font-bold ${online ? 'text-emerald-700' : 'text-slate-500'}`}><Wifi size={14} />{online ? 'متصل' : 'غير متصل'}</span></td>
                    <td className="py-2 text-xs">{fmtTime(peer?.lastSyncAt || d.lastContactAt || d.lastEventAt)}</td>
                    <td className="py-2">{fmtQty(d.invoices)}</td>
                    <td className="py-2">{fmtMoney(d.sales)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {status?.waitingEvents > 0 && <p className="mt-3 text-xs font-bold text-amber-700">{fmtQty(status.waitingEvents)} حركة مستنية بيانات لسه ماوصلتش من جهاز تاني، وهتتطبق أول ما توصل.</p>}
        {status?.separatedDevices?.length > 0 && (
          <div role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-6 text-amber-900">
            <p className="mb-1 font-black">أجهزة اتربطت بالجهاز ده وهو مفصول. اللي اتباع عليها لحد الدمج وصل للمحل، ومتحسبش غير مرة واحدة:</p>
            <ul className="mb-1 list-disc pr-5">
              {status.separatedDevices.map((d) => (
                <li key={d.deviceUuid}><span dir="ltr" className="font-mono font-bold">{d.deviceCode || String(d.deviceUuid).slice(0, 8)}</span></li>
              ))}
            </ul>
            <p className="mb-1">من دلوقتي الأجهزة دي مابتتزامنش مع المحل: ماتبيعش عليها، وكل جهاز يتربط بالمحل تاني بكود الربط بتاع المحل (اختار «امسح بيانات الجهاز ده وخد بيانات المحل»، والمسح بياخد نسخة احتياطية تلقائيًا). اللي يتسجل عليها بعد كده بيفضل عليها بس لحد ما تتربط.</p>
          </div>
        )}
        {(status?.transfer?.active || status?.transfer?.backlog > 0) && <p role="status" className="mt-3 text-xs font-bold text-sky-700">الجهاز ده بينسخ بيانات المحل من جهاز تاني (أول ربط أو رجوع بعد غياب طويل). البيع شغال عادي، والفواتير القديمة بتكمل في الخلفية.</p>}
        {!status?.transfer?.active && status?.transfer?.last?.status === 'waiting' && status.transfer.last.reason === 'PEER_BEHIND_MY_LOG' && <p role="alert" className="mt-3 text-xs font-bold text-amber-700">الجهاز ده مستني الجهاز التاني يقرا حركاته الأول قبل ما ينسخ منه بيانات المحل. لو الرسالة دي فضلت أكتر من يوم، الجهازين اتفصلوا عن بعض فترة طويلة جدًا وكل واحد مسح سجلات التاني ماشافهاش: كلّم الدعم الفني قبل أي تعديل.</p>}
      </section>

      {/* Connect devices */}
      <section className={card} aria-labelledby="connect-title">
        <h3 id="connect-title" className="mb-3 flex items-center gap-2 text-base font-black text-slate-900"><Link2 size={18} className="text-emerald-700" /> ربط جهاز جديد بالمحل</h3>
        <p className="mb-3 text-sm leading-6 text-slate-600">
          على الجهاز الجديد: سجّل دخول كأدمن، افتح التقارير ← الأجهزة والعجز، والصق كود الربط ده. الأجهزة على نفس الراوتر (كابل أو واي فاي) بتلاقي بعض لوحدها، ولو مفيش نت بتفضل تتزامن مع بعض.
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={revealCode} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-800 hover:bg-slate-50">
            {showCode ? <EyeOff size={16} /> : <Eye size={16} />} {showCode ? 'إخفاء كود الربط' : 'إظهار كود الربط'}
          </button>
          {showCode && pairingCode && (
            <>
              <code className="max-w-full break-all rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-800" dir="ltr">{pairingCode}</code>
              <button type="button" onClick={copyCode} className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-800 hover:bg-slate-50">
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'اتنسخ' : 'نسخ'}
              </button>
            </>
          )}
        </div>
        <p className="mb-4 text-xs font-bold text-rose-700">الكود ده سري: أي جهاز معاه يقدر يشوف بيانات المحل كلها.</p>

        <label htmlFor="join-code" className="mb-1 block text-xs font-bold text-slate-700">ربط الجهاز ده بمحل موجود</label>
        <div className="mb-2 flex flex-wrap gap-2">
          <input id="join-code" dir="ltr" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="NEXA1-..." className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm outline-none focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-600/30" />
          <button type="button" onClick={join} disabled={joining || !joinCode.trim()} className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">ربط</button>
        </div>
        {hasOwnData && (
          <fieldset className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <legend className="px-1 text-xs font-black text-amber-800">الجهاز ده عليه بيانات: هتعمل فيها إيه؟</legend>
            {status?.leftStore && (
              <label className="mb-2 flex items-start gap-2 text-xs font-bold text-slate-800">
                <input type="radio" name="join-mode" value="merge" checked={joinMode === 'merge'} onChange={() => setJoinMode('merge')} className="mt-0.5" />
                <span>ادمج بياناته مع المحل (للجهاز اللي اتفصل من نفس المحل ده: اللي اتعمل عليه وهو مفصول يتجمع مع المحل)</span>
              </label>
            )}
            <label className="mb-2 flex items-start gap-2 text-xs font-bold text-slate-800">
              <input type="radio" name="join-mode" value="replace" checked={effectiveJoinMode === 'replace'} onChange={() => setJoinMode('replace')} className="mt-0.5" />
              <span>امسح بيانات الجهاز ده وخد بيانات المحل (بيتعمل نسخة احتياطية تلقائية الأول)</span>
            </label>
            {effectiveJoinMode === 'replace' && (
              <>
                <label htmlFor="replace-password" className="mb-1 block text-xs font-bold text-slate-700">كلمة مرور المدير</label>
                <input id="replace-password" type="password" autoComplete="current-password" value={replacePassword} onChange={(e) => setReplacePassword(e.target.value)} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-600/30" />
              </>
            )}
            <p className="mt-2 text-xs text-slate-500">ولو مش عايز تربطه، سيبه زي ما هو: هيفضل محل لوحده.</p>
          </fieldset>
        )}

        <label htmlFor="peers" className="mb-1 mt-4 block text-xs font-bold text-slate-700">عناوين الأجهزة يدويًا (لو الراوتر بيمنع اكتشاف الأجهزة)</label>
        <div className="flex flex-wrap gap-2">
          <input id="peers" dir="ltr" value={peers} onChange={(e) => setPeers(e.target.value)} placeholder="192.168.1.20, 192.168.1.21" className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm outline-none focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-600/30" />
          <button type="button" onClick={savePeers} disabled={savingPeers} className="h-10 rounded-xl border disabled:opacity-50 border-slate-300 px-4 text-sm font-bold text-slate-800 hover:bg-slate-50">حفظ</button>
        </div>
        {joinMessage && <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm font-bold ${joinMessage.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>{joinMessage.text}</p>}

        <div className="mt-5 border-t border-slate-200 pt-4">
          <h4 className="mb-1 text-sm font-black text-slate-900">فصل الجهاز ده عن المحل</h4>
          <p className="mb-2 text-xs leading-6 text-slate-600">الجهاز يبقى محل لوحده بكل بياناته، والأجهزة التانية مابتتأثرش ومابيتمسحش منها حاجة. تقدر ترجّعه بعدين بكود ربط نفس المحل وتختار «ادمج».</p>
          {!leaveConfirm ? (
            <button type="button" onClick={() => setLeaveConfirm({})} disabled={leaving} className="h-10 rounded-xl border border-rose-300 px-4 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">فصل الجهاز عن المحل</button>
          ) : (
            <div role="alertdialog" aria-labelledby="leave-title" className="rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p id="leave-title" className="mb-2 text-xs font-bold text-rose-800">{leaveConfirm.unsent || 'متأكد إنك عايز تفصل الجهاز ده عن المحل؟'}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => leave(Boolean(leaveConfirm.unsent))} disabled={leaving} className="h-9 rounded-lg bg-rose-700 px-3 text-xs font-black text-white hover:bg-rose-800 disabled:opacity-50">{leaveConfirm.unsent ? 'افصله برضه' : 'أيوه، افصله'}</button>
                <button type="button" onClick={() => setLeaveConfirm(null)} disabled={leaving} className="h-9 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-white">إلغاء</button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
