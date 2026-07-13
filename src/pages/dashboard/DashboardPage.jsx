import { useState, useEffect } from 'react'
import { TrendingUp, ShoppingBag, Wallet, AlertTriangle, CreditCard, Banknote, Clock, RefreshCw, ArrowDownCircle, DollarSign } from 'lucide-react'

export default function DashboardPage({ user, settings = {} }) {
  const currency = settings?.currency || 'ج.م'
  const [daily, setDaily] = useState(null)
  const [monthly, setMonthly] = useState(null)
  const [weekly, setWeekly] = useState([])
  const [topProducts, setTopProducts] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [dailyExpenses, setDailyExpenses] = useState(0)
  const [monthlyExpenses, setMonthlyExpenses] = useState(0)
  const [dailyProfit, setDailyProfit] = useState(0)
  const [loading, setLoading] = useState(true)
  const [isFirstLoad, setIsFirstLoad] = useState(true)

  useEffect(() => { 
    if (user?.role !== 'admin') return
    loadAll(true) 
    
    // Auto refresh every 30 seconds (increased from 10 to reduce load)
    const interval = setInterval(() => loadAll(false), 30000)
    
    // Listen for manual triggers from other pages
    const handleRefresh = () => loadAll(false)
    window.addEventListener('dashboard:refresh', handleRefresh)
    
    return () => {
      clearInterval(interval)
      window.removeEventListener('dashboard:refresh', handleRefresh)
    }
  }, [])

  async function loadAll(showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const monthStart = today.slice(0, 7) + '-01'

      const [d, m, w, tp, ls, todayExp, monthExp] = await Promise.all([
        window.mgpos.db.getDailySummary().catch(() => null),
        window.mgpos.db.getMonthSummary().catch(() => null),
        window.mgpos.db.getWeeklySales().catch(() => []),
        window.mgpos.db.getTopProducts().catch(() => []),
        window.mgpos.db.getLowStock().catch(() => []),
        window.mgpos.db.getExpenses(today, today).catch(() => []),
        window.mgpos.db.getExpenses(monthStart, today).catch(() => []),
      ])
      
      setDaily(d)
      setMonthly(m)
      setWeekly(Array.isArray(w) ? w : [])
      setTopProducts(Array.isArray(tp) ? tp : [])
      setLowStock(Array.isArray(ls) ? ls : [])

      const todayExpTotal = (todayExp || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
      setDailyExpenses(todayExpTotal)

      const monthExpTotal = (monthExp || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
      setMonthlyExpenses(monthExpTotal)

      const totalSales = d?.total_sales || 0
      const totalDiscount = d?.total_discount || 0
      const monthSales = m?.total_sales || 0
      const monthProfit = m?.profit || 0
      const profitRatio = monthSales > 0 ? monthProfit / monthSales : 0
      const estimatedDailyProfit = (totalSales - totalDiscount) * profitRatio - todayExpTotal
      setDailyProfit(estimatedDailyProfit)
    } catch (e) {
      console.error('Dashboard loadAll failed:', e)
    } finally {
      if (showLoading) setLoading(false)
      setIsFirstLoad(false)
    }
  }

  if (user?.role !== 'admin') {
    return <div className="p-6 text-red-500 font-bold text-center mt-10 text-xl">غير مسموح لك بدخول هذه الصفحة</div>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <div className="text-center">
          <RefreshCw size={32} className="animate-spin mx-auto mb-2" />
          <p>جاري التحميل...</p>
        </div>
      </div>
    )
  }

  const maxVal = Math.max(...weekly.map(d => d.total), 1)

  const dayNames = { 'Sun':'أحد', 'Mon':'إثن', 'Tue':'ثلا', 'Wed':'أرب', 'Thu':'خمي', 'Fri':'جمع', 'Sat':'سبت' }
  const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
  function getDayName(dateStr) {
    const d = parseDate(dateStr)
    return dayNames[d.toLocaleDateString('en-US', { weekday: 'short' })] || dateStr.slice(5)
  }

  return (
    <div className="p-6 h-full overflow-auto bg-slate-50" dir="rtl">

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">الرئيسية (لوحة التحكم)</h1>
        <button
          onClick={loadAll}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-emerald-800 hover:bg-white bg-transparent px-3 py-1.5 rounded-lg border border-transparent hover:border-slate-200 transition shadow-sm"
        >
          <RefreshCw size={16} />
          تحديث البيانات
        </button>
      </div>

      <p className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">مبيعات اليوم</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <KPICard
          label="إجمالي المبيعات"
          value={`${(daily?.total_sales || 0).toFixed(2)} ${currency}`}
          icon={TrendingUp}
          color="blue"
        />
        <KPICard
          label="عدد الفواتير"
          value={daily?.invoices_count || 0}
          icon={ShoppingBag}
          color="teal"
        />
        <KPICard
          label="مبيعات كاش"
          value={`${(daily?.cash || 0).toFixed(2)} ${currency}`}
          icon={Banknote}
          color="green"
        />
        <KPICard
          label="مبيعات بالآجل (ديون)"
          value={`${(daily?.credit || 0).toFixed(2)} ${currency}`}
          icon={Clock}
          color="red"
        />
        <KPICard
          label="صافي الربح (اليوم)"
          value={`${dailyProfit.toFixed(2)} ${currency}`}
          icon={DollarSign}
          color={dailyProfit >= 0 ? 'emerald' : 'red'}
        />
        <KPICard
          label="مصروفات اليوم"
          value={`${dailyExpenses.toFixed(2)} ${currency}`}
          icon={ArrowDownCircle}
          color="orange"
        />
      </div>

      <p className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">ملخص الشهر الحالي</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <KPICard
          label="إجمالي المبيعات (الشهر)"
          value={`${(monthly?.total_sales || 0).toFixed(2)} ${currency}`}
          icon={TrendingUp}
          color="blue"
        />
        <KPICard
          label="صافي الربح (الشهر)"
          value={`${((monthly?.profit || 0) - monthlyExpenses).toFixed(2)} ${currency}`}
          icon={DollarSign}
          color={((monthly?.profit || 0) - monthlyExpenses) >= 0 ? 'emerald' : 'red'}
        />
        <KPICard
          label="ربح قبل المصروفات"
          value={`${(monthly?.profit || 0).toFixed(2)} ${currency}`}
          icon={Wallet}
          color="green"
        />
        <KPICard
          label="إجمالي المصروفات (الشهر)"
          value={`${monthlyExpenses.toFixed(2)} ${currency}`}
          icon={ArrowDownCircle}
          color="orange"
        />
        <KPICard
          label="عدد الفواتير (الشهر)"
          value={monthly?.invoices_count || 0}
          icon={ShoppingBag}
          color="teal"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        <div className="lg:col-span-2 bg-white rounded-2xl shadow-[0_2px_10px_rgb(0,0,0,0.06)] p-6 border border-slate-100">
          <h2 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <TrendingUp size={18} className="text-emerald-600" />
            أداء المبيعات (آخر 7 أيام)
          </h2>
          {weekly.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              لا توجد بيانات كافية لعرض الرسم البياني
            </div>
          ) : (
            <div className="flex items-end gap-3 h-48 mt-4">
              {weekly.map((day, i) => {
                const heightPct = (day.total / maxVal) * 100
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2 group relative">
                    <div className="absolute -top-8 bg-slate-800 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10 pointer-events-none">
                      {Math.round(day.total)} {currency}
                    </div>
                    <span className="text-xs font-bold text-emerald-900">{day.total > 0 ? Math.round(day.total) : ''}</span>
                    <div className="w-full flex items-end justify-center h-full relative" style={{ height: '100px' }}>
                      <div
                        className="w-full max-w-[40px] bg-emerald-600/90 hover:bg-emerald-700 rounded-t-lg transition-all duration-500 shadow-sm"
                        style={{ height: `${Math.max(heightPct, 4)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-slate-500">{getDayName(day.date)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-[0_2px_10px_rgb(0,0,0,0.06)] p-6 border border-slate-100">
          <div className="flex items-center gap-2 mb-6 text-red-600">
            <AlertTriangle size={18} />
            <h2 className="font-bold">تنبيهات نواقص المخزون</h2>
          </div>
          {lowStock.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              المخزون بوضع ممتاز 📦ئ
            </div>
          ) : (
            <div className="space-y-4">
              {lowStock.map((p, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-orange-50 border border-orange-100 hover:bg-orange-100 transition">
                  <span className="text-sm font-bold text-slate-700 truncate flex-1">{p.name}</span>
                  <div className="flex flex-col items-center mr-3">
                    <span className={`text-lg font-black leading-none ${p.quantity <= 0 ? 'text-red-600' : 'text-orange-500'}`}>
                      {Math.round(p.quantity)}
                    </span>
                    <span className="text-[10px] text-slate-500">حالي</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="lg:col-span-3 bg-white rounded-2xl shadow-[0_2px_10px_rgb(0,0,0,0.06)] p-6 border border-slate-100">
          <h2 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <ShoppingBag size={18} className="text-teal-600" />
            أكثر المنتجات مبيعاً (آخر 30 يوم)
          </h2>
          {topProducts.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              لا توجد مبيعات كافية بعد
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
              {topProducts.map((p, i) => {
                const maxSales = topProducts[0].total_sales
                const pct = (p.total_sales / maxSales) * 100
                return (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition border border-transparent hover:border-slate-100">
                    <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-end mb-1">
                        <span className="text-sm font-bold text-slate-700 truncate pr-1">{p.name}</span>
                        <div className="flex gap-3 text-xs items-center">
                          <span className="font-bold text-emerald-700">{p.total_sales.toFixed(2)} {currency}</span>
                          <span className="text-slate-400">({Math.round(p.total_qty)} ق)</span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-emerald-600 h-full rounded-full transition-all duration-1000 ease-out"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KPICard({ label, value, icon: Icon, color }) {
  const styles = {
    blue: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100' },
    teal: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-100' },
    green: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-100' },
    red: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-100' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100' },
    orange: { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-100' },
    purple: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100' },
  }
  const s = styles[color] || styles.blue
  
  return (
    <div className={`bg-white rounded-2xl shadow-[0_2px_8px_rgb(0,0,0,0.04)] p-5 border border-slate-100 flex items-start gap-4 transition hover:-translate-y-1 hover:shadow-md cursor-default`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${s.bg} ${s.text} ${s.border}`}>
        <Icon size={24} strokeWidth={2} />
      </div>
      <div>
        <div className="text-2xl font-black text-slate-800 tracking-tight">{value}</div>
        <div className="text-sm font-medium text-slate-500 mt-0.5">{label}</div>
      </div>
    </div>
  )
}
