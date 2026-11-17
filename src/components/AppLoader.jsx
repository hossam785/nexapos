import logoImg from '../assets/logo'

const DEFAULT_TEXT = '\u062c\u0627\u0631\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0646\u0638\u0627\u0645...'

export default function AppLoader({ text = DEFAULT_TEXT }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans" dir="rtl">
      <div className="text-center">
        <div className="mx-auto mb-6 w-24 h-24 flex items-center justify-center animate-[popIn_.4s_ease-out]">
          <img src={logoImg} alt="NEXA POS" className="w-full h-full object-contain drop-shadow-md" />
        </div>

        <div className="flex justify-center mb-5">
          <div className="w-12 h-12 rounded-full border-[3px] border-emerald-100 border-t-emerald-600 animate-spin flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-emerald-600 rounded-full mb-8"></div>
          </div>
        </div>

        <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">NEXA POS</h2>
        <p className="text-sm font-bold text-slate-400 mt-2 tracking-wide">{text}</p>
      </div>
    </div>
  )
}
