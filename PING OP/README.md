# PING OP — مكتبة تحسين ping السيرفر (ping v1.0)

> **الاسم:** PING OP — OP اختصار Optimizer (المحسّن). الاسم العربي للواجهة: **تحسين البنق** (Ping Optimizer). المجلد يبقى `PING OP` كاسم تقني، والشارة العربية تظهر بجانب البنق في الغرف والخوادم.
> مكتبة جديدة مكتوبة من الصفر بالكامل — لا تعتمد على أي مكتبة خارجية.
> مهمتها: قياس وعرض زمن الاستجابة (ping) على الخادم والواجهة بدقة
> وحداثة، مع تحسينات خادم تجعل الرقم الذي تراه هو الرقم الحقيقي.

## لماذا PING OP؟

الرقم القديم كان يعاني من ثلاث مشكلات:

1. **ضجيج الاستطلاع (polling jitter):** قياس واحد كل مرة يجعل الرقم
   يتراقص مع أي تأخير عابر في الطابور.
2. **تحديث بطيء:** الانتظار 5 ثوانٍ يجعل التحسين يظهر متأخرًا.
3. **لا تقدير للجودة:** كان يُعرض رقم بلا جودة/اهتزاز/فقدان، فلا يعرف
   المستخدم إن كان الرقم مستقرًا أم عشوائيًا.

PING OP v1.0 يحلها بثلاث أفكار بسيطة لكنها فعالة:

- **2 مسبارات متوازية في كل جولة، نأخذ الأدنى (الأفضل).**
- **القيمة المعروضة = أدنى 4 جولات أخيرة** — الانخفاض يظهر فورًا،
  والارتفاع العابر لا يسمم الرقم.
- **دورة تكيّفية:** جيد 3s / مقبول 2s / ضعيف 1.2s / غير متصل 0.9s.

## كيف يعمل؟ (طريقة عملها كاملة)

```
[الواجهة: كل دورة]
   ├─ مسبار 1 ── ping:request ──┐
     (monotonic clock)           ▼
   └─ مسبار 2 ── ping:request ──> [الخادم: PING OP/server.js يعيد t/seq/serverTime]
                                  │  (rate-limit 5/s لكل سوكت)
                                  ▼
        [PING OP/core: min(مسبارين) -> sample()]
                                  │
                                  ▼
        [العرض: min(آخر 4 جولات) + جودة + اهتزاز + فقدان + نتيجة 0..100]
                                  │
                    [الواجهة: badge + sparkline عند ظهور اللوحة فقط]
```

**الخادم (server.js):**

- `TCP_NODELAY` على كل سوكت مقبول — يلغي تأخير Nagle (40ms) على
  حزم الإشارة الصغيرة.
- `keepAliveTimeout 30s` + `headersTimeout 35s` — تدوير سريع يقلل
  buffer-bloat.
- Socket.IO `pingInterval 5000ms` — كشف أسرع للأقران الميتين.
- endpoint `GET /api/ping` يرجع `{ ok, time, op, version }` مع
  `Cache-Control: no-store` و `X-Ping-Op`.

**الواجهة (client.js):**

- ساعتان: `performance.now()` أحادي للقياس (لا يتأثر بتغيّر ساعة النظام).
- استئناف/إيقاف تلقائي: يتوقف عندما يكون التبويب مخفيًا (توفير بطارية).
- الرسم البياني (sparkline) يُرسم فقط عندما تكون اللوحة مرئية.
- يحترم `persistPing`؟ لا — القياس دائم أثناء وجودك في غرفة/سيرفر.

## هيكل المجلدات

```
PING OP/
  package.json          ← ping-op v1.0.0 (ESM, بلا dependencies)
  version.json          ← الإصدار + الحالة (active)
  README.md             ← هذا الملف
  CHANGELOG.md          ← سجل التحديثات
  src/
    ping-op.js          ← المحرك الأساسي (إحصاءات + تكيّف + نتيجة)
    server.js           ← محول الخادم (Socket.IO + HTTP + hardening)
    client.js           ← عميل المتصفح (مسبارات + عرض + sparkline)
  tests/
    ping-op.test.js     ← اختبارات المحرك والمحول
```

## الاستخدام

```js
// الخادم (src/app.js — موجود أصلًا):
import { createPingServer } from '../PING OP/src/server.js';
const pingOp = createPingServer();
pingOp.applyHardening(server);      // TCP_NODELAY + timeouts
pingOp.attach(io);                  // socket ping:request
app.get('/api/ping', (req, res) => pingOp.httpHandler(req, res));

// الواجهة (public/js/ping.js — يستخدم نفس المحرك):
import { createPingOp } from './ping-op/ping-op.js';
pingOp.sample(42);                  // ms
const stats = pingOp.getStats();    // { current, jitter, lossRate, quality, score }
```

## الضمانات

- **لا تكسير:** إن فشل Socket.IO، يسقط تلقائيًا إلى `GET /api/ping`.
- **لا فيضان:** حد 5 مسبارات/ثانية لكل سوكت؛ الـ 60+ ترجع rate-limited.
- **الخصوصية:** لا يعبر ping أي تخزين — مجرد echo للزمن.
- **قابلية الاختبار:** المحرك الأساسي pure بلا I/O — اختبارات Node مباشرة.

## التطوير التالي (مخطط)

- `ping v1.1`: per-connection stats لكل سوكت + endpoint `/api/ping/op` للإحصاءات المجمّعة.
- `ping v1.2`: تنبيه عند تدهور الجودة (score < 40 لأكثر من 10 ثوانٍ).
- `ping v2.0`: تجميع عبر multiple relays (TURN) إن أضيفت لاحقًا.
