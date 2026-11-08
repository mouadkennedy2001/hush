# PING OP Changelog — سجل إصدارات المكتبة

## [ping v1.0.1] — 2026-11-08 — توثيق صادق + شارة عربية (Hz)

- **توثيق:** `src/server.js` header corrected — the server echoes time,
  the client measures RTT; /api/health honestly reflects that (no fake
  "global picture" claim).
- **واجهة:** badge `PING OP` (تحسين البنق) on index, room and server
  headers via `arabicLabel()`;` timings unchanged.

## [ping v1.0.0] — 2026-11-08 — الإصدار الأول من الصفر (Hz)

- **إضافة:** محرك أساسي `src/ping-op.js` (createPingOp + PingOp):
  عينات + min/avg/median/max + jitter + lossRate + quality + score (0..100)
  + دورة تكيّفية + reset. pure، بلا I/O، بلا timers.
- **إضافة:** محول خادم `src/server.js` (createPingServer):
  `ping:request` بـ echo + rate-limit، `httpHandler` لـ `/api/ping`،
  و `applyHardening` (TCP_NODELAY + keepAlive 30s + headers 35s).
- **إضافة:** عميل متصفح `src/client.js`: مسباران متوازيان،
  min(آخر 4)، ساعة أحادية، إيقاف عند إخفاء التبويب، sparkline مرئي فقط،
  fallback HTTP.
- **إدماج:** `src/app.js` يستخدم المحول مباشرة، و `public/js/ping.js`
  يغذي نفس المحرك (getPingModel يشمل score + version).
- **إضافة:** اختبارات `tests/ping-op.test.js` (معدل v1.0).
- **إصلاحات:** استعاضة عن منطقة “رقم يتراقص + تحديث بطيء” في ping v4
  بموديل min-of-rounds + تكيّف مباشر.
