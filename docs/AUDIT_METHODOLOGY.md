# NEXA POS — طريقة الفحص والتصليح (دليل لأي موديل يكمل الشغل)

> الملف ده بيشرح **بالظبط** إزاي بيتفحص المشروع ويتصلح صفحة صفحة، عشان أي موديل أو مهندس يكمل بنفس المستوى.
> اقرا معاه: `docs/PROJECT_INVENTORY.md` (الجرد، وطلبات حسام R1–R15، وسجل التنفيذ) و`docs/plans/MULTI_DEVICE_SYNC_PLAN.md` (تصميم المزامنة).

---

## 0) قوانين ثابتة (ماينفعش تتكسر)

1. **الكلام مع حسام بالعربي المصري دايمًا**، حتى رسايل التقدم القصيرة. الكود وأسماء الملفات تفضل زي ما هي.
2. **ممنوع `git push` أو PR نهائيًا**، وممنوع commit إلا لو طلب.
3. **ممنوع لمس قاعدة بيانات المحل الحقيقية** `%APPDATA%\NEXA\mgpos.db`. كل الاختبارات على **نسخة** في مجلد مؤقت. والاستثناء الوحيد: لو حسام طلب صراحة تعديل بياناته، وقتها:
   - خد نسخة كاملة الأول في `%APPDATA%\NEXA\backups\`.
   - احفظ كل صف هيتمسح في جدول `data_repairs`.
   - اعمل كل حاجة في transaction واحدة، وألغيها كلها لو أي حاجة طلعت غير متوقعة.
4. **ماتشغّلش البرنامج نفسه (Electron) على جهاز حسام**، لأنه هيفتح القاعدة الحقيقية ويرقّيها. الاختبار بيتم بالطرق اللي في القسم 3.
5. **وضع الفحص ("افحص"):** صلّح الموجود بس، ومفيش مميزات جديدة من عندك. لو فيه حاجة ناقصة خالص، سجّلها واسأل. ولو فيه قرار يخص المنتج (زي شيل ميزة)، **اسأل الأول**.
6. **ماتوقفش بين الصفحات** (قرار حسام 2026-11-01): كمّل الفحص كله بالترتيب، وخد القرارات بمنطق مهندس أول، واكتب التقرير في الآخر بس. اللي يتكرر في أكتر من صفحة صلّحه في المصدر مرة واحدة (زي `preload.js` لرسايل الخطأ).

---

## 1) خطوات فحص صفحة (بالترتيب)

### الخطوة 1: القراءة الكاملة
- اقرا ملف الصفحة **كله** (ماتكتفيش بأجزاء)، وكل النوافذ (modals) والمكونات اللي بتفتحها.
- طلّع **كل عملية بتكلّم البرنامج الخلفي** `window.mgpos.X.Y(...)`، وتتبّع كل واحدة لآخرها:
  `src/...jsx` ← `electron/preload.js` (اسم القناة) ← `electron/ipc/register*Handlers.js` ← `src/db/repositories/*.repo.js` أو `src/domain/services/*` ← SQL.
- أمر مفيد يطلّع التبويبات والنوافذ والـ IPC لأي صفحة:
  ```bash
  node -e "
  const s=require('fs').readFileSync(process.argv[1],'utf8');
  console.log('IPC:', [...new Set([...s.matchAll(/window\.mgpos\??\.(\w+)\??\.(\w+)/g)].map(m=>m[1]+'.'+m[2]))].join(', '));
  console.log('UI :', [...new Set([...s.matchAll(/<([A-Z]\w*(?:Modal|View|Tab|Panel|Drawer))\b/g)].map(m=>m[1]))].join(', '));
  " src/pages/<PAGE>.jsx
  ```

### الخطوة 2: قائمة الفحص (لكل زرار وخانة وعملية)
| المحور | السؤال |
|---|---|
| **الأمان** | هل الصلاحية بتتفحص في **البرنامج الخلفي** (`requireCurrentAction` / `requireActionForActor`)، ولا في الواجهة بس؟ هل فيه سر (باسورد، PIN، مفتاح) بيوصل للواجهة أو مكتوب في الكود؟ هل فيه حاجة يقدر الكاشير يعملها من DevTools؟ |
| **الصدق** | هل الزرار بيعمل اللي بيقوله؟ (مثال حقيقي اتلقى: "تم تسجيل طلبك" ومفيش حاجة بتتبعت) |
| **الضغط المزدوج** | Enter أو الضغط مرتين بسرعة بيعمل العملية مرتين؟ لازم `if (loading) return` + `disabled`. |
| **الأخطاء** | كل `catch` بيظهر رسالة مفهومة؟ رسايل Electron بتيجي بالشكل ده: `Error invoking remote method 'x': Error: ...`، فاتشيل البادئة: `.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')` |
| **القيم الحدية** | فاضي، مسافات، حروف عربية، أرقام عربية (٤٥٦٧)، أرقام سالبة، نص طويل جدًا. |
| **المزامنة** | العملية دي بتغيّر بيانات؟ يبقى لازم توصل لباقي الأجهزة. كل تغيير في جداول `SNAPSHOT_TABLES` أو في الكميات والأرصدة بيتسجل تلقائي بالـ triggers. اتأكد إنها مش بتكتب **رقم مطلق** للمخزون (لازم فروقات). |
| **البيانات القديمة** | الكود بيقرا صفوف قديمة ناقص فيها أعمدة جديدة من غير ما يقع؟ |
| **الكود الميت** | فيه state أو handler أو عمود بقى مالوش استخدام بعد التصليح؟ امسحه. |
| **القراءة الآلية** | `<label htmlFor>` مربوط بـ `id` الخانة؟ الأزرار اللي فيها أيقونة بس ليها `aria-label`؟ |

### الخطوة 3: التصليح
- صلّح في **الطبقة الصح**: أي فحص أمان أو صلاحية أو سر يتعمل في البرنامج الخلفي، والواجهة بتعرض النتيجة بس.
- مكان العمليات:
  - الدوال الجديدة على قاعدة البيانات في `src/db/repositories/*.repo.js`.
  - قنواتها في `electron/ipc/registerDbHandlers.js` (هناك موجودة `requireCurrentAction`).
  - وتتعرض للواجهة في `electron/preload.js`.
- **لما تشيل ميزة:** دوّر على كل مراجعها في الواجهة، و`preload`، و`ipc/index.js`، وملف الـ handler، وبعدين افحص إن مفيش `require` لملف مش موجود (الأمر في القسم 4).

### الخطوة 4: الاختبار (إجباري، والتفاصيل في القسم 3)
1. **اختبار البرنامج الخلفي** على قاعدة حقيقية (نسخة)، مع **محاولة كسر** كل حاجة.
2. **اختبار الواجهة** في المتصفح بصفحة اختبار مؤقتة.
3. **اختبار الرجوع:** الاختبار الكامل للمزامنة لازم يفضل 43 من 43.
4. `vite build` لازم ينجح.
5. **امسح أي ملف مؤقت** اتعمل جوه المشروع.

### الخطوة 5: التقرير لحسام (بالعربي)
- اللي اتصلح، ومقسّم لثغرات أمنية 🔴 وعيوب 🟡.
- **الأرقام الحقيقية** للاختبار (مثلًا "33 من 33")، ولو حاجة فشلت تتقال بصراحة.
- أي قرار محتاجه منه.
- **حدّث `docs/plans/OPEN_ITEMS.md`**: كل حاجة ما اتجربتش أو اتأجلت أو محتاجة قرار تتسجل هناك، واللي اتقفل يتعلّم ✅.
- وبعدين **وقّف**.

---

## 2) أماكن الحاجات المهمة

| الحاجة | المكان |
|---|---|
| القائمة الجانبية والصلاحيات | `src/App.jsx` (`cashierNavItems`)، `src/permissions/definitions.json`، `permissions/frontend.js` (`canDo` / `canViewPage`) |
| صلاحيات البرنامج الخلفي | `registerDbHandlers.js`: `requireCurrentAction(key)` (المستخدم الحالي) و`requireActionForActor(key, actorId)` |
| المستخدمين والدخول | `src/db/repositories/users.repo.js`: `login`، `setupAccount`، `verifyOverride`، `issueRecoveryGrant` |
| البيع | `src/domain/services/sales.service.js` + `invoices.repo.js` |
| ترقيم الفواتير | trigger اسمه `trg_invoices_device_numbering` في `src/db/schema/multiDevice.js` |
| دفتر الفروقات (المخزون والأرصدة) | `src/db/schema/deltaLedger.js` |
| تزامن الجداول | `src/db/schema/entitySnapshots.js` (`SNAPSHOT_TABLES`) |
| الدمج بين الأجهزة | `src/db/sync/mergeEngine.js`، `src/db/sync/storeMesh.js` |
| المزامنة على الشبكة والسيرفر | `electron/services/sync/peerSyncAgent.js`، `cloudMeshAgent.js` |
| سيرفر الشبكة المحلية (بمفتاح المحل) | `electron/services/local-api/localApiServerService.js` |
| الترخيص والاستعادة | `electron/services/license/*`، `electron/services/recovery/recoveryService.js`، `license-generator/`، `scripts/generate-recovery.js` |
| السيرفر والداشبورد | `server/src/*`، `server/dashboard/src/*` |

---

## 3) أدوات الاختبار (الكود الفعلي)

### 3.1 تشغيل الاختبارات بـ Node بتاع Electron
مكتبة `better-sqlite3` متبنية لـ Electron، فـ Node العادي مش هيشغّلها. كل الاختبارات بتشتغل كده:
```bash
cd "<project>"
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <test.js> "$PWD" <scratch-dir> "$APPDATA/NEXA/mgpos.db"
```
- `<scratch-dir>` = مجلد مؤقت **برّه المشروع**.
- المسار التالت بيتقرا بس، وبنعمل منه نسخة (`fs.copyFileSync`). **ماتفتحوش للكتابة أبدًا.**
- قبل النسخ امسح أي `-wal` و`-shm` قديمين جنب النسخة، وإلا SQLite هيطبّقهم على النسخة الجديدة ويبوّظها (حصلت قبل كده).

### 3.2 تشغيل طبقة قاعدة البيانات الحقيقية كلها على أي ملف (أهم أداة)
بيحمّل `src/db/index.js` بنفس طريقة البرنامج (`initDB` + كل الـ repositories)، لكن على ملف تختاره انت، عن طريق استبدال `connection.js`. وتقدر تشغّل أكتر من جهاز في نفس الاختبار.
```js
const path = require('path'), fs = require('fs'), assert = require('assert'), Module = require('module')
const [ROOT, SP, SRC] = process.argv.slice(2)
const D = require(path.join(ROOT, 'node_modules/better-sqlite3'))
const quiet = (f) => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return f() } finally { console.log = l; console.warn = w } }
const wipe = (f) => { for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(f + s) } catch {} }

function loadDevice(dbFile) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]
  const db = new D(dbFile); db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000')
  const connPath = require.resolve(path.join(ROOT, 'src/db/core/connection.js'))
  const m = new Module(connPath); m.filename = connPath; m.loaded = true
  m.exports = { db, dbPath: dbFile, performIntegrityCheck: () => ({ ok: true }), safeCheckpoint: () => null }
  require.cache[connPath] = m
  const errors = []; const ce = console.error; console.error = (...a) => errors.push(a.join(' '))
  const api = quiet(() => require(path.join(ROOT, 'src/db/index.js')))
  console.error = ce
  // خدمة البيع (بتتعمل في registerDbHandlers في البرنامج الحقيقي)
  const sales = require(path.join(ROOT, 'src/domain/services/sales.service')).createSalesService({
    invoicesDB: api.invoicesDB, batchesDB: api.batchesDB, auditDB: api.auditDB, loyaltyDB: null, returnsDB: api.returnsDB, outboxDB: api.outboxDB,
  })
  return { db, api, sales, errors, mesh: api.storeMesh, id: api.deviceIdentityDB.getIdentity() }
}

// مثال: نسخة من قاعدة المحل + جهاز جديد فاضي
const fA = path.join(SP, 't_A.db'); wipe(fA); fs.copyFileSync(SRC, fA)
const A = loadDevice(fA)
const B = loadDevice(path.join(SP, 't_B.db'))
```
**أدوات بتتكرر:**
```js
let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  PASS', msg) }
const throwsCode = (f, code) => { try { f() } catch (e) { return e.code === code || String(e.message).includes(code) } return false }
// بيع حقيقي من خلال الخدمة
const sell = (dev, productId, qty) => {
  const p = dev.db.prepare('SELECT name, sell_price FROM products WHERE id = ?').get(productId), t = p.sell_price * qty
  const user = dev.db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get().id
  return quiet(() => dev.sales.createInvoice({ user_id: user, total: t, subtotal: t, paid: t, payment_method: 'cash', cash_amount: t },
    [{ product_id: productId, name: p.name, quantity: qty, price: p.sell_price, total: t }]))
}
// مزامنة جهاز من جهاز تاني من غير شبكة (نفس اللي peerSyncAgent بيعمله)
function pull(to, from) {
  for (;;) {
    const page = from.mesh.pullLog({ since: to.mesh.getPeerCursor(from.id.deviceUuid), limit: 300 })
    to.mesh.ingestFromPeer({ peerUuid: from.id.deviceUuid, peerCode: from.id.deviceCode, events: page.events })
    if (page.events.length < 300) break
  }
  to.mesh.retryDeferred()
}
```
**في آخر كل اختبار:**
```js
ok(dev.db.pragma('integrity_check')[0].integrity_check === 'ok', 'integrity ok')
ok(dev.db.pragma('foreign_key_check').length === 0, 'no FK violations')
dev.db.close(); wipe(file)
console.log(`ALL ${n} CHECKS PASSED`)
```

### 3.3 اختبار IPC handler من غير Electron
```js
const handlers = {}
require(path.join(ROOT, 'electron/ipc/registerRecoveryHandlers')).registerRecoveryHandlers({
  ipcMain: { handle: (channel, fn) => (handlers[channel] = fn) },
  recoveryService, usersDB: A.api.usersDB, auditDB: A.api.auditDB, db: A.db,
})
const res = await handlers['recovery:reset-admin'](null, data)
```

### 3.4 اختبار الواجهة في المتصفح (صفحة اختبار مؤقتة)
1. اعمل `src/__<page>_harness.jsx`، يعرض الصفحة الحقيقية ومعاها `window.mgpos` وهمي بيسجّل كل طلب في `window.__calls`، وبيرجّع ردود محددة لكل سيناريو (نجاح، فشل، رسالة خطأ بشكل Electron الحقيقي). وبدّل `window.open` عشان تشوف الروابط اللي بتتفتح.
2. اعمل `__<page>_harness.html` في جذر المشروع بيحمّل الملف ده (زي `index.html` بالظبط بس بـ src مختلف).
3. `.claude/launch.json`:
   ```json
   { "version": "0.0.1", "configurations": [ { "name": "vite-harness", "runtimeExecutable": "npx", "runtimeArgs": ["vite", "--port", "5199", "--strictPort"], "port": 5199 } ] }
   ```
4. افتح `http://localhost:5199/__<page>_harness.html` في المتصفح المدمج.
5. **لو المتصفح مخفي والضغط بالماوس مش شغال** ("Could not get the tab ready")، شغّل الأحداث جوه الصفحة نفسها، وده بيشغّل نفس كود React بالظبط:
   ```js
   const type = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
   const enter = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
   const byText = (sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t))
   // رفع ملف
   const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(obj)], 'f.json')); input.files = dt.files
   input.dispatchEvent(new Event('change', { bubbles: true }))
   ```
6. **امسح** صفحة الاختبار وملف الـ harness و`.claude/launch.json` بعد ما تخلص، ووقّف السيرفر.

### 3.5 اختبار السيرفر من غير Postgres (pg-mem)
- نزّل `pg-mem@3` في **مجلد مؤقت** (مش في المشروع)، ومن غير ما تلمس `package.json`.
- استبدل `server/src/config/db.js` بـ module فيه `query` و`withTransaction` على pool من `pg-mem`. شيل `FOR UPDATE` من الـ SQL، لأن pg-mem مش بيدعمها.
- شغّل الـ migrations اللازمة، وركّب الـ routes الحقيقية على `express` من `server/node_modules`، واختبر بـ `fetch` حقيقي.
- **قيود pg-mem:** مش بيدعم الاستعلامات الفرعية المرتبطة (correlated subqueries) ولا `::interval`. اكتبهم بـ JOIN/GROUP BY أو احسبهم في JS، وده كمان أصح مع Postgres الحقيقي.

### 3.6 فحص إن مفيش `require` لملف مش موجود (بعد أي مسح)
```bash
node -e "
const fs=require('fs'),path=require('path');let miss=0;
const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name==='node_modules'?[]:walk(path.join(d,e.name))):e.name.endsWith('.js')?[path.join(d,e.name)]:[]);
for(const f of [...walk('electron'),...walk('src/db'),...walk('src/domain')]){const s=fs.readFileSync(f,'utf8');
for(const m of s.matchAll(/require\(['\"](\.[^'\"]+)['\"]\)/g)){const b=path.resolve(path.dirname(f),m[1]);
if(![b,b+'.js',b+'.json',path.join(b,'index.js')].some(p=>fs.existsSync(p))){miss++;console.log('MISSING',f,m[1])}}}
console.log('missing:',miss)"
```

### 3.7 البناء وفحص الصياغة
```bash
node --check <file.js>                                                     # ملفات البرنامج الخلفي والسيرفر
npx --yes esbuild <file.jsx> --loader:.jsx=jsx --loader:.js=jsx --log-level=error > /dev/null   # ملفات React
npx vite build --outDir "<scratch>/vite-out" --emptyOutDir                 # البرنامج كله (برّه dist)
cd server/dashboard && npx vite build --outDir "<scratch>/dash-out" --emptyOutDir
```

---

## 4) أخطاء وقعت فيها (ماتكررهاش)

| الخطأ | اللي حصل | الصح |
|---|---|---|
| **سلسلة أوامر بـ `&&` و`;`** | الأمر الأول فشل، و`rm` اللي بعد `;` اتنفذ برضه، فاتمسح ملف والبرنامج كان مش هيقوم | ماتحطش أمر مسح بعد `;` في سلسلة تعديل. امسح في أمر لوحده **بعد** ما تتأكد إن التعديل نجح |
| **`node -e` جوه علامتين `"`** | الـ backslash في الـ regex بيضيع (`/[^\s@]/` بقت `/[^s@]/` فرفضت أي إيميل فيه حرف s)، والـ backticks بتتنفذ كأوامر | التعديلات اللي فيها regex أو backticks اعملها بأداة Edit، وبعدين **اقرا السطر** وتأكد منه |
| **قص بين نصين بـ `indexOf`** | النص التاني كان متكرر **جوه** الجزء اللي بقصه، فالملف اتكسر | اتأكد إن العلامة فريدة، أو استخدم Edit بالنص الكامل |
| **ملفات CRLF** | البحث فشل (`App.jsx` و`AdminOverrideModal.jsx` و`CashierPage.jsx` بنهايات Windows) | حوّل لـ `\n`، وعدّل، ورجّعها `\r\n` تاني |
| **WAL قديم جنب النسخة** | النسخة الجديدة اتبوّظت | امسح `-wal` و`-shm` قبل النسخ |
| **قراءة وكتابة على نفس اتصال SQLite** | `.iterate()` وفي نفس الوقت `INSERT` ← "connection is busy" | اقرا على دفعات بـ `.all()` (`WHERE id > ? LIMIT 1000`) |
| **مقارنة بارامترات Postgres من غير نوع** | `$2 >= $3` اتقارنت كنص (`'10' < '5'`) | احسب في JS أو استخدم `::int` |
| **مقارنة طول String قبل `timingSafeEqual`** | الأرقام العربية بأكتر من byte، فبيرمي خطأ | قارن طول الـ Buffer |
| **وقت بالثانية** | مقدرناش نعرف مين باع الأول | `strftime('%Y-%m-%d %H:%M:%f','now')` |

---

## 5) قالب التقرير اللي بيتبعت لحسام

```
خلّصت <الصفحة>، واختبرتها، وصلّحت كل اللي لقيته فيها. ومعملتش commit.

## الاختبار
- البرنامج الخلفي: X من X.
- الواجهة في المتصفح: X سيناريو.
- الاختبار الكامل للمزامنة: 43 من 43.
- بناء الواجهة: نجح.

## اللي اتصلح
🔴 ثغرات أمنية: ...
🟡 عيوب: ...

## ❓ محتاج قرارك
...
```

---

## 6) الحالة دلوقتي (2026-10-31)
- **الصفحة 1 (شاشة الدخول):** ✅ خلصت. التفاصيل في `PROJECT_INVENTORY.md` §9.
- **الجاي:** قرارات حسام (أ) طلب التفعيل للداشبورد + واتساب، و(ب) التفعيل من الداشبورد بزرار + الحفظ الموقّع على الجهاز، و(ج) الدخول بأي حساب من أي جهاز. وبعدها **الصفحة 2: الكاشير** (`CashierPage.jsx`، 7,111 سطر).
- **اختبارات لازم تفضل ناجحة بعد أي تعديل:** الاختبار الكامل لتعدد الأجهزة (3 أجهزة، ومثال 50/50/50/+100 ← 50 على الكل، وتقرير العجز متطابق، والاسترجاع من نسخة احتياطية، والحسابات، والشبكة بالمفتاح)، واختبار السيرفر، واختبار الدخول. ملفاتهم كانت مؤقتة واتمسحت مع الجلسة، فلو احتجتها اعملها تاني بالأدوات اللي في القسم 3 والسيناريوهات اللي في سجل التنفيذ.
