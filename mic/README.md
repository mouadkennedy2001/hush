# Hush Mic — مكتبة تصفية وتحسين المايك (المجلد `mic/`)

> مكتبة كاملة من الصفر لتصفية المايك وتقليل الضجيج وتحسين جودة الصوت بأقل موارد ممكنة.
> تُبنى على إصدارات متطوّرة: **`mic_ev1` → `mic_ev1.1` → … → `mic_ev1.9` → `mic_ev2`** (نفس النمط يتكرر بعد ev2).
> الإصدار العامل الآن هو **`mic_ev1`** مع تحسينات **ev1.1 (أقصى نقاوة + أمن)** حية في زمن التشغيل (انظر `mic/CHANGELOG.md`). بقية الإصدارات هي خطة التطوّر الموثقة هنا.

## كيف يعمل؟ (طريقة عملها كاملة)

```
[المايك الخام: getUserMedia]
        │
        ▼
┌─────────────────────────────────────────────┐
│  mic_ev1 (WebAudio, بلا مكتبات خارجية)      │
│                                             │
│  1. High-pass 80–100 Hz  (إزالة الدمدمة)    │
│  2. Low-pass 8–12 kHz    (تنعيم الهَس)      │
│  3. Noise gate ذكي       (فتح/غلق سريع)    │
│  4. Spectral suppressor  (RNNoise-like     │
│     تقليل طيفي خفيف ضد مروحة/ضوضاء)        │
│  5. Clipper + limiter    (منع قصّ)          │
│  6. Gain / AGC           (رفع الضعيف)      │
│  7. تنبيه مستوى + CPU     (قياس دوري)       │
└─────────────────────────────────────────────┘
        │  enabled؟ → الصوت المحسّن → RTCPeerConnection (WebRTC P2P)
        │  bypass؟  → الخام مباشرة (fallback آمن)
        ▼
[الباقي يبقى كما هو: MediaMesh يرسل الصوت للآخرين]
```

**قرارات تصميمية (أعلى جودة بأقل موارد):**
- **بلا مكتبات خارجية:** WebAudio + AudioWorklet فقط (ScriptProcessor كاحتياط للأجهزة القديمة). لا TensorFlow ولا ONNX في ev1 — كل شيء DSP خفيف على `Float32Array`.
- **نوافذ صغيرة:** 256–512 عينة (FFT صغير 256) بدل 1024+ — تأخير أقل من ~12ms مع الحفاظ على القدرة على التقليل.
- **بلا تخصيصات في الـ hot loop:** مخازن معاد تدويرها عبر `Float32Array` مخصصة مسبقاً؛ لا `new` داخل `process()`.
- **Adaptive:** شدة التقليل تتلاءم مع الضجيج المقدّر (noise floor) — صوت صافي = تقليل شبه صفر.
- **Bypass اختياري + Meter:** المستخدم يرى المستوى وحالة كتم الضجيج (gated) قبل الإرسال.
- **Fallback آمن:** أي فشل (لا Worklet / لا جهاز) يعيد المسار الخام فوراً وبلا تعطيل الصوت.

## هيكل المجلدات

```
mic/
  README.md           ← هذا الملف (نظرة شاملة)
  CHANGELOG.md        ← كل إصدار وتغييره
  mic_ev1/            ← الإصدار العامل الآن
    README.md
    src/mic-enhancer.js          (واجهة الإدماج: create(config))
    src/spectral.js              (محرك القامع الطيفي)
    src/gate-agc.js              (بوابة + ضاغط + AGC)
    worklet/noise-suppress-processor.js  (AudioWorkletProcessor)
  mic_ev1.1/ … mic_ev1.9/        ← إضافات تراكمية (README + CHANGELOG لكل إصدار)
  mic_ev2/                     ← قفزة Major: نموذج AI خفيف + fallback إلى ev1
  presets/             ← إعدادات جاهزة (هدوء، جماعة، سفر، للأطفال)
```

## استخدام سريع

```js
// في public/js/room/media.js (موجود أصلاً — يختار تلقائياً):
import { createMicEnhancer } from './mic-enhancer.js';
const enhancer = createMicEnhancer({ strength: 0.8 });   // 0..1
const track = await enhancer.attach(rawStream);          // يعيد مساراً بروابط العمل
```

- كل خيار (`strength`, `gate`, `agcTarget`, `hpHz`, `lpHz`) قابل للضبط من `loadMicSettings()`.
- `enhancer.dispose()` ينظّف العقد والمؤقّتات (لا تسريب).

## الضمانات

- **لا كسر:** إن غاب Worklet أو تعذّر إنشاؤه، يعود إلى مسار `MediaStreamSource → Biquad → Gain`، وإن تعطّل كل شيء يعيد الخام.
- **الحفاظ على وقت:** المعالجة كليّاً على جهة الناقل (`RTCPeerConnection`) — لا يمر الصوت بالسيرفر.
- **الخصوصية:** لا يعبر الصوت الخادم إطلاقاً (WebRTC P2P فقط)؛ `mic/` يعمل داخل المتصفح فقط.
