// Server page — a system SEPARATE from standalone rooms.
// Own chat (server:chat:*), own voice channels (MediaMesh + server webrtc
// relay), permanent server + saved channel history, invite link to join.

import { MediaMesh } from './room/media.js';
import { initI18n, onLanguageChange, t, locale } from './i18n.js';
import { initTheme } from './theme.js';
import { startPing } from './ping.js';
import { SOUNDBOARD_SOUNDS, playSoundboard, getSoundboardVolume, setSoundboardVolume, isSoundboardId, soundboardEmojiId } from './soundboard.js';
import { CUSTOM_EMOJIS, customEmojiImage, isCustomEmoji, splitEmojiShortcodes, preloadCustomEmojis } from './emoji.js';
import { playSound, getSoundsEnabled, setSoundsEnabled } from './sounds.js';
import { getDeviceId, serverIconUrl } from './servers.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const els = {
  gate: $('#join-gate'), joinForm: $('#join-form'), joinBtn: $('#join-btn'), joinError: $('#join-error'),
  nameInput: $('#name-input'), gateServer: $('#gate-server'),
  serverIcon: $('#server-icon'), serverName: $('#server-name'), serverCount: $('#server-count'),
  inviteBtn: $('#invite-btn'), inviteCopy: $('#invite-copy'), inviteCode: $('#invite-code'), regenInvite: $('#regen-invite'),
  leaveServerBtn: $('#leave-server-btn'), deleteServerBtn: $('#delete-server-btn'), dangerZone: $('#danger-zone'),
  textChannels: $('#text-channels'), voiceChannels: $('#voice-channels'),
  textKicker: $('#text-kicker'), voiceKicker: $('#voice-kicker'),
  addChannelForm: $('#add-channel-form'), newChannelName: $('#new-channel-name'), newChannelType: $('#new-channel-type'),
  stage: $('#server-stage'), channelTitle: $('#channel-title'), channelTopic: $('#channel-topic'),
  messages: $('#messages'), typing: $('#typing'), composer: $('#composer'), messageInput: $('#message-input'),
  composerHint: $('#composer-hint'), emojiBtn: $('#emoji-btn'), emojiMenu: $('#emoji-menu'),
  attachBtn: $('#attach-btn'), fileInput: $('#file-input'),
  soundboardBtn: $('#soundboard-btn'), soundboardPanel: $('#soundboard-panel'), soundboardTitle: $('#soundboard-title'),
  soundboardGrid: $('#soundboard-grid'), soundboardVolume: $('#soundboard-volume'), soundboardClose: $('#soundboard-close'),
  voiceStage: $('#voice-stage'), tileGrid: $('#tile-grid'),
  micBtn: $('#mic-btn'), micLabel: $('#mic-label'), cameraBtn: $('#camera-btn'), cameraLabel: $('#camera-label'), leaveVoiceBtn: $('#leave-voice-btn'),
  membersList: $('#members-list'), membersKicker: $('#members-kicker'),
  imageLightbox: $('#image-lightbox'), imageLightboxBackdrop: $('#image-lightbox-backdrop'),
  imageLightboxImg: $('#image-lightbox-img'), imageLightboxCaption: $('#image-lightbox-caption'),
  imageLightboxDownload: $('#image-lightbox-download'), imageLightboxClose: $('#image-lightbox-close'),
  toasts: $('#toasts'), remoteAudio: $('#remote-audio')
};

const state = {
  serverId: parseServerId(),
  inviteCode: new URLSearchParams(window.location.search).get('invite') || '',
  socket: null, mesh: null, selfId: null, selfName: '',
  server: null, channelId: null, messages: [],
  online: new Map(), speaking: new Set(),
  deviceId: getDeviceId(), inVoice: false, typingTimer: null,
  joined: false
};

initI18n();
initTheme();
startPing({ socketGetter: () => state.socket });
onLanguageChange(handleLanguageChange);
init();

function parseServerId() {
  const match = window.location.pathname.match(/^\/s\/([^/?#]+)\/?$/i);
  return match ? match[1] : '';
}

function init() {
  loadName();
  bindEvents();
  renderSoundboardGrid();
  buildEmojiMenu();
  preloadCustomEmojis();
}

function loadName() {
  try {
    const saved = localStorage.getItem('hush:name');
    if (saved) els.nameInput.value = saved;
  } catch { /* ignore */ }
}

function bindEvents() {
  els.joinForm.addEventListener('submit', join);
  els.inviteBtn?.addEventListener('click', copyInvite);
  els.inviteCopy?.addEventListener('click', copyInvite);
  els.regenInvite?.addEventListener('click', regenerateInvite);
  els.leaveServerBtn?.addEventListener('click', leaveServer);
  els.deleteServerBtn?.addEventListener('click', deleteServer);
  els.addChannelForm?.addEventListener('submit', (e) => { e.preventDefault(); addChannel(); });
  els.composer.addEventListener('submit', (e) => { e.preventDefault(); sendFromComposer(); });
  els.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendFromComposer(); }
  });
  els.messageInput.addEventListener('input', handleDraftInput);
  els.emojiBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleEmojiMenu(); });
  els.attachBtn?.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    els.fileInput.value = '';
    if (file) uploadFile(file);
  });
  document.addEventListener('paste', handlePasteImage);
  els.messages?.addEventListener('click', handleMessagesClick);
  els.imageLightboxClose?.addEventListener('click', closeImageLightbox);
  els.imageLightboxBackdrop?.addEventListener('click', closeImageLightbox);
  els.soundboardBtn?.addEventListener('click', () => toggleSoundboard());
  els.soundboardClose?.addEventListener('click', () => toggleSoundboard(false));
  els.soundboardVolume?.addEventListener('input', () => setSoundboardVolume(Number(els.soundboardVolume.value) / 100));
  els.micBtn?.addEventListener('click', toggleMic);
  els.cameraBtn?.addEventListener('click', toggleCamera);
  els.leaveVoiceBtn?.addEventListener('click', leaveVoice);
  document.addEventListener('click', (e) => {
    if (els.emojiMenu && !els.emojiMenu.hidden && !els.emojiMenu.contains(e.target) && e.target !== els.emojiBtn) closeEmojiMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeImageLightbox(); closeEmojiMenu(); toggleSoundboard(false); }
  });
  window.addEventListener('pagehide', () => { state.mesh?.dispose(); state.socket?.disconnect(); });
}

/* ---------------- Join ---------------- */

async function join(event) {
  event.preventDefault();
  const name = els.nameInput.value.trim();
  if (!name) { showError('error.nameRequired'); return; }
  try { localStorage.setItem('hush:name', name); } catch { /* ignore */ }
  setBusy(true);
  showError(null);
  try {
    ensureSocket();
    await waitForConnection(state.socket);
    const response = await emitAck('server:join', {
      serverId: state.serverId, name, deviceId: state.deviceId, inviteCode: state.inviteCode
    });
    if (!response?.ok) throw new Error(response?.error === 'invite-required' ? 'server.inviteRequired' : 'error.joinFailed');
    state.selfName = response.self.name;
    state.selfId = response.self.id;
    state.server = response.server;
    state.channelId = response.channelId;
    state.joined = true;
    els.gate.hidden = true;
    document.title = `${state.server.name} — Hush`;
    applyServerUi();
    await loadChannel(state.channelId, response.messages || []);
    playSound('join');
    setTimeout(() => els.messageInput.focus(), 200);
  } catch (error) {
    showError(typeof error?.message === 'string' && error.message.startsWith('error.') ? error.message
      : typeof error?.message === 'string' && error.message.startsWith('server.') ? error.message : 'error.joinFailed');
  } finally { setBusy(false); }
}

function ensureSocket() {
  if (state.socket) return state.socket;
  if (typeof window.io !== 'function') throw new Error('error.realtimeClient');
  const socket = window.io({ reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 4000, timeout: 8000, transports: ['websocket', 'polling'], upgrade: true });
  state.socket = socket;
  state.mesh = new MediaMesh({
    socket, audioContainer: els.remoteAudio,
    translate: (key) => t(key),
    onChange: handleMeshChange,
    onSpeaking: handleSpeaking,
    onError: (msg) => toast(msg, 'error', 4800)
  });
  bindSocketEvents(socket);
  socket.on('disconnect', () => {
    if (!state.joined) return;
    state.mesh?.closeAll();
    toast(t('toast.reconnected'), 'info', 2600);
    rejoin();
  });
  return socket;
}

function waitForConnection(socket) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('error.serverUnreachable')); }, 12000);
    const cleanup = () => { clearTimeout(timer); socket.off('connect', onConnect); socket.off('connect_error', onError); };
    const onConnect = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('error.serverConnect')); };
    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
  });
}

async function rejoin() {
  if (!state.socket?.connected) return;
  try {
    const response = await emitAck('server:join', {
      serverId: state.serverId, name: state.selfName, deviceId: state.deviceId, inviteCode: state.inviteCode
    });
    if (response?.ok) {
      state.server = response.server;
      applyServerUi();
      await loadChannel(state.channelId, response.messages || []);
    }
  } catch { /* next reconnect retries */ }
}

/* ---------------- Server UI ---------------- */

function applyServerUi() {
  const server = state.server;
  if (!server) return;
  if (els.serverName) els.serverName.textContent = server.name;
  if (els.gateServer) els.gateServer.textContent = server.name;
  if (els.serverCount) els.serverCount.textContent = t('server.members', { count: server.memberCount ?? 1 });
  if (els.inviteCode) els.inviteCode.textContent = server.inviteCode || '—';
  if (els.serverIcon) {
    els.serverIcon.replaceChildren();
    const img = document.createElement('img');
    img.src = serverIconUrl(server);
    img.alt = server.iconEmojiId ? `:${server.iconEmojiId}:` : '';
    img.className = 'custom-emoji';
    els.serverIcon.append(img);
  }
  if (els.textKicker) els.textKicker.textContent = t('server.textChannels');
  if (els.voiceKicker) els.voiceKicker.textContent = t('server.voiceChannels');
  if (els.membersKicker) els.membersKicker.textContent = t('server.membersTitle');
  const isOwner = server.ownerDeviceId === state.deviceId;
  if (els.regenInvite) els.regenInvite.hidden = !isOwner;
  if (els.dangerZone) els.dangerZone.hidden = !isOwner;
  renderChannels();
  renderMembers();
}

function renderChannels() {
  const server = state.server;
  if (!server) return;
  const fill = (ul, type) => {
    ul.replaceChildren();
    for (const ch of server.channels.filter((c) => c.type === type)) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = '#';
      link.className = 'server-channel' + (ch.id === state.channelId ? ' is-current' : '');
      link.dataset.channelId = ch.id;
      const glyph = document.createElement('span');
      glyph.className = 'server-channel-glyph';
      glyph.append(icon(ch.type === 'voice' ? 'i-volume2' : 'i-hash'));
      const label = document.createElement('span');
      label.className = 'server-channel-label';
      label.textContent = ch.name;
      link.append(glyph, label);
      if (server.ownerDeviceId === state.deviceId && server.channels.length > 1) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'server-channel-del';
        del.title = t('server.deleteChannel');
        del.setAttribute('aria-label', t('server.deleteChannel'));
        del.append(icon('i-trash'));
        del.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); deleteChannel(ch.id); });
        link.append(del);
      }
      link.addEventListener('click', (e) => { e.preventDefault(); selectChannel(ch); });
      li.append(link);
      ul.append(li);
    }
  };
  fill(els.textChannels, 'text');
  fill(els.voiceChannels, 'voice');
}

async function selectChannel(channel) {
  if (channel.type === 'voice') { joinVoice(channel); return; }
  if (channel.id === state.channelId) return;
  state.channelId = channel.id;
  renderChannels();
  await loadChannel(channel.id);
}

async function loadChannel(channelId, initialMessages) {
  if (!channelId) return;
  let messages = initialMessages;
  if (!Array.isArray(messages)) {
    const response = await emitAck('server:history', { channelId });
    messages = response?.ok ? response.messages || [] : [];
  }
  state.messages = messages;
  const channel = state.server?.channels.find((c) => c.id === channelId);
  if (els.channelTitle) els.channelTitle.textContent = channel ? `# ${channel.name}` : '';
  if (els.channelTopic) els.channelTopic.textContent = t('server.permanent');
  renderMessages();
}

async function addChannel() {
  const name = els.newChannelName?.value.trim();
  const type = els.newChannelType?.value || 'text';
  if (!name) { els.newChannelName?.focus(); return; }
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/channels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, deviceId: state.deviceId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('channel-failed');
    state.server = data.server || state.server;
    els.newChannelName.value = '';
    toast(t('server.channelCreated'), 'info', 2400);
    applyServerUi();
  } catch { toast(t('server.channelFailed'), 'error', 3600); }
}

async function deleteChannel(channelId) {
  if (!window.confirm(t('server.deleteChannelConfirm'))) return;
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/channels/${encodeURIComponent(channelId)}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: state.deviceId })
    });
    if (!res.ok) throw new Error('delete-failed');
    state.server.channels = state.server.channels.filter((c) => c.id !== channelId);
    if (state.channelId === channelId) {
      const first = state.server.channels.find((c) => c.type === 'text');
      if (first) { state.channelId = first.id; await loadChannel(first.id); }
    }
    applyServerUi();
  } catch { toast(t('error.generic'), 'error', 3600); }
}

function inviteUrl() {
  return `${window.location.origin}/s/${state.serverId}?invite=${state.server?.inviteCode || ''}`;
}

async function copyInvite() {
  if (!state.server) return;
  try { await navigator.clipboard.writeText(inviteUrl()); toast(t('toast.inviteCopied'), 'info', 2400); }
  catch { toast(t('toast.copyFailed'), 'error', 3600); }
}

async function regenerateInvite() {
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/regenerate-invite`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: state.deviceId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('regen-failed');
    state.server = data.server;
    applyServerUi();
  } catch { toast(t('error.generic'), 'error', 3600); }
}

async function leaveServer() {
  const isOwner = state.server?.ownerDeviceId === state.deviceId;
  if (!window.confirm(t(isOwner ? 'server.leaveOwnerConfirm' : 'server.leaveConfirm'))) return;
  if (isOwner) {
    if (!window.confirm(t('server.deleteConfirm'))) return;
    try {
      await fetch(`/api/servers/${encodeURIComponent(state.serverId)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: state.deviceId })
      });
    } catch { /* ignore */ }
  } else {
    try {
      await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/leave`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: state.deviceId })
      });
    } catch { /* ignore */ }
  }
  state.socket?.emit('server:leave');
  state.mesh?.dispose();
  state.socket?.disconnect();
  window.location.href = '/#servers';
}

async function deleteServer() { leaveServer(); }

/* ---------------- Chat ---------------- */

function renderMessages() {
  els.messages.replaceChildren();
  for (const message of state.messages) els.messages.append(createMessageNode(message));
  scrollLatest('auto');
}

function createMessageNode(message) {
  const isSelf = message.authorId === state.selfId;
  const article = el('article', 'message');
  article.dataset.messageId = message.id;
  article.classList.toggle('is-self', isSelf);
  const avatar = el('span', `message-avatar tone-${toneFor(message.authorId || message.id)}`, initials(message.authorName));
  const body = el('div', 'message-body');
  body.append(el('div', 'message-head'));
  const head = body.firstChild;
  head.append(el('span', 'message-author', message.authorName || t('chat.guest')), el('time', 'message-time', formatTime(message.createdAt)));
  const bubble = el('div', 'message-bubble');
  if (message.text) {
    const p = el('p', 'message-text');
    renderMessageText(p, message.text);
    bubble.append(p);
  }
  const att = renderAttachment(message.attachment);
  if (att) bubble.append(att);
  body.append(bubble);
  const meta = el('div', 'message-meta');
  if (message.editedAt) meta.append(el('span', 'message-edited', t('chat.edited')));
  if (isSelf) {
    const edit = el('button', 'message-copy'); edit.type = 'button'; edit.title = t('chat.edit'); edit.append(icon('i-pencil'));
    edit.addEventListener('click', () => editMessage(message.id));
    const del = el('button', 'message-copy'); del.type = 'button'; del.title = t('chat.delete'); del.append(icon('i-trash'));
    del.addEventListener('click', () => deleteMessage(message.id));
    meta.append(edit, del);
  }
  body.append(meta);
  article.append(avatar, body);
  return article;
}

function renderMessageText(container, text) {
  const value = String(text ?? '');
  for (const part of splitEmojiShortcodes(value)) {
    if (part.emoji) { container.append(customEmojiImage(part.emoji, 'custom-emoji message-emoji')); continue; }
    container.append(document.createTextNode(part.text ?? ''));
  }
}

function safeAttachmentUrl(url) {
  return typeof url === 'string' && url.startsWith('/uploads/server-') && !url.includes('..') ? url : null;
}

function renderAttachment(attachment) {
  const url = safeAttachmentUrl(attachment?.url);
  if (!url) return null;
  const name = String(attachment.name || t('upload.file'));
  const mime = String(attachment.mime || '');
  if (mime.startsWith('image/')) {
    const wrap = el('span', 'message-attachment');
    const button = el('button', 'message-image');
    button.type = 'button';
    button.dataset.imageUrl = url;
    button.dataset.imageName = name;
    button.title = t('chat.imageViewerClose');
    const img = document.createElement('img');
    img.src = url; img.alt = name; img.loading = 'lazy'; img.decoding = 'async';
    button.append(img);
    wrap.append(button);
    return wrap;
  }
  const wrap = el('div', 'message-attachment');
  const card = el('a', 'file-card');
  card.href = url; card.download = name;
  card.append(icon('i-file'), el('span', 'file-card-text'));
  const text = card.lastChild;
  text.append(el('span', 'file-card-name', name), el('span', 'file-card-size', formatBytes(attachment.size) || t('upload.download')));
  wrap.append(card);
  return wrap;
}

function handleMessagesClick(event) {
  const imageButton = event.target.closest('.message-image');
  if (imageButton?.dataset.imageUrl) {
    event.preventDefault();
    openImageLightbox(imageButton.dataset.imageUrl, imageButton.dataset.imageName || '');
  }
}

async function sendFromComposer() {
  const text = els.messageInput.value.replace(/\s+$/g, '');
  if (!text.trim()) { els.messageInput.focus(); return; }
  els.messageInput.value = '';
  autosize();
  stopTyping();
  const response = await emitAck('server:chat:send', { channelId: state.channelId, text: text.slice(0, 2000) });
  if (!response?.ok) {
    toast(t(response?.error === 'spam' ? 'error.spam' : 'error.sendFailed'), 'error', 4200);
    els.messageInput.value = text;
    autosize();
  }
  els.messageInput.focus();
}

async function editMessage(messageId) {
  const message = state.messages.find((m) => m.id === messageId);
  if (!message) return;
  const node = [...els.messages.querySelectorAll('.message')].find((n) => n.dataset.messageId === messageId);
  const bubble = node && $('.message-bubble', node);
  if (!bubble) return;
  const textarea = el('textarea', 'message-edit-input');
  textarea.value = message.text || '';
  const row = el('div', 'message-edit-row');
  const save = el('button', 'btn btn-primary btn-sm', t('chat.save')); save.type = 'button';
  const cancel = el('button', 'btn btn-quiet btn-sm', t('chat.cancel')); cancel.type = 'button';
  row.append(save, cancel);
  bubble.replaceChildren(textarea, row);
  textarea.focus();
  const finish = () => { node.replaceWith(createMessageNode(message)); };
  cancel.addEventListener('click', finish);
  save.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) return;
    const response = await emitAck('server:chat:edit', { channelId: state.channelId, messageId, text });
    if (!response?.ok) { toast(t('chat.editFailed'), 'error', 3600); finish(); return; }
    message.text = text;
    message.editedAt = Date.now();
    finish();
  });
}

async function deleteMessage(messageId) {
  if (!window.confirm(t('chat.deleteConfirm'))) return;
  const response = await emitAck('server:chat:delete', { channelId: state.channelId, messageId });
  if (!response?.ok) { toast(t('chat.deleteFailed'), 'error', 3600); return; }
  state.messages = state.messages.filter((m) => m.id !== messageId);
  [...els.messages.querySelectorAll('.message')].find((n) => n.dataset.messageId === messageId)?.remove();
}

/* ---------------- Paste + upload ---------------- */

function handlePasteImage(event) {
  const files = event.clipboardData?.files ? [...event.clipboardData.files] : [];
  const items = event.clipboardData?.items ? [...event.clipboardData.items] : [];
  let file = files.find((f) => f.type.startsWith('image/')) || null;
  if (!file) file = items.find((i) => i.type.startsWith('image/'))?.getAsFile?.() || null;
  if (!file) return;
  event.preventDefault();
  if (!state.joined) return;
  const named = file.name && /\.(png|jpe?g|gif|webp|avif)$/i.test(file.name) ? file : new File([file], `pasted-${Date.now()}.png`, { type: file.type || 'image/png' });
  showHint(t('chat.pasteImage'));
  uploadFile(named);
}

async function uploadFile(file) {
  if (!file || !state.joined) return;
  const ext = `.${String(file.name).split('.').pop() || ''}`.toLowerCase();
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.pdf', '.txt', '.md', '.csv', '.zip']);
  if (!allowed.has(ext)) { toast(t('upload.unsupported'), 'error', 4200); return; }
  if (file.size > 8 * 1024 * 1024) { toast(t('upload.tooLarge'), 'error', 4200); return; }
  showHint(t('upload.uploading', { name: file.name }));
  try {
    const body = new FormData();
    body.append('file', file);
    body.append('channelId', state.channelId);
    const res = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/upload`, { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('upload-failed');
    const response = await emitAck('server:chat:send', { channelId: state.channelId, text: '', attachment: data });
    if (!response?.ok) throw new Error('send-failed');
  } catch { toast(t('upload.failed'), 'error', 4800); }
  finally { showHint(''); }
}

/* ---------------- Lightbox ---------------- */

function openImageLightbox(url, name) {
  const safe = safeAttachmentUrl(url);
  if (!safe || !els.imageLightbox) return;
  els.imageLightboxImg.src = safe;
  els.imageLightboxImg.alt = name || '';
  els.imageLightboxCaption.textContent = name || '';
  els.imageLightboxDownload.href = safe;
  els.imageLightboxDownload.download = name || '';
  els.imageLightbox.hidden = false;
  els.imageLightboxClose?.focus();
}
function closeImageLightbox() {
  if (!els.imageLightbox || els.imageLightbox.hidden) return;
  els.imageLightbox.hidden = true;
  els.imageLightboxImg.src = '';
}

/* ---------------- Emoji + typing ---------------- */

function buildEmojiMenu() {
  els.emojiMenu.replaceChildren();
  for (const emoji of CUSTOM_EMOJIS) {
    const button = el('button', 'emoji-choice');
    button.type = 'button';
    button.dataset.emoji = emoji.id;
    button.title = `:${emoji.id}:`;
    button.setAttribute('aria-label', `:${emoji.id}:`);
    button.append(customEmojiImage(emoji.id, 'custom-emoji custom-emoji-sm'));
    button.addEventListener('click', () => { insertEmoji(`:${emoji.id}:`); closeEmojiMenu(); });
    els.emojiMenu.append(button);
  }
}
function toggleEmojiMenu() {
  const open = els.emojiMenu.hidden;
  els.emojiMenu.hidden = !open;
  els.emojiBtn?.setAttribute('aria-expanded', String(open));
}
function closeEmojiMenu() { els.emojiMenu.hidden = true; els.emojiBtn?.setAttribute('aria-expanded', 'false'); }
function insertEmoji(shortcode) {
  const input = els.messageInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${shortcode}${input.value.slice(end)}`;
  const next = start + shortcode.length;
  input.focus();
  input.setSelectionRange(next, next);
  handleDraftInput();
}
function handleDraftInput() {
  autosize();
  const hasText = els.messageInput.value.trim().length > 0;
  if (!state.socket?.connected || !state.joined) return;
  if (hasText) {
    state.socket.emit('server:typing', { typing: true });
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(stopTyping, 2600);
  } else stopTyping();
}
function stopTyping() { clearTimeout(state.typingTimer); state.socket?.emit('server:typing', { typing: false }); }
function autosize() {
  els.messageInput.style.height = 'auto';
  els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 120)}px`;
}
function renderTyping(names) {
  els.typing.replaceChildren();
  if (!names.length) return;
  const text = names.length === 1 ? t('chat.typingOne', { name: names[0] }) : t('chat.typingMany', { count: names.length });
  els.typing.append(el('span', 'typing-dots', text));
}

/* ---------------- Voice (WebRTC via server relay) ---------------- */

async function joinVoice(channel) {
  const response = await emitAck('server:voice:join', { channelId: channel.id });
  if (!response?.ok) { toast(t('error.joinFailed'), 'error', 3600); return; }
  state.inVoice = true;
  els.voiceStage.hidden = false;
  els.stage.classList.add('is-voice');
  if (els.channelTitle) els.channelTitle.textContent = channel.name;
  state.mesh.resumeAudio();
  const result = await state.mesh.init({ mic: false, camera: false });
  if (result?.warning) toast(result.warning, 'error', 4800);
  updateVoiceControls();
  renderTiles();
}
function leaveVoice() {
  if (!state.inVoice) return;
  state.inVoice = false;
  state.mesh?.closeAll();
  state.mesh?.disableMic();
  state.mesh?.disableCamera();
  emitAck('server:voice:join', { channelId: '' }).catch(() => {});
  state.socket?.leave?.();
  els.voiceStage.hidden = true;
  els.stage.classList.remove('is-voice');
  const text = state.server?.channels.find((c) => c.type === 'text');
  if (text) selectChannel(text);
}
async function toggleMic() {
  if (state.mesh.isOn('audio')) state.mesh.disableMic();
  else await state.mesh.enableMic();
  updateVoiceControls();
  updatePresence();
}
async function toggleCamera() {
  if (state.mesh.isOn('camera')) state.mesh.disableCamera();
  else await state.mesh.enableCamera();
  updateVoiceControls();
  updatePresence();
  renderTiles();
}
function updateVoiceControls() {
  const mic = state.mesh?.isOn('audio') ?? false;
  const cam = state.mesh?.isOn('camera') ?? false;
  els.micBtn.setAttribute('aria-pressed', String(mic));
  els.cameraBtn.setAttribute('aria-pressed', String(cam));
  els.micLabel.textContent = mic ? t('control.mute') : t('control.unmute');
  els.cameraLabel.textContent = cam ? t('control.stopVideo') : t('control.camera');
}
function updatePresence() {
  state.socket?.emit('server:presence', { micOn: state.mesh?.isOn('audio') ?? false, cameraOn: state.mesh?.isOn('camera') ?? false });
}

function handleMeshChange(peerId) {
  if (peerId === null) { updateVoiceControls(); return; }
  renderTiles();
}
function handleSpeaking(id, speaking) {
  const pid = id === 'self' ? state.selfId : id;
  if (speaking) state.speaking.add(pid); else state.speaking.delete(pid);
  for (const node of $$('.tile')) node.classList.toggle('is-speaking', speaking && node.dataset.participant === pid);
}

function renderTiles() {
  if (!els.tileGrid) return;
  const ids = [state.selfId, ...[...state.online.keys()].filter((id) => id !== state.selfId)];
  els.tileGrid.replaceChildren();
  for (const id of ids) {
    const person = id === state.selfId ? { id, name: state.selfName } : state.online.get(id);
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.participant = id;
    tile.classList.toggle('is-speaking', state.speaking.has(id));
    const video = document.createElement('video');
    video.className = 'tile-video';
    video.autoplay = true; video.playsInline = true; video.muted = true;
    const stream = id === state.selfId ? state.mesh?.getLocalStream('camera') : state.mesh?.getRemoteStream(id, 'camera');
    const hasVideo = Boolean(stream?.getVideoTracks?.().some((tr) => tr.readyState !== 'ended'));
    tile.classList.toggle('has-video', hasVideo);
    if (hasVideo) { video.srcObject = stream; video.play?.().catch(() => {}); }
    const avatar = document.createElement('div');
    avatar.className = 'tile-avatar';
    avatar.append(el('span', '', initials(person?.name || '?')));
    const foot = document.createElement('div');
    foot.className = 'tile-foot';
    foot.append(el('span', 'tile-name', person?.name || ''));
    tile.append(video, avatar, foot);
    els.tileGrid.append(tile);
  }
}

function renderMembers() {
  if (!els.membersList) return;
  els.membersList.replaceChildren();
  const all = new Map();
  for (const m of state.server?.members || []) all.set(m.deviceId, { id: m.deviceId, name: m.name, persistent: true });
  const isOwner = (id) => state.server?.ownerDeviceId === id;
  const sorted = [...all.values()].sort((a, b) => (isOwner(b.id) ? 1 : 0) - (isOwner(a.id) ? 1 : 0) || a.name.localeCompare(b.name, locale()));
  for (const member of sorted) {
    const li = document.createElement('li');
    li.className = 'person';
    const avatar = document.createElement('span');
    avatar.className = `person-avatar tone-${toneFor(member.id)}`;
    avatar.textContent = initials(member.name);
    const body = document.createElement('span');
    body.className = 'person-body';
    const nameRow = document.createElement('span');
    nameRow.className = 'person-name';
    nameRow.append(document.createTextNode(member.name));
    if (isOwner(member.id)) {
      const host = document.createElement('span');
      host.className = 'host-badge';
      host.textContent = t('admin.isHost');
      nameRow.append(host);
    }
    body.append(nameRow);
    li.append(avatar, body);
    els.membersList.append(li);
  }
}

/* ---------------- Socket events ---------------- */

function bindSocketEvents(socket) {
  socket.on('server:chat:message', (message) => {
    if (!message?.id || message.channelId !== state.channelId) return;
    state.messages.push(message);
    els.messages.append(createMessageNode(message));
    scrollLatest('smooth');
    if (getSoundsEnabled() && message.authorId !== state.selfId) playSound('message');
  });
  socket.on('server:chat:edited', ({ messageId, text, editedAt } = {}) => {
    const message = state.messages.find((m) => m.id === messageId);
    if (!message) return;
    message.text = text; message.editedAt = editedAt;
    const node = [...els.messages.querySelectorAll('.message')].find((n) => n.dataset.messageId === messageId);
    node?.replaceWith(createMessageNode(message));
  });
  socket.on('server:chat:deleted', ({ messageId } = {}) => {
    state.messages = state.messages.filter((m) => m.id !== messageId);
    [...els.messages.querySelectorAll('.message')].find((n) => n.dataset.messageId === messageId)?.remove();
  });
  socket.on('server:channels:updated', ({ server } = {}) => {
    if (!server) return;
    state.server = server;
    applyServerUi();
  });
  socket.on('server:peer:joined', ({ participant } = {}) => {
    if (!participant?.id) return;
    state.online.set(participant.id, participant);
    renderTiles();
  });
  socket.on('server:peer:left', ({ id } = {}) => {
    if (!id) return;
    state.online.delete(id);
    state.mesh?.closePeer(id);
    renderTiles();
  });
  socket.on('server:peer:updated', ({ id, name, micOn } = {}) => {
    const existing = state.online.get(id) || { id, name };
    existing.micOn = micOn; existing.name = name || existing.name;
    state.online.set(id, existing);
    renderTiles();
  });
  socket.on('server:voice:connect', ({ id } = {}) => {
    if (id && state.inVoice && id !== state.selfId) state.mesh?.connectToPeer(id);
  });
  socket.on('server:typing', ({ name, typing } = {}) => {
    renderTyping(typing && name ? [name] : []);
  });
  socket.on('server:soundboard:play', ({ id } = {}) => {
    if (isSoundboardId(id)) playSoundboard(id);
  });
  socket.on('server:deleted', () => {
    toast(t('server.deletedNotice'), 'error', 4200);
    setTimeout(() => { window.location.href = '/'; }, 1200);
  });
}

function scrollLatest(behavior) {
  requestAnimationFrame(() => {
    try { els.messages.scrollTo({ top: els.messages.scrollHeight, behavior }); }
    catch { els.messages.scrollTop = els.messages.scrollHeight; }
  });
}

/* ---------------- Soundboard (server) ---------------- */

function renderSoundboardGrid() {
  els.soundboardGrid.replaceChildren();
  for (const sound of SOUNDBOARD_SOUNDS) {
    const button = el('button', 'soundboard-sound');
    button.type = 'button';
    const face = el('span', 'soundboard-emoji');
    face.append(customEmojiImage(sound.emojiId));
    button.append(face, el('span', 'soundboard-name', t(`soundboard.${sound.id}`)));
    button.addEventListener('click', () => {
      playSoundboard(sound.id);
      state.socket?.emit('server:soundboard:play', { id: sound.id });
    });
    els.soundboardGrid.append(button);
  }
  if (els.soundboardVolume) els.soundboardVolume.value = String(Math.round(getSoundboardVolume() * 100));
}
function toggleSoundboard(force) {
  const open = typeof force === 'boolean' ? force : els.soundboardPanel.hidden;
  els.soundboardPanel.hidden = !open;
  els.soundboardBtn.setAttribute('aria-pressed', String(open));
}

/* ---------------- Helpers ---------------- */

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function icon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}
function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return (`${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`).toUpperCase() || '?';
}
function toneFor(id) {
  let hash = 0;
  for (let i = 0; i < String(id).length; i += 1) hash = (hash * 31 + String(id).charCodeAt(i)) >>> 0;
  return (hash % 4) + 1;
}
function formatTime(ts) {
  try { return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(ts)); }
  catch { return ''; }
}
function formatBytes(size) {
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function showHint(text) {
  if (!els.composerHint) return;
  els.composerHint.textContent = text || '';
  els.composerHint.hidden = !text;
}
function showError(key) {
  if (!els.joinError) return;
  if (key) { els.joinError.textContent = t(key); els.joinError.hidden = false; }
  else { els.joinError.textContent = ''; els.joinError.hidden = true; }
}
function setBusy(busy) { els.joinBtn.disabled = busy; }
function toast(message, variant = 'info', timeout = 3200) {
  if (!els.toasts || !message) return;
  const node = el('div', `toast${variant === 'error' ? ' is-error' : ''}`, message);
  els.toasts.append(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transition = 'opacity 180ms ease'; setTimeout(() => node.remove(), 220); }, timeout);
}
function emitAck(event, payload, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const socket = state.socket;
    if (!socket) { reject(new Error('error.notConnected')); return; }
    const timer = setTimeout(() => reject(new Error('error.serverNoResponse')), timeoutMs);
    socket.emit(event, payload, (response) => { clearTimeout(timer); resolve(response); });
  });
}
function handleLanguageChange() {
  if (state.server) applyServerUi();
  renderMessages();
  renderSoundboardGrid();
  els.channelTopic && (els.channelTopic.textContent = t('server.permanent'));
  document.title = state.server ? `${state.server.name} — Hush` : 'Server — Hush';
}
