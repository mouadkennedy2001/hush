export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_NAME_LENGTH = 32;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_ROOM_MESSAGES = 200;
export const MAX_PARTICIPANTS = 12;

// Anti-spam / anti-abuse
export const MAX_MESSAGES_PER_10S = 8;
export const MIN_MESSAGE_INTERVAL_MS = 700;
export const SPAM_MUTE_MS = 30_000;
export const MAX_SOCKETS_PER_IP = 20;
export const MAX_PARTICIPANTS_PER_IP_PER_ROOM = 12;
export const MAX_JOINS_PER_IP_PER_MIN = 60;
export const MAX_DEVICE_ID_LENGTH = 64;
export const BAN_DEFAULT_MINUTES = 60;

// Reactions are custom Hush emoji ids (public/emoji/*.svg) — the site
// uses ONLY its own emojis, never Unicode/global ones.
export const REACTION_EMOJIS = ['thumbsup', 'heart', 'laugh', 'tada', 'eyes', 'applause', 'fire', 'check'];

// Soundboard: synthesized client-side, relayed by the server so everyone in
// the room hears it. The server is the authority on which ids are valid.
export const SOUNDBOARD_IDS = [
  'airhorn', 'rimshot', 'applause', 'trombone', 'boing', 'ding',
  'pop', 'fart', 'cat', 'wow', 'crickets', 'tada'
];
export const SOUNDBOARD_SET = new Set(SOUNDBOARD_IDS);
export const SOUNDBOARD_MAX_PER_5S = 8;

// Custom site emojis (public/emoji/*.svg) — the only emojis the
// soundboard / floating reactions show. Server validates ids.
export const CUSTOM_EMOJI_IDS = [
  'airhorn', 'rimshot', 'applause', 'trombone', 'boing', 'ding',
  'pop', 'fart', 'cat', 'wow', 'crickets', 'tada',
  'hush', 'heart', 'fire', 'star',
  'smile', 'laugh', 'love', 'cool', 'think', 'sad', 'angry', 'party',
  'sleep', 'mindblown', 'pray', 'strong', 'hundred', 'sparkles',
  'glowstar', 'idea', 'book', 'coffee', 'pizza', 'ball', 'game',
  'rocket', 'check', 'cross', 'eyes', 'wave', 'ok',
  'thumbsup', 'thumbsdown'
];
export const CUSTOM_EMOJI_SET = new Set(CUSTOM_EMOJI_IDS);

// Custom room soundboard (uploaded audio, per room).
export const MAX_CUSTOM_SOUNDS_PER_ROOM = 12;
export const MAX_BOARD_AUDIO_BYTES = 2 * 1024 * 1024;
export const BOARD_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.webm', '.opus']);
export const BOARD_AUDIO_MIME_TYPES = new Set([
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/opus',
  'audio/mp4', 'audio/x-m4a', 'audio/webm', 'video/webm'
]);

export const UPLOAD_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
  '.pdf', '.txt', '.md', '.csv', '.zip'
]);

export const UPLOAD_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
  'application/zip', 'application/x-zip-compressed'
]);
