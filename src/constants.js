export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_NAME_LENGTH = 32;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_ROOM_MESSAGES = 200;
export const MAX_PARTICIPANTS = 12;

// Keep the reaction set small so the UI stays quiet and the server can
// validate anything a client sends without a huge allow-list.
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀', '🙌', '🔥', '✅'];

export const UPLOAD_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
  '.pdf', '.txt', '.md', '.csv', '.zip'
]);

export const UPLOAD_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
  'application/zip', 'application/x-zip-compressed'
]);
