// Custom site emojis — Twemoji SVGs in public/emoji/ (CC-BY 4.0, see
// public/emoji/ATTRIBUTION.md), ONLY for Hush. The whole site uses these
// (soundboard, chat shortcodes, reactions, floating reactions, landing
// demo) — no Unicode/global emojis.
// In chat, an emoji is written as a shortcode like :laugh: and rendered
// as an <img> by the message renderer.
//
// Design v9: the picker is categorized (faces / hands / objects / fun /
// sounds), searchable, with recent use and bilingual labels. Every emoji
// has a stable :id: shortcode so old messages keep rendering.
//
// v12.3: asset URLs carry a cache-busting version (?v=twemoji-2). The
// server caches versioned emoji/sticker assets as immutable, so bump
// this version whenever the pack changes — otherwise browsers keep
// showing the old emojis for a day (the "didn't change" bug).
export const EMOJI_ASSET_VERSION = 'twemoji-2';
export const CUSTOM_EMOJIS = [
  // Sounds
  { id: 'airhorn', url: '/emoji/airhorn.svg?v=twemoji-2', cat: 'sound', en: 'Airhorn', ar: 'بوق' },
  { id: 'rimshot', url: '/emoji/rimshot.svg?v=twemoji-2', cat: 'sound', en: 'Rimshot', ar: 'قرع' },
  { id: 'applause', url: '/emoji/applause.svg?v=twemoji-2', cat: 'sound', en: 'Applause', ar: 'تصفيق' },
  { id: 'trombone', url: '/emoji/trombone.svg?v=twemoji-2', cat: 'sound', en: 'Sad trombone', ar: 'ترمبون حزين' },
  { id: 'boing', url: '/emoji/boing.svg?v=twemoji-2', cat: 'sound', en: 'Boing', ar: 'بوينغ' },
  { id: 'ding', url: '/emoji/ding.svg?v=twemoji-2', cat: 'sound', en: 'Ding', ar: 'جرس' },
  { id: 'pop', url: '/emoji/pop.svg?v=twemoji-2', cat: 'sound', en: 'Pop', ar: 'فرقعة' },
  { id: 'fart', url: '/emoji/fart.svg?v=twemoji-2', cat: 'sound', en: 'Fart', ar: 'ضرطة' },
  { id: 'cat', url: '/emoji/cat.svg?v=twemoji-2', cat: 'sound', en: 'Meow', ar: 'مواء' },
  { id: 'wow', url: '/emoji/wow.svg?v=twemoji-2', cat: 'sound', en: 'Wow', ar: 'واو' },
  { id: 'crickets', url: '/emoji/crickets.svg?v=twemoji-2', cat: 'sound', en: 'Crickets', ar: 'صراصير' },
  { id: 'tada', url: '/emoji/tada.svg?v=twemoji-2', cat: 'sound', en: 'Ta-da', ar: 'تا-دا' },
  { id: 'laser', url: '/emoji/laser.svg?v=twemoji-2', cat: 'sound', en: 'Laser', ar: 'ليزر' },
  { id: 'siren', url: '/emoji/siren.svg?v=twemoji-2', cat: 'sound', en: 'Siren', ar: 'صافرة' },
  { id: 'drumroll', url: '/emoji/drumroll.svg?v=twemoji-2', cat: 'sound', en: 'Drumroll', ar: 'قرع الطبول' },
  { id: 'yay', url: '/emoji/yay.svg?v=twemoji-2', cat: 'sound', en: 'Yay', ar: 'ياااه' },
  // Faces & feelings
  { id: 'smile', url: '/emoji/smile.svg?v=twemoji-2', cat: 'face', en: 'Smile', ar: 'ابتسامة' },
  { id: 'laugh', url: '/emoji/laugh.svg?v=twemoji-2', cat: 'face', en: 'Laugh', ar: 'ضحك' },
  { id: 'love', url: '/emoji/love.svg?v=twemoji-2', cat: 'face', en: 'Love eyes', ar: 'عيون قلب' },
  { id: 'cool', url: '/emoji/cool.svg?v=twemoji-2', cat: 'face', en: 'Cool', ar: 'بارد' },
  { id: 'think', url: '/emoji/think.svg?v=twemoji-2', cat: 'face', en: 'Thinking', ar: 'تفكير' },
  { id: 'sad', url: '/emoji/sad.svg?v=twemoji-2', cat: 'face', en: 'Sad', ar: 'حزن' },
  { id: 'angry', url: '/emoji/angry.svg?v=twemoji-2', cat: 'face', en: 'Angry', ar: 'غضب' },
  { id: 'party', url: '/emoji/party.svg?v=twemoji-2', cat: 'face', en: 'Party', ar: 'احتفال' },
  { id: 'sleep', url: '/emoji/sleep.svg?v=twemoji-2', cat: 'face', en: 'Sleep', ar: 'نوم' },
  { id: 'mindblown', url: '/emoji/mindblown.svg?v=twemoji-2', cat: 'face', en: 'Mind blown', ar: 'دهشة' },
  { id: 'hush', url: '/emoji/hush.svg?v=twemoji-2', cat: 'face', en: 'Hush', ar: 'همس' },
  { id: 'wink', url: '/emoji/wink.svg?v=twemoji-2', cat: 'face', en: 'Wink', ar: 'غمزة' },
  { id: 'surprised', url: '/emoji/surprised.svg?v=twemoji-2', cat: 'face', en: 'Surprised', ar: 'دهشة' },
  { id: 'cry', url: '/emoji/cry.svg?v=twemoji-2', cat: 'face', en: 'Cry', ar: 'بكاء' },
  { id: 'kiss', url: '/emoji/kiss.svg?v=twemoji-2', cat: 'face', en: 'Kiss', ar: 'قبلة' },
  { id: 'dizzy', url: '/emoji/dizzy.svg?v=twemoji-2', cat: 'face', en: 'Dizzy', ar: 'دوخة' },
  { id: 'starstruck', url: '/emoji/starstruck.svg?v=twemoji-2', cat: 'face', en: 'Starstruck', ar: 'نجوم' },
  { id: 'robot', url: '/emoji/robot.svg?v=twemoji-2', cat: 'face', en: 'Robot', ar: 'روبوت' },
  { id: 'ghost', url: '/emoji/ghost.svg?v=twemoji-2', cat: 'face', en: 'Ghost', ar: 'شبح' },
  { id: 'alien', url: '/emoji/alien.svg?v=twemoji-2', cat: 'face', en: 'Alien', ar: 'فضائي' },
  { id: 'heart', url: '/emoji/heart.svg?v=twemoji-2', cat: 'face', en: 'Heart', ar: 'قلب' },
  { id: 'fire', url: '/emoji/fire.svg?v=twemoji-2', cat: 'face', en: 'Fire', ar: 'نار' },
  { id: 'star', url: '/emoji/star.svg?v=twemoji-2', cat: 'face', en: 'Star', ar: 'نجمة' },
  { id: 'sparkles', url: '/emoji/sparkles.svg?v=twemoji-2', cat: 'face', en: 'Sparkles', ar: 'بريق' },
  { id: 'glowstar', url: '/emoji/glowstar.svg?v=twemoji-2', cat: 'face', en: 'Glow star', ar: 'نجمة متوهجة' },
  { id: 'eyes', url: '/emoji/eyes.svg?v=twemoji-2', cat: 'face', en: 'Eyes', ar: 'عيون' },
  // Hands & body
  { id: 'wave', url: '/emoji/wave.svg?v=twemoji-2', cat: 'hand', en: 'Wave', ar: 'تلويح' },
  { id: 'ok', url: '/emoji/ok.svg?v=twemoji-2', cat: 'hand', en: 'OK', ar: 'تمام' },
  { id: 'thumbsup', url: '/emoji/thumbsup.svg?v=twemoji-2', cat: 'hand', en: 'Thumbs up', ar: 'إبهام أعلى' },
  { id: 'thumbsdown', url: '/emoji/thumbsdown.svg?v=twemoji-2', cat: 'hand', en: 'Thumbs down', ar: 'إبهام أسفل' },
  { id: 'pray', url: '/emoji/pray.svg?v=twemoji-2', cat: 'hand', en: 'Pray', ar: 'دعاء' },
  { id: 'strong', url: '/emoji/strong.svg?v=twemoji-2', cat: 'hand', en: 'Strong', ar: 'قوة' },
  // Objects & fun
  { id: 'hundred', url: '/emoji/hundred.svg?v=twemoji-2', cat: 'fun', en: 'Hundred', ar: 'مئة' },
  { id: 'idea', url: '/emoji/idea.svg?v=twemoji-2', cat: 'fun', en: 'Idea', ar: 'فكرة' },
  { id: 'book', url: '/emoji/book.svg?v=twemoji-2', cat: 'fun', en: 'Book', ar: 'كتاب' },
  { id: 'coffee', url: '/emoji/coffee.svg?v=twemoji-2', cat: 'fun', en: 'Coffee', ar: 'قهوة' },
  { id: 'pizza', url: '/emoji/pizza.svg?v=twemoji-2', cat: 'fun', en: 'Pizza', ar: 'بيتزا' },
  { id: 'ball', url: '/emoji/ball.svg?v=twemoji-2', cat: 'fun', en: 'Ball', ar: 'كرة' },
  { id: 'game', url: '/emoji/game.svg?v=twemoji-2', cat: 'fun', en: 'Game', ar: 'لعبة' },
  { id: 'rocket', url: '/emoji/rocket.svg?v=twemoji-2', cat: 'fun', en: 'Rocket', ar: 'صاروخ' },
  { id: 'check', url: '/emoji/check.svg?v=twemoji-2', cat: 'fun', en: 'Check', ar: 'صح' },
  { id: 'cross', url: '/emoji/cross.svg?v=twemoji-2', cat: 'fun', en: 'Cross', ar: 'خطأ' },
  { id: 'music', url: '/emoji/music.svg?v=twemoji-2', cat: 'fun', en: 'Music', ar: 'موسيقى' },
  { id: 'flower', url: '/emoji/flower.svg?v=twemoji-2', cat: 'fun', en: 'Flower', ar: 'زهرة' },
  // v13.1: 48 more well-known Twemoji (new emoji/new_emojis.json)
  { id: 'grinning', url: '/emoji/grinning.svg?v=twemoji-2', cat: 'face', en: 'Grinning', ar: 'مبتسم' },
  { id: 'laughing', url: '/emoji/laughing.svg?v=twemoji-2', cat: 'face', en: 'Laughing', ar: 'يضحك' },
  { id: 'sweat_smile', url: '/emoji/sweat_smile.svg?v=twemoji-2', cat: 'face', en: 'Sweat smile', ar: 'ابتسامة عرق' },
  { id: 'rolling_laugh', url: '/emoji/rolling_laugh.svg?v=twemoji-2', cat: 'face', en: 'Rolling laugh', ar: 'ضحك شديد' },
  { id: 'slightly_smile', url: '/emoji/slightly_smile.svg?v=twemoji-2', cat: 'face', en: 'Slight smile', ar: 'ابتسامة خفيفة' },
  { id: 'upside_down', url: '/emoji/upside_down.svg?v=twemoji-2', cat: 'face', en: 'Upside down', ar: 'مقلوب' },
  { id: 'melting', url: '/emoji/melting.svg?v=twemoji-2', cat: 'face', en: 'Melting', ar: 'ذائب' },
  { id: 'zany', url: '/emoji/zany.svg?v=twemoji-2', cat: 'face', en: 'Zany', ar: 'مجنون' },
  { id: 'cowboy', url: '/emoji/cowboy.svg?v=twemoji-2', cat: 'face', en: 'Cowboy', ar: 'راعي بقر' },
  { id: 'nerd', url: '/emoji/nerd.svg?v=twemoji-2', cat: 'face', en: 'Nerd', ar: 'عبقري' },
  { id: 'smirk', url: '/emoji/smirk.svg?v=twemoji-2', cat: 'face', en: 'Smirk', ar: 'تبسم' },
  { id: 'pleading', url: '/emoji/pleading.svg?v=twemoji-2', cat: 'face', en: 'Pleading', ar: 'متوسل' },
  { id: 'point_up', url: '/emoji/point_up.svg?v=twemoji-2', cat: 'hand', en: 'Point up', ar: 'أشر للأعلى' },
  { id: 'victory_hand', url: '/emoji/victory_hand.svg?v=twemoji-2', cat: 'hand', en: 'Victory', ar: 'نصر' },
  { id: 'crossed_fingers', url: '/emoji/crossed_fingers.svg?v=twemoji-2', cat: 'hand', en: 'Crossed fingers', ar: 'أصابع متقاطعة' },
  { id: 'love_you', url: '/emoji/love_you.svg?v=twemoji-2', cat: 'hand', en: 'Love you', ar: 'أحبك' },
  { id: 'metal', url: '/emoji/metal.svg?v=twemoji-2', cat: 'hand', en: 'Metal', ar: 'روك' },
  { id: 'call_me', url: '/emoji/call_me.svg?v=twemoji-2', cat: 'hand', en: 'Call me', ar: 'اتصل بي' },
  { id: 'open_hands', url: '/emoji/open_hands.svg?v=twemoji-2', cat: 'hand', en: 'Open hands', ar: 'أيدي مفتوحة' },
  { id: 'handshake', url: '/emoji/handshake.svg?v=twemoji-2', cat: 'hand', en: 'Handshake', ar: 'مصافحة' },
  { id: 'clown', url: '/emoji/clown.svg?v=twemoji-2', cat: 'fun', en: 'Clown', ar: 'مهرج' },
  { id: 'skull', url: '/emoji/skull.svg?v=twemoji-2', cat: 'fun', en: 'Skull', ar: 'جمجمة' },
  { id: 'pumpkin', url: '/emoji/pumpkin.svg?v=twemoji-2', cat: 'fun', en: 'Pumpkin', ar: 'يقطين' },
  { id: 'christmas_tree', url: '/emoji/christmas_tree.svg?v=twemoji-2', cat: 'fun', en: 'Christmas tree', ar: 'شجرة عيد الميلاد' },
  { id: 'gift', url: '/emoji/gift.svg?v=twemoji-2', cat: 'fun', en: 'Gift', ar: 'هدية' },
  { id: 'balloon', url: '/emoji/balloon.svg?v=twemoji-2', cat: 'fun', en: 'Balloon', ar: 'بالون' },
  { id: 'trophy', url: '/emoji/trophy.svg?v=twemoji-2', cat: 'fun', en: 'Trophy', ar: 'كأس' },
  { id: 'crown', url: '/emoji/crown.svg?v=twemoji-2', cat: 'fun', en: 'Crown', ar: 'تاج' },
  { id: 'gem', url: '/emoji/gem.svg?v=twemoji-2', cat: 'fun', en: 'Gem', ar: 'جوهرة' },
  { id: 'moon', url: '/emoji/moon.svg?v=twemoji-2', cat: 'fun', en: 'Moon', ar: 'قمر' },
  { id: 'sun', url: '/emoji/sun.svg?v=twemoji-2', cat: 'fun', en: 'Sun', ar: 'شمس' },
  { id: 'rainbow', url: '/emoji/rainbow.svg?v=twemoji-2', cat: 'fun', en: 'Rainbow', ar: 'قوس قزح' },
  { id: 'earth', url: '/emoji/earth.svg?v=twemoji-2', cat: 'fun', en: 'Earth', ar: 'أرض' },
  { id: 'car', url: '/emoji/car.svg?v=twemoji-2', cat: 'fun', en: 'Car', ar: 'سيارة' },
  { id: 'airplane', url: '/emoji/airplane.svg?v=twemoji-2', cat: 'fun', en: 'Airplane', ar: 'طائرة' },
  { id: 'house', url: '/emoji/house.svg?v=twemoji-2', cat: 'fun', en: 'House', ar: 'بيت' },
  { id: 'cat2', url: '/emoji/cat2.svg?v=twemoji-2', cat: 'fun', en: 'Cat face', ar: 'وجه قطة' },
  { id: 'dog', url: '/emoji/dog.svg?v=twemoji-2', cat: 'fun', en: 'Dog', ar: 'كلب' },
  { id: 'fox', url: '/emoji/fox.svg?v=twemoji-2', cat: 'fun', en: 'Fox', ar: 'ثعلب' },
  { id: 'frog', url: '/emoji/frog.svg?v=twemoji-2', cat: 'fun', en: 'Frog', ar: 'ضفدع' },
  { id: 'see_no_evil', url: '/emoji/see_no_evil.svg?v=twemoji-2', cat: 'fun', en: 'See no evil', ar: 'لا أرى شرًا' },
  { id: 'burger', url: '/emoji/burger.svg?v=twemoji-2', cat: 'fun', en: 'Burger', ar: 'برجر' },
  { id: 'cake', url: '/emoji/cake.svg?v=twemoji-2', cat: 'fun', en: 'Cake', ar: 'كعكة' },
  { id: 'ice_cream', url: '/emoji/ice_cream.svg?v=twemoji-2', cat: 'fun', en: 'Ice cream', ar: 'آيس كريم' },
  { id: 'headphones', url: '/emoji/headphones.svg?v=twemoji-2', cat: 'fun', en: 'Headphones', ar: 'سماعات' },
  { id: 'guitar', url: '/emoji/guitar.svg?v=twemoji-2', cat: 'fun', en: 'Guitar', ar: 'قيثارة' },
  { id: 'dice', url: '/emoji/dice.svg?v=twemoji-2', cat: 'fun', en: 'Dice', ar: 'نرد' },
  { id: 'key', url: '/emoji/key.svg?v=twemoji-2', cat: 'fun', en: 'Key', ar: 'مفتاح' }
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
export function emojiUrl(id) { return BY_ID.get(id)?.url ?? '/emoji/star.svg?v=twemoji-2'; }
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

// Permanent SVG sticker library (65 UNIQUE pieces, public/sticker/ + source Sticker/).
// v13.2: stickers are real OpenMoji drawings (CC BY-SA 4.0, Sticker/README)
// — distinct from the Twemoji emojis. Sticker/stickers.json carries
// emojiId + source. IDs are stable, so old :sticker-XX: messages still
// render (with the new drawing).
export const CUSTOM_STICKERS = [];
const STICKER_FACES = ['ابتسامة', 'ضحك', 'عيون قلب', 'بارد', 'تفكير', 'حزن', 'غضب', 'احتفال', 'نوم', 'مذهول', 'همس', 'غمزة', 'مندهش'];
const STICKER_ANIMALS = ['مواء', 'وجه قطة', 'كلب', 'ثعلب', 'ضفدع', 'فضائي', 'شبح', 'روبوت', 'لا أرى شرًا', 'بكاء', 'دوخة', 'نجوم', 'قبلة'];
const STICKER_OBJECTS = ['قهوة', 'بيتزا', 'كرة', 'لعبة', 'صاروخ', 'كتاب', 'موسيقى', 'زهرة', 'برجر', 'كعكة', 'آيس كريم', 'هدية', 'بالون'];
const STICKER_EMBLEMS = ['تاج', 'جوهرة', 'كأس', 'قلب', 'نار', 'نجمة', 'بريق', 'قمر', 'شمس', 'قوس قزح', 'أرض', 'جمجمة', 'يقطين'];
const STICKER_NOTES = ['صح', 'خطأ', 'تلويح', 'تمام', 'إبهام أعلى', 'إبهام أسفل', 'دعاء', 'قوة', 'مئة', 'فكرة', 'مفتاح', 'سماعات', 'سيارة'];
const STICKER_EN_F = ['Smile', 'Laugh', 'Love eyes', 'Cool', 'Thinking', 'Sad', 'Angry', 'Party', 'Sleep', 'Mind blown', 'Hush', 'Wink', 'Surprised'];
const STICKER_EN_A = ['Meow', 'Cat face', 'Dog', 'Fox', 'Frog', 'Alien', 'Ghost', 'Robot', 'See no evil', 'Cry', 'Dizzy', 'Starstruck', 'Kiss'];
const STICKER_EN_O = ['Coffee', 'Pizza', 'Ball', 'Game', 'Rocket', 'Book', 'Music', 'Flower', 'Burger', 'Cake', 'Ice cream', 'Gift', 'Balloon'];
const STICKER_EN_E = ['Crown', 'Gem', 'Trophy', 'Heart', 'Fire', 'Star', 'Sparkles', 'Moon', 'Sun', 'Rainbow', 'Earth', 'Skull', 'Pumpkin'];
const STICKER_EN_N = ['Check', 'Cross', 'Wave', 'OK', 'Thumbs up', 'Thumbs down', 'Pray', 'Strong', 'Hundred', 'Idea', 'Key', 'Headphones', 'Car'];
{
  const groups = [
    ['faces', STICKER_FACES, STICKER_EN_F],
    ['animals', STICKER_ANIMALS, STICKER_EN_A],
    ['objects', STICKER_OBJECTS, STICKER_EN_O],
    ['emblems', STICKER_EMBLEMS, STICKER_EN_E],
    ['notes', STICKER_NOTES, STICKER_EN_N]
  ];
  let n = 0;
  for (const [cat, ars, ens] of groups) {
    for (let i = 0; i < 13; i += 1) {
      n += 1;
      const id = `sticker-${String(n).padStart(2, '0')}`;
      CUSTOM_STICKERS.push({ id, url: `/sticker/${id}.svg?v=stickers-v4`, cat, en: ens[i], ar: ars[i] });
    }
  }
}
export const STICKER_CATEGORIES = [
  { id: 'faces', en: 'Faces', ar: 'وجوه' },
  { id: 'animals', en: 'Animals', ar: 'حيوانات' },
  { id: 'objects', en: 'Objects', ar: 'أشياء' },
  { id: 'emblems', en: 'Emblems', ar: 'رموز' },
  { id: 'notes', en: 'Notes', ar: 'ملاحظات' }
];
const STICKER_BY_ID = new Map(CUSTOM_STICKERS.map((e) => [e.id, e]));
export function isCustomSticker(id) { return STICKER_BY_ID.has(id); }
export function stickerUrl(id) { return STICKER_BY_ID.get(id)?.url ?? '/sticker/sticker-01.svg?v=stickers-v4'; }
export function stickerLabel(id, lang = 'en') {
  const e = STICKER_BY_ID.get(id);
  if (!e) return `:${id}:`;
  return lang === 'ar' ? e.ar : e.en;
}
export function customStickerImage(id, className = 'custom-sticker') {
  const img = document.createElement('img');
  img.src = stickerUrl(id);
  img.alt = stickerLabel(id, typeof document !== 'undefined' && document.documentElement?.lang === 'ar' ? 'ar' : 'en');
  img.title = `:${id}:`;
  img.className = className;
  img.draggable = false;
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}
export function searchStickers(query, limit = 65) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return CUSTOM_STICKERS.slice(0, limit);
  return CUSTOM_STICKERS.filter((e) =>
    e.id.includes(q) || e.en.toLowerCase().includes(q) || String(e.ar ?? '').includes(q)
  ).slice(0, limit);
}

// GIF links: any direct https .gif renders inline. Giphy media URLs
// (media.giphy.com/…/giphy.gif) and Tenor media URLs are the common
// cases; any other https .gif works too. Validation is strict:
// https only, no credentials, no traversal, no HTML break-out.
export function isGifUrl(url) {
  const u = String(url ?? '').trim();
  if (!u || u.includes('<') || u.includes('>') || u.includes('"') || u.includes("'") || u.includes('\\')) return false;
  let parsed;
  try { parsed = new URL(u); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  const lower = u.toLowerCase();
  if (lower.includes('..')) return false;
  if (/\.gif(?:\?[^#]*)?(?:#.*)?$/i.test(parsed.pathname)) return true;
  // Giphy/Tenor media hosts sometimes serve renditions without a
  // .gif suffix in the path — accept their media hosts explicitly.
  // (Subdomain check, not a literal host list, on purpose.)
  const host = parsed.hostname.toLowerCase();
  return host.endsWith('.giphy.com') || host === 'giphy.com'
    || host.endsWith('.tenor.com') || host === 'tenor.com';
}
export function gifImage(url, className = 'message-gif') {
  const clean = String(url).trim();
  const img = document.createElement('img');
  img.src = clean;
  img.alt = 'GIF';
  img.title = 'GIF';
  img.className = className;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.draggable = false;
  // Broken-GIF fix (error/ folder): never leave a tiny broken icon.
  // On error, mark it, offer the original as a clickable fallback.
  let failed = false;
  img.addEventListener('error', () => {
    if (failed) return;
    failed = true;
    img.classList.add('gif-broken');
    img.alt = 'GIF — tap to open';
    img.title = 'GIF failed to load — click to open the original';
    img.style.cursor = 'pointer';
    img.addEventListener('click', (e) => {
      e.preventDefault();
      window.open(clean, '_blank', 'noopener,noreferrer');
    }, { once: true });
  }, { once: true });
  return img;
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
// Both :emoji: and :sticker-01: shortcodes become images.
export function splitEmojiShortcodes(text) {
  const parts = [];
  let last = 0;
  for (const match of String(text ?? '').matchAll(SHORTCODE_RE)) {
    const id = match[1];
    if (!BY_ID.has(id) && !STICKER_BY_ID.has(id)) continue;
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
    return Array.isArray(list) ? list.filter((id) => BY_ID.has(id) || STICKER_BY_ID.has(id)).slice(0, 12) : [];
  } catch { return []; }
}
export function pushRecentEmoji(id) {
  if (!BY_ID.has(id) && !STICKER_BY_ID.has(id)) return;
  try {
    const recent = [id, ...getRecentEmojis().filter((x) => x !== id)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch { /* ignore */ }
}
