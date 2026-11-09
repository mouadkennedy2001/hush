# Hush Stickers — مكتبة الستيكرات الدائمة (65 ستيكر)

> **المكان:** المصدر `Sticker/` (هذا المجلد) والتشغيل `public/sticker/`.
> **التصميم:** 65 رسمة OpenMoji معروفة دائمة (CC BY-SA 4.0 — انظر المصدر أسفله) (faces / animals / objects / emblems / notes) — نفس رسومات الإيموجي — تُحفظ محليًا وتُرسل كأكواد قصيرة مثل `:sticker-01:` في الدردشة (غرف + خوادم)، وتظهر في المنتقي بجانب الإيموجي.

## البنية

```
Sticker/
  README.md           ← هذا الملف
  CHANGELOG.md        ← سجل الإصدارات
  stickers.json       ← بيان (id, en, ar, cat, url) — مرجع الواجهة
  sticker-01.svg … sticker-65.svg  ← المصدر (نسخة public/sticker/ هي العاملة)
```

## الاستخدام

- الواجهة (`public/js/emoji.js`) تصدّر `CUSTOM_STICKERS` (65) + `isCustomSticker` + `stickerUrl` + `searchStickers`.
- المنتقي (غرف + خوادم): تبويبات `faces/animals/objects/emblems/notes` + بحث عربي/إنجليزي + أخير.
- الرسائل: `:sticker-01:` تُعرَض كصورة 44px (وحدها 64px) — تمامًا مثل الإيموجي لكن أكبر وأوضح.

## GIF

- أي رابط `https://…/image.gif` مباشر يُعرَض داخل الرسالة (بدون API أو مفاتيح).
- أزرار البحث تفتح `tenor.com/search/<query>` (مجاني، بدون مفتاح) — انسخ رابط GIF المباشر والصقه هنا.

## الضمانات

- ملفات دائمة محلية — لا اعتماد على شبكة خارجية للستيكرات.
- SVG فقط (لا يونيكود) — تغطية نسخة `public/sticker/` اختبارية.
