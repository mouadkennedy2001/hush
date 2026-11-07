// Custom site emojis — hand-made SVGs in public/emoji/, ONLY for Hush.
// The whole site uses these (soundboard, chat shortcodes, reactions,
// floating reactions, landing demo) — no Unicode/global emojis.
// In chat, an emoji is written as a shortcode like :laugh: and rendered
// as an <img> by the message renderer.
export const CUSTOM_EMOJIS = [
  // Soundboard
  { id: 'airhorn', url: '/emoji/airhorn.svg' },
  { id: 'rimshot', url: '/emoji/rimshot.svg' },
  { id: 'applause', url: '/emoji/applause.svg' },
  { id: 'trombone', url: '/emoji/trombone.svg' },
  { id: 'boing', url: '/emoji/boing.svg' },
  { id: 'ding', url: '/emoji/ding.svg' },
  { id: 'pop', url: '/emoji/pop.svg' },
  { id: 'fart', url: '/emoji/fart.svg' },
  { id: 'cat', url: '/emoji/cat.svg' },
  { id: 'wow', url: '/emoji/wow.svg' },
  { id: 'crickets', url: '/emoji/crickets.svg' },
  { id: 'tada', url: '/emoji/tada.svg' },
  // Faces & feelings
  { id: 'smile', url: '/emoji/smile.svg' },
  { id: 'laugh', url: '/emoji/laugh.svg' },
  { id: 'love', url: '/emoji/love.svg' },
  { id: 'cool', url: '/emoji/cool.svg' },
  { id: 'think', url: '/emoji/think.svg' },
  { id: 'sad', url: '/emoji/sad.svg' },
  { id: 'angry', url: '/emoji/angry.svg' },
  { id: 'party', url: '/emoji/party.svg' },
  { id: 'sleep', url: '/emoji/sleep.svg' },
  { id: 'mindblown', url: '/emoji/mindblown.svg' },
  { id: 'hush', url: '/emoji/hush.svg' },
  { id: 'heart', url: '/emoji/heart.svg' },
  { id: 'fire', url: '/emoji/fire.svg' },
  { id: 'star', url: '/emoji/star.svg' },
  { id: 'sparkles', url: '/emoji/sparkles.svg' },
  { id: 'glowstar', url: '/emoji/glowstar.svg' },
  { id: 'eyes', url: '/emoji/eyes.svg' },
  // Hands & body
  { id: 'wave', url: '/emoji/wave.svg' },
  { id: 'ok', url: '/emoji/ok.svg' },
  { id: 'thumbsup', url: '/emoji/thumbsup.svg' },
  { id: 'thumbsdown', url: '/emoji/thumbsdown.svg' },
  { id: 'pray', url: '/emoji/pray.svg' },
  { id: 'strong', url: '/emoji/strong.svg' },
  // Objects & fun
  { id: 'hundred', url: '/emoji/hundred.svg' },
  { id: 'idea', url: '/emoji/idea.svg' },
  { id: 'book', url: '/emoji/book.svg' },
  { id: 'coffee', url: '/emoji/coffee.svg' },
  { id: 'pizza', url: '/emoji/pizza.svg' },
  { id: 'ball', url: '/emoji/ball.svg' },
  { id: 'game', url: '/emoji/game.svg' },
  { id: 'rocket', url: '/emoji/rocket.svg' },
  { id: 'check', url: '/emoji/check.svg' },
  { id: 'cross', url: '/emoji/cross.svg' }
];

const BY_ID = new Map(CUSTOM_EMOJIS.map((e) => [e.id, e]));
const SHORTCODE_RE = /:([a-z][a-z0-9_-]{1,30}):/g;

export function isCustomEmoji(id) { return BY_ID.has(id); }
export function emojiUrl(id) { return BY_ID.get(id)?.url ?? '/emoji/star.svg'; }
export function emojiShortcode(id) { return `:${id}:`; }
export function customEmojiImage(id, className = 'custom-emoji') {
  const img = document.createElement('img');
  img.src = emojiUrl(id);
  img.alt = `:${id}:`;
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
export function preloadCustomEmojis() {
  for (const emoji of CUSTOM_EMOJIS) {
    try { const img = new Image(); img.src = emoji.url; } catch { /* ignore */ }
  }
}
