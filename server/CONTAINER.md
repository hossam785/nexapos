# تغليف الخادم

يستخدم البناء جذر المستودع سياقاً له لأن متحكم التراخيص يستورد وحدتي التنسيق والمفتاح العام من `electron`. تبقى بنية المسارات داخل الصورة تحت `/usr/src/app/server`، وتُنسخ الوحدتان العامتان فقط. تُبنى لوحة التحكم من مصادرها وملف القفل في مرحلة منفصلة، ولا تُستخدم `dist` المحلية.

من جذر المستودع، بعد تجهيز بيئة آمنة ومراجعة إعدادات النشر، يمكن تنفيذ الأوامر التالية لاحقاً؛ **لم تُنفَّذ هنا**:

```sh
docker build -f server/Dockerfile -t nexa-server .
docker compose -f server/docker-compose.yml build web-api
docker compose -f server/docker-compose.prod.yml build web-api
```

يجب توفير `LICENSE_SIGNING_KEY` سراً وقت التشغيل بصيغة PEM؛ يمرره Compose أيضاً باسم `NEXA_LICENSE_PRIVATE_KEY_PEM`. يجب أن يطابق المفتاح الخاص المفتاح العام الموثوق المضمّن، دون وضع المفتاح في سياق البناء أو الصورة أو مشاركة قيمته. يلزم أيضاً ضبط `DATABASE_URL` و`REDIS_URL` و`JWT_SECRET` وبقية متغيرات Compose المطلوبة بصورة آمنة. لا يُعد هذا دليلاً على جاهزية الإنتاج.

لتشغيل الاختبارات المعزولة على Windows من جذر المستودع:

```powershell
$env:TEMP=Join-Path $env:USERPROFILE 'AppData\LocalLow\nexa-test-tmp'; $env:TMP=$env:TEMP; Remove-Item Env:MGPOS_REAL_DB -ErrorAction SilentlyContinue; node tests/run.js server-packaging server-dashboard-licenses; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
node --check tests/server-packaging/packaging.test.js; exit $LASTEXITCODE
```

لم يُنفَّذ بناء أو تشغيل Docker أصلي هنا؛ اختبارات التخطيط لا تحل محله.
