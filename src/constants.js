export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_NAME_LENGTH = 32;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_ROOM_MESSAGES = 200;
export const MAX_PARTICIPANTS = 12;

// Optional room title / password (v15). Room names are capped tighter than
// chat names so tiles and headers stay readable. Passwords are 4..128 chars
// after trim; an empty password means the room stays open.
export const MAX_ROOM_NAME_LENGTH = 60;
export const MIN_ROOM_PASSWORD_LENGTH = 4;
export const MAX_ROOM_PASSWORD_LENGTH = 128;

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

// Soundboard v13: Sound Forge pack (new soundboard/sounds_out, copied to
// public/sounds/*.wav + manifest.json) — 87 studio WAV files in 9 categories.
// Played from /sounds/<id>.wav and relayed by the server so everyone in the
// room/server hears it. The server is the authority on which ids are valid.
// Legacy synth ids (airhorn, rimshot, …) are mapped client-side to the
// closest Forge sound so old clients keep playing something sensible.
export const SOUNDBOARD_IDS = [
  // ui
  'click', 'tap', 'hover', 'keypress', 'typing', 'switch', 'toggle_on',
  'toggle_off', 'select', 'pop', 'blip', 'bubble', 'swipe', 'drop',
  'delete', 'undo', 'beep', 'boop',
  // chat
  'message', 'send', 'receive', 'mention', 'reaction', 'sticker', 'hand',
  'knock', 'camera', 'share', 'pin',
  // notify
  'notification', 'notification_soft', 'ding', 'dingdong', 'chime', 'info',
  'sparkle', 'sonar', 'echo',
  // presence
  'join', 'leave', 'welcome', 'goodbye', 'connect', 'disconnect', 'mute',
  'unmute', 'deafen', 'undeafen', 'incoming_call', 'call_end',
  'screenshare_start', 'screenshare_stop', 'kick', 'ban',
  // status
  'success', 'error', 'warning', 'critical', 'download_complete', 'upload',
  'unlock', 'lock', 'alarm', 'countdown_beep', 'countdown_go', 'clock_tick',
  'clock_tock',
  // game
  'coin', 'powerup', 'heal', 'jump', 'laser', 'hit', 'explosion',
  'achievement', 'levelup', 'victory', 'game_over',
  // system + fx
  'power_on', 'power_off', 'slide', 'whoosh', 'whoosh_back',
  // drum
  'drum_kick', 'drum_snare', 'drum_hat', 'drum_clap'
];
export const SOUNDBOARD_SET = new Set(SOUNDBOARD_IDS);
// Back-compat: the v12 synth board (16 ids). Clients map these to Forge
// wavs; the server still accepts them so old clients never get rejected.
export const LEGACY_SOUNDBOARD_IDS = [
  'airhorn', 'rimshot', 'applause', 'trombone', 'boing', 'ding',
  'pop', 'fart', 'cat', 'wow', 'crickets', 'tada',
  'laser', 'siren', 'drumroll', 'yay'
];
export const LEGACY_SOUNDBOARD_SET = new Set(LEGACY_SOUNDBOARD_IDS);
export const SOUNDBOARD_MAX_PER_5S = 8;
// UI notification sounds (public/sounds/*.wav) — subset used by sounds.js.
export const UI_SOUND_IDS = [
  'message', 'mention', 'join', 'leave', 'error', 'kick', 'ban', 'success',
  'click', 'blip', 'hand', 'knock', 'camera', 'share', 'reaction', 'pop',
  'welcome', 'goodbye', 'coin', 'levelup', 'warning', 'achievement',
  'whoosh', 'chime', 'bubble', 'slide', 'dingdong', 'echo',
  'connect', 'disconnect', 'mute', 'unmute', 'deafen', 'undeafen',
  'screenshare_start', 'screenshare_stop', 'incoming_call', 'call_end',
  'notification', 'notification_soft', 'ding', 'info', 'sparkle', 'sonar',
  'send', 'receive', 'pin', 'critical', 'alarm', 'unlock', 'lock'
];

// Custom site emojis (public/emoji/*.svg) — the only emojis the
// soundboard / floating reactions show. Server validates ids.
export const CUSTOM_EMOJI_IDS = [
  'airhorn', 'rimshot', 'applause', 'trombone', 'boing', 'ding',
  'pop', 'fart', 'cat', 'wow', 'crickets', 'tada',
  'laser', 'siren', 'drumroll', 'yay',
  'hush', 'heart', 'fire', 'star',
  'smile', 'laugh', 'love', 'cool', 'think', 'sad', 'angry', 'party',
  'sleep', 'mindblown', 'pray', 'strong', 'hundred', 'sparkles',
  'glowstar', 'idea', 'book', 'coffee', 'pizza', 'ball', 'game',
  'rocket', 'check', 'cross', 'eyes', 'wave', 'ok',
  'thumbsup', 'thumbsdown',
  'wink', 'surprised', 'cry', 'kiss', 'dizzy', 'starstruck',
  'robot', 'ghost', 'alien', 'music', 'flower',
  'grinning', 'laughing', 'sweat_smile', 'rolling_laugh', 'slightly_smile',
  'upside_down', 'melting', 'zany', 'cowboy', 'nerd', 'smirk', 'pleading',
  'point_up', 'victory_hand', 'crossed_fingers', 'love_you', 'metal',
  'call_me', 'open_hands', 'handshake', 'clown', 'skull', 'pumpkin',
  'christmas_tree', 'gift', 'balloon', 'trophy', 'crown', 'gem', 'moon',
  'sun', 'rainbow', 'earth', 'car', 'airplane', 'house', 'cat2', 'dog',
  'fox', 'frog', 'see_no_evil', 'burger', 'cake', 'ice_cream',
  'headphones', 'guitar', 'dice', 'key'
];
export const CUSTOM_EMOJI_SET = new Set(CUSTOM_EMOJI_IDS);

// Custom room soundboard (uploaded audio, per room).
export const MAX_CUSTOM_SOUNDS_PER_ROOM = 12;
export const MAX_BOARD_AUDIO_BYTES = 2 * 1024 * 1024;
// Optional cover image for a custom sound (shown on its board button).
export const MAX_BOARD_IMAGE_BYTES = 512 * 1024;
export const BOARD_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
export const BOARD_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
// Server icon image (permanent servers).
export const MAX_SERVER_ICON_BYTES = 2 * 1024 * 1024;
export const SERVER_ICON_EXTENSIONS = BOARD_IMAGE_EXTENSIONS;
export const SERVER_ICON_MIME_TYPES = BOARD_IMAGE_MIME_TYPES;
// Permanent custom sounds for servers (kept until deleted with the server).
export const MAX_CUSTOM_SOUNDS_PER_SERVER = 24;
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
