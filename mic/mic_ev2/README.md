# mic_ev2 — قفزة Major (STFT حقيقي + Worklet داخل السلسلة)

> **الحالة:** حيّ في زمن التشغيل (2026-11-12). النسخة التقنية `2.0.1`.
> الكود القياسي هنا، والنسخة التي يحمّلها المتصفح في `public/js/room/`
> (الخادم لا يقدّم `/mic` وقت التشغيل) — حافظ على تطابقهما عند رفع الإصدار.

## ما الجديد فعليًا؟

ev2 ليس مجرد تحسين تسمية؛ هو إصلاح جوهري لسلسلة ev1:

- **الـ AudioWorklet داخل الإشارة الآن.** في ev1 كان يُوصَّل كـ tap صامت،
  لذلك لم يصل القامع الطيفي إلى المكالمة إطلاقًا. في ev2:
  `source → high-pass → worklet → low-pass → gate → soft-clip → AGC → limiter → destination`.
- **قامع STFT حقيقي (512 نقطة، هوب 128، تداخل 75%).**
  `src/mic-dsp.js` ينفّذ FFT radix-2، نافذة Hann، طيفًا تكراريًا مع حدّ
  ضوضاء متكيّف لكل bin، طرحًا طيفيًا + مزج Wiener، تنعيمًا تكراريًا (3-tap)
  وتنعيمًا زمنيًا (فتح أسرع من الغلق)، وأرضية كسب تمنع «الضوضاء الموسيقية».
- **إعدادات آمنة:** حجم FFT يُطبّع إلى قوة اثنين صالحة، ويُحسب تطبيع
  overlap-add بحسب حجم النافذة والهوب؛ واجهة المتصفح تثبّت الهوب على 128
  عينة ليتطابق مع كتلة AudioWorklet.
- **بدون تخصيص داخل الحلقة الساخنة.** كل المخازن `Float32Array` تُنشأ مرة
  واحدة في الـ constructor، و`process()` يكتب فيها فقط.
- **سياق صوتي واحد مشترك** مع `MicFx` و`MediaMesh` بدل ثلاثة سياقات
  (توفير CPU وتأخير ومسارات resume متعددة).
- **بوابة/AGC بعد القامع** عبر Analyser ملتصق بعد التنقية، فيتفاعل البوابة
  مع ما سيسمعه الطرف الآخر فعلًا لا مع ضجيج المروحة الخام.
- **API حيّ:** `setStrength` / `setBypass` / `setGateThresholdDb` /
  `setMode` بدون إعادة بناء السلسلة.
- **فشل آمن:** إذا فشل تحميل الـ worklet أو أي عقدة، تُبنى نفس السلسلة
  بـ EQ + gate + limiter؛ وإذا فشل كل شيء يبقى المسار الخام — لا مايك مكسور
  ولا صامت.

## البنية

```
mic_ev2/
  README.md
  version.json
  src/
    mic-dsp.js                  ← FFT + StftNoiseSuppressor (نقي، قابل لاختبار Node)
    mic-enhancer.js             ← createMicEnhancer() واجهة الإدماج + fallback
    mic-settings.js             ← تطهير الإعدادات (clamp + whitelist + deviceId)
  worklet/
    noise-suppress-processor.js ← AudioWorkletProcessor يستورد mic-dsp.js
```

## الاستخدام

```js
import { createMicEnhancer } from './src/mic-enhancer.js';

const enhancer = createMicEnhancer({
  strength: 0.85,          // 0..1
  gateThresholdDb: -42,
  audioContext: sharedCtx  // اختياري: يشارك سياق MediaMesh
});
const result = await enhancer.attach(rawStream);
// result.stream هو المسار المُرسل، وresult.worklet يخبرك هل STFT يعمل
enhancer.setStrength(0.7);
enhancer.dispose();        // لا يغلق السياق المشترك
```

## الضمانات

- **لا كسر:** أي استثناء أثناء `attach()` يعيد الخام.
- **الخصوصية:** كل المعالجة داخل المتصفح؛ لا يمر الصوت بالخادم.
- **الاختبار:** `tests/mic-dsp.test.js` يتحقق من FFT round-trip، تقليل
  ضوضاء ثابتة، والحفاظ على إشارة الكلام، وتطهير الإعدادات.
