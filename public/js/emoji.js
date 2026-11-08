// Custom site emojis — hand-made SVGs in public/emoji/, ONLY for Hush.
// The whole site uses these (soundboard, chat shortcodes, reactions,
// floating reactions, landing demo) — no Unicode/global emojis.
// In chat, an emoji is written as a shortcode like :laugh: and rendered
// as an <img> by the message renderer.
//
// Design v9: the picker is categorized (faces / hands / objects / fun /
// sounds), searchable, with recent use and bilingual labels. Every emoji
// has a stable :id: shortcode so old messages keep rendering.
export const CUSTOM_EMOJIS = [
  // Sounds
  { id: 'airhorn', url: '/emoji/airhorn.svg', cat: 'sound', en: 'Airhorn', ar: 'بوق' },
  { id: 'rimshot', url: '/emoji/rimshot.svg', cat: 'sound', en: 'Rimshot', ar: 'قرع' },
  { id: 'applause', url: '/emoji/applause.svg', cat: 'sound', en: 'Applause', ar: 'تصفيق' },
  { id: 'trombone', url: '/emoji/trombone.svg', cat: 'sound', en: 'Sad trombone', ar: 'ترمبون حزين' },
  { id: 'boing', url: '/emoji/boing.svg', cat: 'sound', en: 'Boing', ar: 'بوينغ' },
  { id: 'ding', url: '/emoji/ding.svg', cat: 'sound', en: 'Ding', ar: 'جرس' },
  { id: 'pop', url: '/emoji/pop.svg', cat: 'sound', en: 'Pop', ar: 'فرقعة' },
  { id: 'fart', url: '/emoji/fart.svg', cat: 'sound', en: 'Fart', ar: 'ضرطة' },
  { id: 'cat', url: '/emoji/cat.svg', cat: 'sound', en: 'Meow', ar: 'مواء' },
  { id: 'wow', url: '/emoji/wow.svg', cat: 'sound', en: 'Wow', ar: 'واو' },
  { id: 'crickets', url: '/emoji/crickets.svg', cat: 'sound', en: 'Crickets', ar: 'صراصير' },
  { id: 'tada', url: '/emoji/tada.svg', cat: 'sound', en: 'Ta-da', ar: 'تا-دا' },
  { id: 'laser', url: '/emoji/laser.svg', cat: 'sound', en: 'Laser', ar: 'ليزر' },
  { id: 'siren', url: '/emoji/siren.svg', cat: 'sound', en: 'Siren', ar: 'صافرة' },
  { id: 'drumroll', url: '/emoji/drumroll.svg', cat: 'sound', en: 'Drumroll', ar: 'قرع الطبول' },
  { id: 'yay', url: '/emoji/yay.svg', cat: 'sound', en: 'Yay', ar: 'ياااه' },
  // Faces & feelings
  { id: 'smile', url: '/emoji/smile.svg', cat: 'face', en: 'Smile', ar: 'ابتسامة' },
  { id: 'laugh', url: '/emoji/laugh.svg', cat: 'face', en: 'Laugh', ar: 'ضحك' },
  { id: 'love', url: '/emoji/love.svg', cat: 'face', en: 'Love eyes', ar: 'عيون قلب' },
  { id: 'cool', url: '/emoji/cool.svg', cat: 'face', en: 'Cool', ar: 'بارد' },
  { id: 'think', url: '/emoji/think.svg', cat: 'face', en: 'Thinking', ar: 'تفكير' },
  { id: 'sad', url: '/emoji/sad.svg', cat: 'face', en: 'Sad', ar: 'حزن' },
  { id: 'angry', url: '/emoji/angry.svg', cat: 'face', en: 'Angry', ar: 'غضب' },
  { id: 'party', url: '/emoji/party.svg', cat: 'face', en: 'Party', ar: 'احتفال' },
  { id: 'sleep', url: '/emoji/sleep.svg', cat: 'face', en: 'Sleep', ar: 'نوم' },
  { id: 'mindblown', url: '/emoji/mindblown.svg', cat: 'face', en: 'Mind blown', ar: 'دهشة' },
  { id: 'hush', url: '/emoji/hush.svg', cat: 'face', en: 'Hush', ar: 'همس' },
  { id: 'wink', url: '/emoji/wink.svg', cat: 'face', en: 'Wink', ar: 'غمزة' },
  { id: 'surprised', url: '/emoji/surprised.svg', cat: 'face', en: 'Surprised', ar: 'دهشة' },
  { id: 'cry', url: '/emoji/cry.svg', cat: 'face', en: 'Cry', ar: 'بكاء' },
  { id: 'kiss', url: '/emoji/kiss.svg', cat: 'face', en: 'Kiss', ar: 'قبلة' },
  { id: 'dizzy', url: '/emoji/dizzy.svg', cat: 'face', en: 'Dizzy', ar: 'دوخة' },
  { id: 'starstruck', url: '/emoji/starstruck.svg', cat: 'face', en: 'Starstruck', ar: 'نجوم' },
  { id: 'robot', url: '/emoji/robot.svg', cat: 'face', en: 'Robot', ar: 'روبوت' },
  { id: 'ghost', url: '/emoji/ghost.svg', cat: 'face', en: 'Ghost', ar: 'شبح' },
  { id: 'alien', url: '/emoji/alien.svg', cat: 'face', en: 'Alien', ar: 'فضائي' },
  { id: 'heart', url: '/emoji/heart.svg', cat: 'face', en: 'Heart', ar: 'قلب' },
  { id: 'fire', url: '/emoji/fire.svg', cat: 'face', en: 'Fire', ar: 'نار' },
  { id: 'star', url: '/emoji/star.svg', cat: 'face', en: 'Star', ar: 'نجمة' },
  { id: 'sparkles', url: '/emoji/sparkles.svg', cat: 'face', en: 'Sparkles', ar: 'بريق' },
  { id: 'glowstar', url: '/emoji/glowstar.svg', cat: 'face', en: 'Glow star', ar: 'نجمة متوهجة' },
  { id: 'eyes', url: '/emoji/eyes.svg', cat: 'face', en: 'Eyes', ar: 'عيون' },
  // Hands & body
  { id: 'wave', url: '/emoji/wave.svg', cat: 'hand', en: 'Wave', ar: 'تلويح' },
  { id: 'ok', url: '/emoji/ok.svg', cat: 'hand', en: 'OK', ar: 'تمام' },
  { id: 'thumbsup', url: '/emoji/thumbsup.svg', cat: 'hand', en: 'Thumbs up', ar: 'إبهام أعلى' },
  { id: 'thumbsdown', url: '/emoji/thumbsdown.svg', cat: 'hand', en: 'Thumbs down', ar: 'إبهام أسفل' },
  { id: 'pray', url: '/emoji/pray.svg', cat: 'hand', en: 'Pray', ar: 'دعاء' },
  { id: 'strong', url: '/emoji/strong.svg', cat: 'hand', en: 'Strong', ar: 'قوة' },
  // Objects & fun
  { id: 'hundred', url: '/emoji/hundred.svg', cat: 'fun', en: 'Hundred', ar: 'مئة' },
  { id: 'idea', url: '/emoji/idea.svg', cat: 'fun', en: 'Idea', ar: 'فكرة' },
  { id: 'book', url: '/emoji/book.svg', cat: 'fun', en: 'Book', ar: 'كتاب' },
  { id: 'coffee', url: '/emoji/coffee.svg', cat: 'fun', en: 'Coffee', ar: 'قهوة' },
  { id: 'pizza', url: '/emoji/pizza.svg', cat: 'fun', en: 'Pizza', ar: 'بيتزا' },
  { id: 'ball', url: '/emoji/ball.svg', cat: 'fun', en: 'Ball', ar: 'كرة' },
  { id: 'game', url: '/emoji/game.svg', cat: 'fun', en: 'Game', ar: 'لعبة' },
  { id: 'rocket', url: '/emoji/rocket.svg', cat: 'fun', en: 'Rocket', ar: 'صاروخ' },
  { id: 'check', url: '/emoji/check.svg', cat: 'fun', en: 'Check', ar: 'صح' },
  { id: 'cross', url: '/emoji/cross.svg', cat: 'fun', en: 'Cross', ar: 'خطأ' },
  { id: 'music', url: '/emoji/music.svg', cat: 'fun', en: 'Music', ar: 'موسيقى' },
  { id: 'flower', url: '/emoji/flower.svg', cat: 'fun', en: 'Flower', ar: 'زهرة' }
];

export const EMOJI_CATEGORIES = [
  { id: 'all', en: 'All', ar: 'الكل' },
  { id: 'recent', en: 'Recent', ar: 'الأخير' },
  { id: 'face', en: 'Faces', ar: 'وجوه' },
  { id: 'hand', en: 'Hands', ar: 'أيدٍ' },
  { id: 'fun', en: 'Fun', ar: 'متعة' },
  { id: 'sound', en: 'Sounds', ar: 'أصوات' }
];

const BY_ID = new Map(CUSTOM_EMOJIS.map((e) => [e.id, e]));
const SHORTCODE_RE = /:([a-z][a-z0-9_-]{1,30}):/g;

export function isCustomEmoji(id) { return BY_ID.has(id); }
export function emojiUrl(id) { return BY_ID.get(id)?.url ?? '/emoji/star.svg'; }
export function emojiShortcode(id) { return `:${id}:`; }
export function emojiLabel(id, lang = 'en') {
  const e = BY_ID.get(id);
  if (!e) return `:${id}:`;
  return lang === 'ar' ? e.ar : e.en;
}
export function emojiCategory(id) { return BY_ID.get(id)?.cat ?? 'fun'; }
export function emojisInCategory(cat) {
  if (cat === 'all') return CUSTOM_EMOJIS;
  return CUSTOM_EMOJIS.filter((e) => e.cat === cat);
}
export function searchEmojis(query, limit = 60) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return CUSTOM_EMOJIS.slice(0, limit);
  return CUSTOM_EMOJIS.filter((e) =>
    e.id.includes(q) || e.en.toLowerCase().includes(q) || String(e.ar ?? '').includes(q)
  ).slice(0, limit);
}
export function customEmojiImage(id, className = 'custom-emoji') {
  const img = document.createElement('img');
  img.src = emojiUrl(id);
  img.alt = emojiLabel(id, typeof document !== 'undefined' && document.documentElement?.lang === 'ar' ? 'ar' : 'en');
  img.title = `:${id}:`;
  img.className = className;
  img.draggable = false;
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}
// Split text into plain segments and custom-emoji shortcodes.
export function splitEmojiShortcodes(text) {
  const parts = [];
  let last = 0;
  for (const match of String(text ?? '').matchAll(SHORTCODE_RE)) {
    const id = match[1];
    if (!BY_ID.has(id)) continue;
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: String(text).slice(last, index) });
    parts.push({ emoji: id });
    last = index + match[0].length;
  }
  if (last === 0) return [{ text: String(text ?? '') }];
  if (last < String(text ?? '').length) parts.push({ text: String(text).slice(last) });
  return parts;
}
/** True when the message is only shortcodes + whitespace (render big). */
export function isEmojiOnlyMessage(text) {
  const parts = splitEmojiShortcodes(text);
  return parts.length > 0 && parts.every((p) => p.emoji || !String(p.text ?? '').trim());
}
export function preloadCustomEmojis() {
  for (const emoji of CUSTOM_EMOJIS) {
    try { const img = new Image(); img.src = emoji.url; } catch { /* ignore */ }
  }
}

const RECENT_KEY = 'hush:emoji-recent';
export function getRecentEmojis() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((id) => BY_ID.has(id)).slice(0, 12) : [];
  } catch { return []; }
}
export function pushRecentEmoji(id) {
  if (!BY_ID.has(id)) return;
  try {
    const recent = [id, ...getRecentEmojis().filter((x) => x !== id)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch { /* ignore */ }
}
