# الجولة 13: جرد الصفحات والأدلة

**الحالة: اكتمل قبول نطاق الصفحات الثلاث عشرة ضمن حدود التحقق أدناه.** أُعيدت الفحوص المجمعة بعد استقرار ملفات التنفيذ، بما فيها تصحيح locale في Audit. هذا قبول للنطاق المطلوب، وليس تصريحًا بجاهزية النشر أو إغلاقًا لبنود المشروع الأقدم.

## نتائج التحقق النهائي المستقل

- شغّل المشرف `node tests/run.js` مع `TEMP` و`TMP` معزولين وبدون `MGPOS_REAL_DB`: **42 مجموعة و2185 فحصًا ناجحًا، صفر فشل**؛ مجموعة real-store متخطاة قصدًا.
- نجحت إعادة تشغيل اختبارات المتصفح العشرة بالتتابع: auth وfleet وstores وcashiers وflags وlicenses وoverview وvitals وreleases وaudit. تستخدم مكونات فعلية وREST وهميًا، لا خدمات إنتاج.
- نجح فحص شاشة العميل المعزول، بما فيه تحويل JSX للكاشير، وترتيب الحالة الابتدائية والتحديثات، واللغة وfullscreenchange وإلغاء الاشتراك؛ دون تحميل التطبيق أو قاعدة بيانات.
- نجح بناء التطبيق في **14.43s**؛ ظهر تحذير chunks أكبر من 500kB وتحذير أداء plugins، دون فشل البناء. نجح بناء الداشبورد في **30.00s**.
- اختيار Audit المحدود اجتاز 101 فحصًا: 48 للمساعد و53 لـHTTP؛ هما محسوبان مرة واحدة ضمن إجمالي 2185، ولا تُضاف نتيجة الاختيار فوقه أو يُحتسب المساعد مرة ثانية.
- فحوص كل نطاق ومراجعة المصادر سبقت القبول. بعض سجلات النطاق التاريخية تغيرت بصمتها مع العمل المتوازي وإعادة توليد الصور؛ الفحوص المجمعة المذكورة هنا أُعيدت بعد انتهاء عمال التنفيذ.

## مصفوفة التحكم والتنفيذ والدليل

كل روابط الاختبارات تشير إلى ملفات الاختبار المحددة، لا إلى نتيجة تشغيل جديد هنا. اختبارات متصفح السيرفر تستخدم المكونات الفعلية مع REST وهمي؛ ليست backend E2E. أعداد الاختبارات من المراجعات الفردية المقبولة ضمن حدودها.

| # | الصفحة والتحكم/مسار البيانات | الإصلاح والأدلة وحدودها |
|---|---|---|
| 1 | [LicensePage](../../src/pages/LicensePage.jsx): التفعيل وحالة الترخيص والملف المحلي. | تحقق العقود والأخطاء والكتابة دون إضافة وظائف تجارية؛ [اختبار الترخيص](../../tests/license/license.test.js): 38 فحصًا. إلغاء الخادم لا يبطل ملف offline محفوظًا مسبقًا. |
| 2 | [CustomerDisplay](../../src/pages/customer-display/CustomerDisplayPage.jsx): عرض بيانات العميل وتحديثها. | معالجة العرض والحالات الفارغة والأخطاء؛ [اختبار](../../tests/customer-display/customer-display.test.js): 47، و[فحص المتصفح](../../tests/customer-display/browser_check.py). لا شاشة عميل فعلية. |
| 3 | [CashierConnect](../../src/pages/CashierConnectPage.jsx): ربط الكاشير والخدمة المحلية. | تحقق الاتصال والاستجابة والأخطاء؛ [اختبار](../../tests/cashier-connect/cashier-connect.test.js): 45 مع خدمة localhost حقيقية، لا إنتاج ولا جهاز LAN فعلي. |
| 4 | [StoreDevices](../../server/dashboard/src/pages/StoreDevicesPage.jsx): شبكة المحلات والأجهزة، المزامنة والاسم والقفل. | معالجة legacy والتواريخ، الرد القديم وقفل الكتابة والضغط المزدوج؛ [اختبار](../../tests/server-dashboard-fleet/fleet.test.js): 25، و[المتصفح](../../server/dashboard/tests/fleet.browser.mjs) مستقل ببيانات وهمية. مصفوفة AR/EN وdark/light وثلاثة عروض = 12 تركيبة. |
| 5 | [Stores](../../server/dashboard/src/pages/StoresPage.jsx): قائمة المحلات وتحكماتها. | التحقق والحالات والأخطاء والاستجابات القديمة؛ [اختبار](../../tests/server-dashboard-stores/stores.test.js): 77، و[المتصفح](../../server/dashboard/tests/stores.browser.mjs). عطل التخزين وunmount أثناء طلب معلّق غير مختبرين صراحةً في الواجهة. |
| 6 | [Cashiers](../../server/dashboard/src/pages/CashiersPage.jsx): قائمة الكاشيرات وعمليات الكتابة. | ضبط البيانات والتحقق وقفل الطلبات وأخطاء الحفظ؛ [القائمة](../../tests/server-dashboard-cashier-list/list.test.js): 33، و[الكتابة](../../tests/server-dashboard-cashiers/cashiers.test.js): 59، و[المتصفح](../../server/dashboard/tests/cashiers.browser.mjs). |
| 7 | [FeatureFlags](../../server/dashboard/src/pages/FeatureFlagsPage.jsx): قراءة الميزات وتعديلها دفعة أو منفردة. | تحقق الأنواع والدفعات والكتابة وحالة الحفظ؛ [القراءة](../../tests/server-dashboard-flags-read/read.test.js): 36، و[الدفعات](../../tests/server-dashboard-flags-read-batch/read-batch.test.js): 54، و[الكتابة](../../tests/server-dashboard-flags-write/write.test.js): 60، و[المتصفح](../../server/dashboard/tests/flags.browser.mjs). |
| 8 | [LicenseGenerator](../../server/dashboard/src/pages/LicenseGeneratorPage.jsx): إصدار وتنزيل وإلغاء تراخيص الخادم. | صحة التاريخ والقراءة والكتابة ورسائل الأخطاء؛ [القراءة](../../tests/server-dashboard-licenses-read/read.test.js): 40، و[الكتابة](../../tests/server-dashboard-licenses-write/write.test.js): 65، و[المتصفح](../../server/dashboard/tests/licenses.browser.mjs). revoke400 والإرسال المزدوج بلوحة المفاتيح غير مختبرين صراحةً في الواجهة. |
| 9 | [DashboardOverview](../../server/dashboard/src/pages/DashboardOverview.jsx): ملخص المحلات والأجهزة وصحة البيانات. | يميّز الصفر المعروف عن المجهول ولا يختلق صحة DB أو بيانات غير مسجلة؛ [اختبار](../../tests/server-dashboard-overview/overview.test.js): 37، و[المتصفح](../../server/dashboard/tests/overview.browser.mjs). |
| 10 | [Login/Auth](../../server/dashboard/src/pages/LoginPage.jsx): الدخول والجلسة وتغيير كلمة المرور. | رفض الاستجابة المشوهة، وصدق فشل التخزين، والخمول وسباق الجلسة؛ [اختبار HTTP](../../tests/server-dashboard-auth/auth.test.js): 20، و[المتصفح](../../server/dashboard/tests/auth.browser.mjs): لكل من login وFPC مصفوفة 12. لا JWT refresh جديد. |
| 11 | [VitalTelemetry](../../server/dashboard/src/pages/VitalTelemetryPage.jsx): مقاييس الصحة وpolling. | unknown بدل قياسات مختلقة، وفصل DB عن pool وpause/retry/cleanup؛ [اختبار](../../tests/server-dashboard-vitals/vitals.test.js): 31، و[المتصفح](../../server/dashboard/tests/vitals.browser.mjs). ليست ضمانًا لصحة الإنتاج. |
| 12 | [OTA](../../server/dashboard/src/pages/OtaReleasesPage.jsx): الإصدارات والنشر والإيقاف. | اختبار التفاعلات موسّع، مع حماية الكتابة والردود القديمة؛ [اختبار](../../tests/server-dashboard-releases/releases.test.js): 26، و[المتصفح](../../server/dashboard/tests/releases.browser.mjs). الإيقاف يمنع العروض المستقبلية لا الملفات المنزّلة. |
| 13 | [Audit/DLQ](../../server/dashboard/src/pages/AuditAndFailuresPage.jsx): السجل والأعطال وإعادة المحاولة. | تحقق الفلاتر والصفحات والحالات والكتابة؛ حارس schema الخلفي يرفض جسم retry المصفوفي كاملًا أو المجهول أو typo أو actor؛ [HTTP](../../tests/server-dashboard-audit/audit.test.js): 53، و[ربط DB](../../tests/server-dashboard-audit-db/bound-transaction.test.js): 48، و[المتصفح](../../server/dashboard/tests/audit.browser.mjs) أُعيد بنجاح بعد تصحيح locale، مع تحقق Intl في جدولي DLQ وAudit بكل التخطيطات الاثني عشر. |

## أبرز الإصلاحات الجوهرية

- التفعيل: حراسة الطلبات والكتابة والأخطاء وحدود الملف؛ بقي تنسيق NXL2 ومفاتيح الثقة الأصلية دون تغيير.
- شاشة العميل والربط: إسقاط التكاليف والأسرار من بيانات العرض، والحفاظ على الإجماليات المرتجعة بإشارتها وترتيب IPC/Broadcast؛ وفحص health الحقيقي وحدود الاتصال والحفظ الذري وفوز disconnect على الرد المتأخر.
- المحلات والكاشيرات والأجهزة: تصحيح عقود الجدول والتحقق من UUID/SERIAL والأنواع والصلاحيات؛ عدم تسريب key_hash أو lease_token، وعدم احتساب heartbeat المستقبلي أو الجهاز غير النشط متصلًا.
- الميزات: التمييز بين false و0 وunknown، وعدم تحويل البيانات الفاسدة إلى false؛ تحقق own-key للقوالب والدفعات، وحفظ المفاتيح المخزنة غير المعروفة وإبطال cache بعد الحفظ فقط.
- التراخيص: استخدام يوم DATE القانوني دون إسقاط يوم بسبب timezone عند إعادة التنزيل، مع اختبارات UTC/Cairo/Los_Angeles؛ لا token ناجح عند فشل التسجيل أو التوقيع، ولا إعادة تنزيل ترخيص مُلغى من الخادم.
- الملخص والمؤشرات: عدم عرض صحة سليمة أو صفر مختلق عند فشل القياس، واستبعاد المستقبل من نافذة آخر 24 ساعة، واستخدام نسبة heap المقاسة من bytes بدل MB المقربة، وفصل DB عن pool وعدم استنتاج Circuit Breaker من ping.
- الدخول: session fail-closed عند فشل التخزين أو الرد المشوه، وحفظ pending token في الذاكرة فقط، وصدق نجاح تغيير كلمة المرور مع فشل حفظ الجلسة، وحراس السباق والخمول والتنظيف.
- OTA: حفظ rollout0، وتطبيع الإصدار والتحقق من URL وSHA-512، وتجميد draft أثناء النشر، وإرسال false/true دون coercion، وفصل نجاح الحفظ عن فشل تحديث القائمة، وعرض نطاق الإحصاءات دون ادعاء أنها إجمالي الأسطول.
- التدقيق: عقود camelCase والحالات الفعلية، ومعرّف BIGSERIAL بلا تقريب؛ حراسة ledger والحالة قبل dispatch والربط الاختياري لكتابات model في المعاملة اليدوية. أضاف المشرف مباشرةً حارس body من سطر واحد لفك فحص فاشل؛ ثبتت له حالات دائمة تمنع replay عند إرسال جسم مصفوفي أو مفاتيح typo/actor غير مسموحة.

نماذج الصور الحالية ببيانات خيالية: [التدقيق على الهاتف](../../outputs/round13-dashboard/audit/after-ar-dark-375.png) و[OTA على الهاتف](../../outputs/round13-dashboard/releases/ota-after-final-refinement-en-light-375.png).

## سلوك مشترك وحدود تغطية الواجهة

- عولجت القيم المعروفة صفرًا منفصلة عن unknown، والتحقق الصارم من الحالات والأنواع والصفحات حيث ينطبق، ورفض الردود القديمة والإلغاء وقفل الكتابة.
- رسائل نجاح الحفظ مع فشل التحديث اللاحق لا تُقدَّم كفشل حفظ؛ شملت الأعمال لوحة المفاتيح والحوارات وRTL والسمات والاستجابة. هذه ليست شهادة وصول رسمية.
- OTA: التغطية الآلية لـ44 تخص أزرار حوار النشر، وunmount يثبت عدم GET لاحق أو تحديث UI لا قياس المؤقت مباشرة.
- Audit: علامتا `alreadyProcessed` و`skipped` غير مختبرتين صراحةً؛ الخلفي الحالي يعيد 409.
- لقطات Audit الأصلية قبل العمل مفقودة؛ before-refinement حالة جزئية حالية فقط. صور License وOTA قبل التنقيح النهائي جزئية وليست original-before. صور الدخول قبل العمل عند 375 و1280 فقط، لا مصفوفة كاملة. الصور الحقيقية الأخرى تُنسب إلى حدود تسجيلها فقط؛ لا صور أصلية مختلقة.

## حدود الخلفي والتشغيل

- `pg-mem` وadapters، ومنها تحويل `FILTER` إلى `WHERE` فعلي وsnapshots وتسجيل advisory، وfake-pg ذي 48 فحصًا، تثبت predicates والتوجيه ودورة الحياة فقط، لا ACID أو التزامن في PostgreSQL/Redis الأصليين.
- dispatch في HTTP الخاص بـAudit stub؛ توجيه نموذج catalog الفعلي مختبر منفصلًا. إعادة المحاولة اليدوية تستخدم `withBoundTransaction` اختياريًا؛ الإدخال العادي لا يزال يتجاهل client الممرر في بعض استدعاءات model، وقيد المعاملات الأوسع لم يُعالج. لا ضمان exactly-once أو global pipeline.
- تغليف Docker السابق ينسخ شجرة server بينما controller الترخيص يستورد `electron/services/license/licenseFormat` من الجذر؛ لم يُختبر نشر Docker/native ولم يُصلح التغليف.
- لم يُشغّل POS أو تُفتح قاعدة المحل الأصلية؛ مجموعة real-store متخطاة عمدًا. لا اختبار شاشة عميل فعلية أو LAN أو طابعة أو OTA حيّ، ولا قراءة مفاتيح خاصة أو بيانات اعتماد أو اتصال إنتاج. لم يحدث نشر Git.
- صفحة desktop `DashboardPage` مستبعدة وتبقى غير موصولة وغير مضافة؛ لا إضافات أعمال F1–F9. البنود القديمة غير المتعلقة، ومنها P1، تبقى مفتوحة كما في [القائمة](OPEN_ITEMS.md).
