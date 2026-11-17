import logoImg from '../assets/logo'

const HERO_TITLE = 'Your Need Our Next Feature'
const HERO_SUBTITLE = 'A smarter, faster, and more professional POS experience.'
const LEFT_DESC = 'Designed for daily operations — intuitive, reliable, and built to scale.'
const LOADER_ITEMS = [
  'تهيئة بيئة التشغيل الأساسية',
  'تحميل إعدادات المستخدم والصلاحيات',
  'إعداد الواجهة والانتقال الآمن للنظام',
]
const LOADER_FOOTER = 'جاري تهيئة النظام...'

export default function SplashScreen() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#ecf6f0]" dir="rtl">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#eef8f2_0%,#ffffff_44%,#e5f2eb_100%)]" />
      <div className="absolute inset-x-0 top-0 h-1.5 bg-[#00855c]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(#0f7649_1px,transparent_1px),linear-gradient(90deg,#0f7649_1px,transparent_1px)] [background-size:44px_44px]" />

      <section className="splash-logo-phase absolute inset-0 z-20 flex items-center justify-center px-6">
        <div className="relative flex flex-col items-center text-center">
          <div className="splash-logo-ring absolute h-56 w-56 rounded-[3rem] border border-[#0f7649]/15" />
          <div className="splash-logo-card relative flex h-40 w-40 items-center justify-center rounded-[2.8rem] border border-emerald-100 bg-white shadow-[0_32px_90px_-45px_rgba(7,89,57,0.65)]">
            <img src={logoImg} alt="NEXA POS" className="h-24 w-24 object-contain drop-shadow-[0_18px_30px_rgba(15,118,73,0.22)]" />
          </div>
          <h1 className="splash-brand mt-9 text-[72px] font-black tracking-tight text-[#0b6d49]">NEXA</h1>
          <div className="splash-brand-line mt-4 h-1.5 w-36 overflow-hidden rounded-full bg-emerald-100">
            <div className="h-full rounded-full bg-[#00855c]" />
          </div>
          <p className="splash-brand-sub mt-6 text-sm font-black tracking-[0.35em] text-[#587466]">Your Need Our Next Feature</p>
        </div>
      </section>

      <section className="splash-content-phase absolute inset-0 z-10 min-h-screen lg:grid lg:grid-cols-[1.15fr_0.85fr]">
        <div className="relative hidden flex-col items-center justify-center overflow-hidden px-16 py-14 text-center lg:flex">
          <div className="absolute inset-y-20 right-14 w-px bg-emerald-900/10" />
          <div className="absolute inset-x-20 bottom-16 h-px bg-emerald-900/10" />

          <div className="relative z-10 w-full max-w-2xl">
            <div className="mx-auto mb-7 flex h-28 w-28 items-center justify-center rounded-[2rem] border border-emerald-100 bg-white shadow-[0_24px_60px_-32px_rgba(15,118,73,0.38)]">
              <img src={logoImg} alt="NEXA POS" className="h-16 w-16 object-contain" />
            </div>

            <h1 className="text-[64px] font-black tracking-tight text-[#0f7649]">NEXA POS</h1>
            <p className="mx-auto mt-6 max-w-xl text-[26px] font-black leading-[1.85] text-[#0a2416]">
              {HERO_TITLE}
              <span className="mt-2 block text-[#5f7698]">{HERO_SUBTITLE}</span>
            </p>
          </div>
        </div>

        <div className="relative flex items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#0d8156_0%,#075f40_48%,#0f2849_100%)] px-4 py-8 sm:px-8 lg:px-10">
          <div className="absolute inset-y-0 left-0 hidden w-px bg-white/10 lg:block" />
          <div className="absolute inset-x-8 top-8 h-px bg-white/10" />
          <div className="absolute inset-x-8 bottom-8 h-px bg-white/10" />

          <div className="relative z-10 w-full max-w-[500px]">
            <div className="rounded-[2.4rem] border border-white/15 bg-white/10 p-3 shadow-[0_35px_90px_-45px_rgba(8,20,50,0.75)] backdrop-blur-xl">
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.08] px-6 py-9 sm:px-8 sm:py-10">
                <div className="mb-8 text-center text-white">
                  <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[1.8rem] bg-white shadow-[0_18px_40px_-24px_rgba(15,23,42,0.4)]">
                    <img src={logoImg} alt="NEXA POS" className="h-11 w-11 object-contain" />
                  </div>
                  <h1 className="text-[42px] font-black leading-tight">NEXA POS</h1>
                  <p className="mt-3 text-[15px] font-bold leading-relaxed text-emerald-100/90">{LEFT_DESC}</p>
                </div>

                <div className="mt-10 space-y-4">
                  {LOADER_ITEMS.map((item, index) => (
                    <div
                      key={item}
                      className="splash-loader-item flex items-center gap-3 rounded-[1.2rem] border border-white/10 bg-white/[0.07] px-4 py-3.5"
                      style={{ animationDelay: `${4.25 + index * 0.18}s` }}
                    >
                      <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
                      <p className="text-sm font-bold text-white/95">{item}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-12">
                  <div className="mx-auto h-2 w-full overflow-hidden rounded-full bg-white/10 shadow-inner">
                    <div className="splash-progress h-full rounded-full bg-[linear-gradient(90deg,#63f2b9_0%,#ffffff_55%,#4ab0ff_100%)] shadow-[0_0_16px_rgba(99,242,185,0.55)]" />
                  </div>
                  <p className="mt-4 text-center text-[11px] font-black tracking-[0.2em] text-emerald-200/70">{LOADER_FOOTER}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <style>{`
        .splash-logo-phase {
          animation: splashLogoPhase 4s ease-in-out forwards;
        }

        .splash-content-phase {
          opacity: 0;
          transform: translateY(18px) scale(0.985);
          animation: splashContentPhase 4s ease-out 4s forwards;
        }

        .splash-logo-card {
          animation: logoFloat 3.2s ease-in-out infinite, logoIntro 1.05s cubic-bezier(.2,.9,.2,1) both;
        }

        .splash-logo-ring {
          animation: ringPulse 2.2s ease-in-out infinite;
        }

        .splash-brand {
          animation: textRise 0.9s ease-out 0.35s both;
        }

        .splash-brand-sub {
          animation: textRise 0.9s ease-out 0.62s both;
        }

        .splash-brand-line > div {
          animation: lineFill 1.25s ease-out 0.72s both;
        }

        .splash-loader-item {
          opacity: 0;
          transform: translateY(12px);
          animation: loaderItemIn 0.55s ease-out forwards;
        }

        .splash-progress {
          width: 0;
          animation: progressFill 3.25s ease-in-out 4.45s forwards;
        }

        @keyframes splashLogoPhase {
          0% { opacity: 0; }
          10% { opacity: 1; }
          78% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.025); pointer-events: none; }
        }

        @keyframes splashContentPhase {
          0% { opacity: 0; transform: translateY(18px) scale(0.985); }
          18% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes logoIntro {
          from { opacity: 0; transform: translateY(18px) scale(0.82); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes logoFloat {
          0%, 100% { translate: 0 0; }
          50% { translate: 0 -10px; }
        }

        @keyframes ringPulse {
          0%, 100% { opacity: 0.55; transform: scale(0.9) rotate(0deg); }
          50% { opacity: 1; transform: scale(1.08) rotate(8deg); }
        }

        @keyframes textRise {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes lineFill {
          from { width: 0; }
          to { width: 100%; }
        }

        @keyframes loaderItemIn {
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes progressFill {
          from { width: 0; }
          to { width: 100%; }
        }
      `}</style>
    </div>
  )
}
