// Server page — a system SEPARATE from standalone rooms.
// Own chat (server:chat:*), own voice channels (MediaMesh + server webrtc
// relay), permanent server + saved channel history, invite link to join.

import { MediaMesh, streamHasVideo } from './room/media.js';
import { initI18n, onLanguageChange, t, locale } from './i18n.js';
import { initTheme } from './theme.js';
import { getSettings, initSettings } from './settings.js';
import { startPing } from './ping.js';
import { SOUNDBOARD_SOUNDS, SOUNDBOARD_CATEGORIES, playSoundboard, playCustomSound, playBlobSound, getSoundboardVolume, setSoundboardVolume, isSoundboardId, soundboardEmojiId } from './soundboard.js';
import { listPersonalSounds, putPersonalSound, deletePersonalSound, clearPersonalSounds, readIndex, personalBlobUrl, imageFileToDataUrl, validatePersonalAudio, MAX_PERSONAL_SOUNDS } from './soundboard-store.js';
import { CUSTOM_EMOJIS, CUSTOM_STICKERS, STICKER_CATEGORIES, EMOJI_CATEGORIES, customEmojiImage, customStickerImage, isCustomSticker, isGifUrl, gifImage, splitEmojiShortcodes, preloadCustomEmojis, pushRecentEmoji, getRecentEmojis, searchEmojis, searchStickers, isEmojiOnlyMessage, emojiLabel, stickerLabel } from './emoji.js';
import { buildGifPanel, buildStickerMenu, setStickerMenuDeps, openStickerCreator } from './gif-panel.js';
setStickerMenuDeps({ CUSTOM_STICKERS, STICKER_CATEGORIES, customStickerImage, searchStickers, stickerLabel });

const REACTIONS = ['thumbsup', 'heart', 'laugh', 'tada', 'eyes', 'applause', 'fire', 'check'];
import { playSound, getSoundsEnabled, setSoundsEnabled } from './sounds.js';
import { getDeviceId, serverIconUrl } from './servers.js';
import { initLibraries } from './libraries-log.js';
import { initFeedback } from './feedback.js';
import { initViewportVars, supportsPictureInPicture, togglePictureInPicture } from './mobile.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const els = {
  gate: $('#join-gate'), joinForm: $('#join-form'), joinBtn: $('#join-btn'), joinError: $('#join-error'),
  nameInput: $('#name-input'), gateServer: $('#gate-server'),
  serverChannels: $('#server-channels'), serverChannelsTitle: $('#server-channels-title'),
  mobileChannelsToggle: $('#server-mobile-channels-toggle'), channelsClose: $('#server-channels-close'),
  membersPanel: $('#server-members-panel'), membersToggle: $('#members-toggle'), membersClose: $('#server-members-close'),
  drawerScrim: $('#server-drawer-scrim'),
  serverIcon: $('#server-icon'), serverName: $('#server-name'), serverCount: $('#server-count'), serverDescription: $('#server-description'),
  inviteBtn: $('#invite-btn'), inviteCopy: $('#invite-copy'), inviteCode: $('#invite-code'), regenInvite: $('#regen-invite'),
  leaveServerBtn: $('#leave-server-btn'), deleteServerBtn: $('#delete-server-btn'), dangerZone: $('#danger-zone'),
  textChannels: $('#text-channels'), voiceChannels: $('#voice-channels'), tempRooms: $('#temp-rooms'), tempKicker: $('#temp-kicker'),
  textKicker: $('#text-kicker'), voiceKicker: $('#voice-kicker'),
  addChannelForm: $('#add-channel-form'), newChannelName: $('#new-channel-name'), newChannelType: $('#new-channel-type'),
  createTempRoomForm: $('#create-temp-room-form'), newTempRoomName: $('#new-temp-room-name'), createTempRoomBtn: $('#create-temp-room-btn'),
  stage: $('#server-stage'), channelTitle: $('#channel-title'), channelTopic: $('#channel-topic'),
  messages: $('#messages'), typing: $('#typing'), composer: $('#composer'), messageInput: $('#message-input'),
  composerHint: $('#composer-hint'), emojiBtn: $('#emoji-btn'), emojiMenu: $('#emoji-menu'),
  gifBtn: $('#gif-btn'), gifMenu: $('#gif-menu'), stickerBtn: $('#sticker-btn'), stickerMenu: $('#sticker-menu'),
  nameCount: $('#name-count'),
  attachBtn: $('#attach-btn'), fileInput: $('#file-input'),
  soundboardBtn: $('#soundboard-btn'), soundboardPanel: $('#soundboard-panel'), soundboardTitle: $('#soundboard-title'),
  soundboardGrid: $('#soundboard-grid'), soundboardVolume: $('#soundboard-volume'), soundboardClose: $('#soundboard-close'),
  voiceStage: $('#voice-stage'), tileGrid: $('#tile-grid'),
  serverScreenStage: $('#server-screen-stage'), serverScreenVideo: $('#server-screen-video'), serverScreenLabel: $('#server-screen-label'),
  micBtn: $('#mic-btn'), micLabel: $('#mic-label'), cameraBtn: $('#camera-btn'), cameraLabel: $('#camera-label'),
  screenBtn: $('#screen-btn'), screenLabelBtn: $('#screen-label-btn'), leaveVoiceBtn: $('#leave-voice-btn'),
  leaveVoiceChip: $('#leave-voice-chip'), leaveVoiceChipLabel: $('#leave-voice-chip-label'),
  membersList: $('#members-list'), membersKicker: $('#members-kicker'),
  soundboardSearch: $('#soundboard-search'), soundboardMyGrid: $('#soundboard-my-grid'),
  soundboardMyTitle: $('#soundboard-my-title'), soundboardMyNote: $('#soundboard-my-note'),
  soundboardMyClear: $('#soundboard-my-clear'), boardMyForm: $('#board-my-form'),
  boardMyFile: $('#board-my-file'), boardMyName: $('#board-my-name'), boardMyImage: $('#board-my-image'),
  boardMyImagePreview: $('#board-my-image-preview'), boardMyEmoji: $('#board-my-emoji'),
  boardMyAddBtn: $('#board-my-add-btn'),
  deafenBtn: $('#deafen-btn'), deafenLabel: $('#deafen-label'),
  serverScreenStopWatching: $('#server-screen-stop-watching'), serverScreenStopLabel: $('#server-screen-stop-label'),
  serverScreenEnlarge: $('#server-screen-enlarge'),
  serverScreenPip: $('#server-screen-pip'),
  serverScreenWatchBtn: $('#server-screen-watch-btn'), serverScreenWatchLabel: $('#server-screen-watch-label'),
  serverSettings: $('#server-settings'), serverSettingsName: $('#server-settings-name'),
  serverSettingsDesc: $('#server-settings-desc'), serverSettingsIcon: $('#server-settings-icon'),
  serverSettingsPreview: $('#server-settings-preview'), serverSettingsRemoveIcon: $('#server-settings-remove-icon'),
  serverSettingsSave: $('#server-settings-save'),
  serverSettingsToggle: $('#server-settings-toggle'), serverSettingsToggleLabel: $('#server-settings-toggle-label'),
  serverOwnerTools: $('#server-owner-tools'),
  replyPreview: $('#server-reply-preview'), replyText: $('#server-reply-text'),
  replyCancel: $('#server-reply-cancel'),
  serverSettingsNameLabel: $('#server-settings-name-label'), serverSettingsDescLabel: $('#server-settings-desc-label'),
  serverSettingsIconLabel: $('#server-settings-icon-label'), serverSettingsTitle: $('#server-settings-title'),
  roleManager: $('#server-role-manager'), roleForm: $('#server-role-form'), roleId: $('#server-role-id'),
  roleName: $('#server-role-name'), roleColor: $('#server-role-color'), roleList: $('#server-role-list'),
  roleSave: $('#server-role-save'), roleCancel: $('#server-role-cancel'),
  imageLightbox: $('#image-lightbox'), imageLightboxBackdrop: $('#image-lightbox-backdrop'),
  imageLightboxImg: $('#image-lightbox-img'), imageLightboxCaption: $('#image-lightbox-caption'),
  imageLightboxDownload: $('#image-lightbox-download'), imageLightboxClose: $('#image-lightbox-close'),
  toasts: $('#toasts'), remoteAudio: $('#remote-audio')
};

const state = {
  serverId: parseServerId(),
  inviteCode: new URLSearchParams(window.location.search).get('invite') || '',
  socket: null, mesh: null, selfId: null, selfName: '', selfMemberId: '',
  server: null, channelId: null, messages: [],
  replyTo: null,
  online: new Map(), speaking: new Set(), typingMap: new Map(),
  deviceId: getDeviceId(), inVoice: false, voiceChannelId: null, tempRoomId: null, tempRooms: [], typingTimer: null,
  joined: false, emojiCat: 'all', emojiQuery: '', activeScreenId: null,
  sessionToken: '', loadSeq: 0, drafts: new Map(),
  lastTextChannelId: null, voiceOccupancy: {}, tempOccupancy: {},
  joiningVoice: false, creatingRoom: false,
  deafened: false, customSounds: [], personalSounds: [], boardQuery: '', hiddenScreenId: null,
  serverSettingsOpen: false, serverDrawer: null
};

// A1: sessions/tokens — store the opaque token from join ack; REST calls
// present it so deviceId alone is never the sole authority.
function saveSession(token) {
  state.sessionToken = token || '';
  try {
    if (token) sessionStorage.setItem(`hush:session:${state.serverId}`, token);
    else sessionStorage.removeItem(`hush:session:${state.serverId}`);
  } catch { /* ignore */ }
}
function loadSession() {
  try { state.sessionToken = sessionStorage.getItem(`hush:session:${state.serverId}`) || ''; } catch { state.sessionToken = ''; }
}
function authHeaders() {
  return state.sessionToken ? { 'X-Session-Token': state.sessionToken } : {};
}
function isOwner() {
  // A2: ownerDeviceId is redacted for non-owners — trust isOwner only.
  // Fall back to the legacy field for un-upgraded servers.
  return Boolean(state.server?.isOwner) || Boolean(state.server?.ownerDeviceId && state.server.ownerDeviceId === state.deviceId);
}

function currentMember() {
  return state.server?.members?.find((member) => member.isYou
    || (state.selfMemberId && member.memberId === state.selfMemberId)
    || (member.deviceId && member.deviceId === state.deviceId)) || null;
}

function hasPermission(permission) {
  if (isOwner()) return true;
  const member = currentMember();
  if (!member) return false;
  const roleIds = new Set(member.roleIds || ['member']);
  return (state.server?.roles || []).some((role) => roleIds.has(role.id) && role.permissions?.includes(permission));
}

function roleTitle(role) {
  return role.builtIn ? t(`server.role.${role.id}`) : role.name;
}

function roleRank(member) {
  const roleIds = new Set(member?.roleIds || ['member']);
  return Math.max(0, ...(state.server?.roles || [])
    .filter((role) => roleIds.has(role.id))
    .map((role) => role.position || 0));
}

function canModerateMember(member) {
  if (!hasPermission('moderate_members') || member.isOwner) return false;
  return isOwner() || roleRank(currentMember()) > roleRank(member);
}

function updateServerDrawerUi() {
  const isPhone = window.matchMedia('(max-width: 700px)').matches;
  const isNarrow = window.matchMedia('(max-width: 1100px)').matches;
  if ((state.serverDrawer === 'channels' && !isPhone) || (state.serverDrawer === 'members' && !isNarrow)) {
    state.serverDrawer = null;
  }

  const channelsOpen = state.serverDrawer === 'channels' && isPhone;
  const membersOpen = state.serverDrawer === 'members' && isNarrow;
  els.serverChannels?.classList.toggle('is-drawer-open', channelsOpen);
  els.membersPanel?.classList.toggle('is-drawer-open', membersOpen);
  els.serverChannels?.toggleAttribute('inert', isPhone && !channelsOpen);
  els.membersPanel?.toggleAttribute('inert', isNarrow && !membersOpen);
  if (els.drawerScrim) els.drawerScrim.hidden = !channelsOpen && !membersOpen;
  els.mobileChannelsToggle?.setAttribute('aria-expanded', String(channelsOpen));
  els.membersToggle?.setAttribute('aria-expanded', String(membersOpen));

  const channelsLabel = t('server.channels');
  const membersLabel = t('server.membersTitle');
  const closeLabel = t('chat.closePanel');
  if (els.messageInput) {
    els.messageInput.placeholder = t(isPhone ? 'server.messagePlaceholderShort' : 'server.messagePlaceholder');
    els.messageInput.setAttribute('aria-label', t('server.messageInputLabel'));
  }
  for (const button of [els.mobileChannelsToggle, els.channelsClose]) {
    if (button) {
      button.title = button === els.channelsClose ? closeLabel : channelsLabel;
      button.setAttribute('aria-label', button === els.channelsClose ? closeLabel : channelsLabel);
    }
  }
  for (const button of [els.membersToggle, els.membersClose]) {
    if (button) {
      button.title = button === els.membersClose ? closeLabel : membersLabel;
      button.setAttribute('aria-label', button === els.membersClose ? closeLabel : membersLabel);
    }
  }
  if (els.serverChannelsTitle) els.serverChannelsTitle.textContent = channelsLabel;
}

function toggleServerDrawer(drawer) {
  state.serverDrawer = state.serverDrawer === drawer ? null : drawer;
  updateServerDrawerUi();
  if (state.serverDrawer === drawer) {
    const panel = drawer === 'channels' ? els.serverChannels : els.membersPanel;
    panel?.querySelector('.server-drawer-close')?.focus();
  }
}

function closeServerDrawer(restoreFocus = false) {
  const previous = state.serverDrawer;
  state.serverDrawer = null;
  updateServerDrawerUi();
  if (restoreFocus) {
    const trigger = previous === 'channels' ? els.mobileChannelsToggle : els.membersToggle;
    trigger?.focus();
  }
}

function receiveServerBroadcast(server) {
  const previous = state.server;
  const previouslyOwner = isOwner();
  const previousMembers = new Map((previous?.members || []).map((member) => [member.memberId, member]));
  const members = (server.members || []).map((member) => {
    const old = previousMembers.get(member.memberId);
    const isYou = member.memberId === state.selfMemberId || Boolean(old?.isYou);
    return {
      ...member,
      isYou,
      ...(previouslyOwner && old?.deviceId ? { deviceId: old.deviceId } : {})
    };
  });
  state.server = {
    ...server,
    isOwner: previouslyOwner,
    ownerDeviceId: previouslyOwner ? previous?.ownerDeviceId : null,
    members
  };
}

async function refreshServerSummary() {
  const serverId = state.serverId;
  try {
    const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}?deviceId=${encodeURIComponent(state.deviceId)}`, {
      headers: authHeaders()
    });
    if (!response.ok) throw new Error(`server-summary-failed:${response.status}`);
    const data = await response.json();
    if (serverId !== state.serverId || !data.server?.isMember) return;
    state.server = data.server;
    const self = state.server.members?.find((member) => member.isYou || member.deviceId === state.deviceId);
    if (self?.memberId) state.selfMemberId = self.memberId;
    applyServerUi();
  } catch (error) {
    console.error('server summary refresh failed', error);
  }
}

initI18n();
initTheme();
initSettings();
initViewportVars();
initLibraries();
initFeedback();
startPing({ socketGetter: () => state.socket });
onLanguageChange(handleLanguageChange);
init();

function parseServerId() {
  const match = window.location.pathname.match(/^\/s\/([^/?#]+)\/?$/i);
  return match ? match[1] : '';
}

function init() {
  loadName();
  loadSession();
  // A32: draft restores after channel is known (join -> selectChannel),
  // not at init before channelId exists. Initial restore is a no-op keeper.
  document.querySelector('#server-shell')?.setAttribute('inert', '');
  bindEvents();
  renderSoundboardGrid();
  buildEmojiMenu();
  preloadCustomEmojis();
}

function draftKey() { return `hush:draft:server:${state.serverId}:${state.channelId || 'none'}`; }
function restoreDraft() {
  try {
    const saved = sessionStorage.getItem(draftKey());
    if (els.messageInput) els.messageInput.value = saved ?? '';
  } catch { /* ignore */ }
}
function saveDraftForCurrent() {
  // A32: persist the outgoing channel's text before switching.
  try {
    const v = els.messageInput?.value ?? '';
    const key = draftKey();
    state.drafts.set(state.channelId, v);
    if (v.trim()) sessionStorage.setItem(key, v);
    else sessionStorage.removeItem(key);
  } catch { /* ignore */ }
}
function saveDraft() {
  try {
    const v = els.messageInput?.value ?? '';
    if (v.trim()) sessionStorage.setItem(draftKey(), v);
    else sessionStorage.removeItem(draftKey());
  } catch { /* ignore */ }
}

function loadName() {
  try {
    const saved = localStorage.getItem('hush:name');
    if (saved) els.nameInput.value = saved;
  } catch { /* ignore */ }
}

function updateNameCount() {
  if (!els.nameCount || !els.nameInput) return;
  els.nameCount.textContent = t('name.count', { count: String(els.nameInput.value.length) });
}
function bindEvents() {
  els.joinForm.addEventListener('submit', join);
  els.nameInput?.addEventListener('input', updateNameCount);
  updateNameCount();
  els.inviteBtn?.addEventListener('click', copyInvite);
  els.inviteCopy?.addEventListener('click', copyInvite);
  els.regenInvite?.addEventListener('click', regenerateInvite);
  els.leaveServerBtn?.addEventListener('click', leaveServer);
  els.deleteServerBtn?.addEventListener('click', deleteServer);
  els.addChannelForm?.addEventListener('submit', (e) => { e.preventDefault(); addChannel(); });
  els.composer.addEventListener('submit', (e) => { e.preventDefault(); sendFromComposer(); });
  els.replyCancel?.addEventListener('click', clearReply);
  els.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendFromComposer(); }
  });
  els.messageInput.addEventListener('input', handleDraftInput);
  els.messageInput.addEventListener('input', saveDraft);
  els.emojiBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleEmojiMenu(); });
  els.gifBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleGifMenu(); });
  els.stickerBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleStickerMenu(); });
  if (els.gifMenu) buildGifMenu();
  if (els.stickerMenu) buildStickerMenuPanel();
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
  els.mobileChannelsToggle?.addEventListener('click', () => toggleServerDrawer('channels'));
  els.membersToggle?.addEventListener('click', () => toggleServerDrawer('members'));
  els.channelsClose?.addEventListener('click', () => closeServerDrawer(true));
  els.membersClose?.addEventListener('click', () => closeServerDrawer(true));
  els.drawerScrim?.addEventListener('click', () => closeServerDrawer(true));
  els.serverChannels?.addEventListener('click', (event) => {
    if (state.serverDrawer !== 'channels') return;
    if (!event.target.closest('.server-channel') || event.target.closest('.server-channel-del')) return;
    state.serverDrawer = null;
    updateServerDrawerUi();
    els.channelTitle?.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.serverDrawer) {
      event.preventDefault();
      closeServerDrawer(true);
    }
  });
  window.addEventListener('resize', updateServerDrawerUi);
  updateServerDrawerUi();
  els.soundboardVolume?.addEventListener('input', () => setSoundboardVolume(Number(els.soundboardVolume.value) / 100));
  els.deafenBtn?.addEventListener('click', () => toggleDeafen());
  els.serverScreenStopWatching?.addEventListener('click', (e) => { e.stopPropagation(); stopWatchingScreen(); });
  els.serverScreenEnlarge?.addEventListener('click', (e) => { e.stopPropagation(); toggleScreenEnlarge(); });
  els.serverScreenPip?.addEventListener('click', (e) => { e.stopPropagation(); void toggleServerScreenPip(); });
  els.serverScreenVideo?.addEventListener('playing', () => {});
  els.serverScreenStopWatching?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stopWatchingScreen(); } });
  els.serverScreenWatchBtn?.addEventListener('click', () => { state.hiddenScreenId = null; updateScreenStage(); });
  els.soundboardSearch?.addEventListener('input', () => { state.boardQuery = els.soundboardSearch.value.trim().toLowerCase(); renderSoundboardGrid(); });
  els.boardMyForm?.addEventListener('submit', (e) => { e.preventDefault(); addPersonalSound(); });
  els.soundboardMyClear?.addEventListener('click', async () => { await clearPersonalSounds(); state.personalSounds = []; renderPersonalGrid(); });
  els.boardMyImage?.addEventListener('change', () => { const f = els.boardMyImage?.files?.[0]; if (!f) return; imageFileToDataUrl(f).then((u) => { boardMyImageDataUrl = u; if (els.boardMyImagePreview) { els.boardMyImagePreview.src = u; els.boardMyImagePreview.hidden = false; } }).catch(() => {}); });
  els.serverSettings?.addEventListener('submit', (e) => { e.preventDefault(); saveServerSettings(); });
  els.roleForm?.addEventListener('submit', (e) => { e.preventDefault(); saveRole(); });
  els.roleCancel?.addEventListener('click', resetRoleForm);
  els.serverSettingsToggle?.addEventListener('click', () => {
    state.serverSettingsOpen = !state.serverSettingsOpen;
    applyServerUi();
    if (state.serverSettingsOpen) els.serverSettingsName?.focus();
  });
  els.serverSettingsRemoveIcon?.addEventListener('click', () => removeServerIcon());
  if (els.boardMyEmoji) {
    els.boardMyEmoji.replaceChildren();
    for (const emoji of CUSTOM_EMOJIS) {
      const option = document.createElement('option');
      option.value = emoji.id; option.textContent = emoji.id; els.boardMyEmoji.append(option);
    }
  }
  loadPersonalSounds();
  els.micBtn?.addEventListener('click', toggleMic);
  els.cameraBtn?.addEventListener('click', toggleCamera);
  els.screenBtn?.addEventListener('click', toggleScreen);
  els.leaveVoiceBtn?.addEventListener('click', leaveVoice);
  els.leaveVoiceChip?.addEventListener('click', leaveVoice);
  els.createTempRoomForm?.addEventListener('submit', (e) => { e.preventDefault(); createTempRoom(); });
  // Autoplay policy: resume audio contexts on any gesture (see room.js).
  const resumeMeshAudio = () => { try { state.mesh?.resumeAudio(); } catch { /* ignore */ } };
  document.addEventListener('pointerdown', resumeMeshAudio, { passive: true });
  document.addEventListener('keydown', resumeMeshAudio);
  document.addEventListener('click', (e) => {
    if (els.emojiMenu && !els.emojiMenu.hidden && !els.emojiMenu.contains(e.target) && !els.emojiBtn?.contains(e.target)) closeEmojiMenu();
    if (els.gifMenu && !els.gifMenu.hidden && !els.gifMenu.contains(e.target) && !els.gifBtn?.contains(e.target)) closeGifMenu();
    if (els.stickerMenu && !els.stickerMenu.hidden && !els.stickerMenu.contains(e.target) && !els.stickerBtn?.contains(e.target)) closeStickerMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const wasOpen = Boolean(state.reactionPopover);
      closeImageLightbox(); closeEmojiMenu(); closeGifMenu(); closeStickerMenu(); toggleSoundboard(false);
      closeReactionPopover();
      if (wasOpen && state.reactionPopoverAnchor) { try { state.reactionPopoverAnchor.focus({ preventScroll: true }); } catch { /* ignore */ } }
    }
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
    if (!response?.ok) {
      if (response?.error === 'invite-required') throw new Error('server.inviteRequired');
      if (response?.error === 'banned') throw new Error('server.bannedNotice');
      throw new Error('error.joinFailed');
    }
    state.selfName = response.self.name;
    state.selfId = response.self.id;
    state.selfMemberId = response.self?.memberId || '';
    state.server = response.server;
    saveSession(response.sessionToken || '');
    state.tempRooms = Array.isArray(response.tempRooms) ? response.tempRooms : [];
    state.voiceOccupancy = response.voiceOccupancy || {};
    state.tempOccupancy = response.tempOccupancy || {};
    state.channelId = response.channelId;
    state.lastTextChannelId = response.channelId;
    for (const p of response.membersOnline || []) state.online.set(p.id, p);
    state.joined = true;
    els.gate.hidden = true;
    try { document.querySelector('#server-shell')?.removeAttribute('inert'); } catch { /* ignore */ }
    document.title = `${state.server.name} — Hush`;
    applyServerUi();
    await loadChannel(state.channelId, response.messages || []);
    restoreDraft();
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
    // A35 fix: say 'disconnected — reconnecting' on disconnect, not 'reconnected'.
    toast(t('toast.reconnecting') || 'Disconnected — reconnecting…', 'info', 2600);
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
      serverId: state.serverId, name: state.selfName, deviceId: state.deviceId, inviteCode: state.inviteCode, channelId: state.channelId
    });
    if (response?.ok) {
      state.server = response.server;
      saveSession(response.sessionToken || state.sessionToken);
      state.tempRooms = Array.isArray(response.tempRooms) ? response.tempRooms : state.tempRooms;
      state.voiceOccupancy = response.voiceOccupancy || state.voiceOccupancy || {};
      state.tempOccupancy = response.tempOccupancy || state.tempOccupancy || {};
      state.online.clear();
      for (const p of response.membersOnline || []) state.online.set(p.id, p);
      applyServerUi();
      renderMembers();
      renderTiles();
      // Reload the channel you are actually looking at, not the first text
      // channel: the old rejoin loaded the wrong channel's messages.
      await loadChannel(state.channelId, response.messages || []);
    }
  } catch { /* next reconnect retries */ }
}

/* ---------------- Server UI ---------------- */

function applyServerUi() {
  const server = state.server;
  if (!server) return;
  if (els.stage) els.stage.setAttribute('aria-label', t('server.chatLabel'));
  if (els.messages) els.messages.setAttribute('aria-label', t('server.messagesLabel'));
  if (els.serverName) els.serverName.textContent = server.name;
  if (els.gateServer) els.gateServer.textContent = server.name;
  if (els.serverDescription) {
    if (server.description) { els.serverDescription.textContent = server.description; els.serverDescription.hidden = false; }
    else { els.serverDescription.textContent = ''; els.serverDescription.hidden = true; }
  }
  const onlineCount = state.online.size;
  if (els.serverCount) els.serverCount.textContent = t('server.members', { count: server.memberCount ?? 1 }) + (onlineCount > 0 ? ` · ${t('server.onlineNow', { count: onlineCount })}` : '');
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
  const ownerCheck = isOwner();
  const settingsPermission = hasPermission('manage_settings');
  const channelsPermission = hasPermission('manage_channels');
  const hasServerTools = ownerCheck || settingsPermission || channelsPermission;
  if (els.regenInvite) els.regenInvite.hidden = !settingsPermission;
  if (els.dangerZone) els.dangerZone.hidden = !ownerCheck;
  if (els.serverSettingsToggle) {
    els.serverSettingsToggle.hidden = !hasServerTools;
    els.serverSettingsToggle.setAttribute('aria-expanded', String(hasServerTools && state.serverSettingsOpen));
    if (els.serverSettingsToggleLabel) els.serverSettingsToggleLabel.textContent = t('server.settings');
    els.serverSettingsToggle.setAttribute('aria-label', t('server.settings'));
    if (!hasServerTools) state.serverSettingsOpen = false;
  }
  if (els.serverOwnerTools) els.serverOwnerTools.hidden = !hasServerTools || !state.serverSettingsOpen;
  if (els.serverSettings) els.serverSettings.hidden = !settingsPermission;
  if (els.serverSettings) {
    if (settingsPermission) {
      if (els.serverSettingsName && document.activeElement !== els.serverSettingsName) els.serverSettingsName.value = server.name || '';
      if (els.serverSettingsDesc && document.activeElement !== els.serverSettingsDesc) els.serverSettingsDesc.value = server.description || '';
      if (els.serverSettingsPreview) {
        if (server.iconUrl) { els.serverSettingsPreview.src = server.iconUrl; els.serverSettingsPreview.hidden = false; }
        else els.serverSettingsPreview.hidden = true;
      }
      if (els.serverSettingsRemoveIcon) els.serverSettingsRemoveIcon.hidden = !server.iconUrl;
      if (els.serverSettingsNameLabel) els.serverSettingsNameLabel.textContent = t('server.settingsName');
      if (els.serverSettingsDescLabel) els.serverSettingsDescLabel.textContent = t('server.settingsDesc');
      if (els.serverSettingsIconLabel) els.serverSettingsIconLabel.textContent = t('server.settingsIcon');
      if (els.serverSettingsTitle) els.serverSettingsTitle.textContent = t('server.settings');
      if (els.serverSettingsSave) els.serverSettingsSave.textContent = t('server.settingsSave');
    }
  }
  if (els.roleManager) els.roleManager.hidden = !ownerCheck;
  renderRoleManager();
  if (Array.isArray(server.customSounds)) state.customSounds = server.customSounds;
  if (els.addChannelForm) els.addChannelForm.hidden = !channelsPermission;
  renderChannels();
  renderMembers();
}

function renderRoleManager() {
  if (!els.roleManager) return;
  const labels = [
    ['#server-roles-title', 'server.rolesTitle'],
    ['#server-role-name-label', 'server.roleName'],
    ['#server-role-color-label', 'server.roleColor'],
    ['#server-role-permissions-label', 'server.rolePermissions'],
    ['#server-role-perm-settings', 'server.permission.manage_settings'],
    ['#server-role-perm-channels', 'server.permission.manage_channels'],
    ['#server-role-perm-members', 'server.permission.moderate_members'],
    ['#server-role-perm-messages', 'server.permission.manage_messages']
  ];
  for (const [selector, key] of labels) {
    const node = $(selector);
    if (node) node.textContent = t(key);
  }
  if (!els.roleForm || !els.roleList || !isOwner()) return;
  if (!els.roleId?.value && els.roleSave) els.roleSave.textContent = t('server.roleCreate');
  if (els.roleCancel) els.roleCancel.textContent = t('server.roleCancel');
  els.roleList.replaceChildren();
  const roles = [...(state.server?.roles || [])].sort((a, b) => b.position - a.position);
  for (const role of roles) {
    const item = document.createElement('li');
    item.className = 'server-role-item';
    const name = document.createElement('span');
    name.className = 'server-role-name';
    name.style.setProperty('--role-color', role.color);
    name.textContent = roleTitle(role);
    const permissions = document.createElement('span');
    permissions.className = 'server-role-summary';
    permissions.textContent = role.permissions.length
      ? role.permissions.map((permission) => t(`server.permission.${permission}`)).join(' · ')
      : t('server.roleNoPermissions');
    item.append(name, permissions);
    if (!role.builtIn) {
      const actions = document.createElement('span');
      actions.className = 'server-role-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-quiet btn-sm';
      edit.textContent = t('server.roleEdit');
      edit.addEventListener('click', () => editRole(role));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-quiet btn-sm';
      remove.textContent = t('server.roleDelete');
      remove.addEventListener('click', () => deleteRole(role));
      actions.append(edit, remove);
      item.append(actions);
    }
    els.roleList.append(item);
  }
}

function resetRoleForm() {
  if (!els.roleForm) return;
  els.roleForm.reset();
  if (els.roleId) els.roleId.value = '';
  if (els.roleColor) els.roleColor.value = '#64748b';
  if (els.roleSave) els.roleSave.textContent = t('server.roleCreate');
  if (els.roleCancel) els.roleCancel.hidden = true;
}

function editRole(role) {
  if (!els.roleForm) return;
  els.roleId.value = role.id;
  els.roleName.value = role.name;
  els.roleColor.value = role.color;
  for (const input of els.roleForm.querySelectorAll('.server-role-permissions input')) {
    input.checked = role.permissions.includes(input.value);
  }
  els.roleSave.textContent = t('server.roleSave');
  els.roleCancel.hidden = false;
  els.roleName.focus();
}

async function saveRole() {
  const roleId = els.roleId?.value || '';
  const permissions = [...(els.roleForm?.querySelectorAll('.server-role-permissions input:checked') || [])]
    .map((input) => input.value);
  const body = { name: els.roleName?.value || '', color: els.roleColor?.value || '', permissions };
  const path = `/api/servers/${encodeURIComponent(state.serverId)}/roles${roleId ? `/${encodeURIComponent(roleId)}` : ''}`;
  try {
    const response = await fetch(path, {
      method: roleId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'role-save-failed');
    state.server = data.server;
    resetRoleForm();
    applyServerUi();
    toast(t('server.roleSaved'), 'info', 2400);
  } catch {
    toast(t('server.roleFailed'), 'error', 3600);
  }
}

async function deleteRole(role) {
  if (!window.confirm(t('server.roleDeleteConfirm', { name: role.name }))) return;
  try {
    const response = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/roles/${encodeURIComponent(role.id)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'role-delete-failed');
    state.server = data.server;
    resetRoleForm();
    applyServerUi();
  } catch {
    toast(t('server.roleFailed'), 'error', 3600);
  }
}

async function assignMemberRoles(member, roleIds) {
  if (!member.memberId) { toast(t('server.roleFailed'), 'error', 3600); return; }
  try {
    const response = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/members/${encodeURIComponent(member.memberId)}/roles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ roleIds })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'role-assignment-failed');
    state.server = data.server;
    applyServerUi();
    toast(t('server.roleAssigned'), 'info', 2200);
  } catch {
    toast(t('server.roleFailed'), 'error', 3600);
  }
}

function occupantsFor(channelId, kind) {
  if (kind === 'temp') return state.tempOccupancy?.[channelId] || [];
  return state.voiceOccupancy?.[channelId] || [];
}
function renderOccupantList(channelId, kind) {
  const occupants = occupantsFor(channelId, kind);
  if (!occupants.length) return null;
  const ul = document.createElement('ul');
  ul.className = 'server-voice-occupants';
  for (const person of occupants) {
    const li = document.createElement('li');
    li.className = 'server-voice-occupant';
    const avatar = document.createElement('span');
    avatar.className = `server-voice-avatar tone-${toneFor(person.id || person.name)}`;
    avatar.textContent = initials(person.name || '?');
    const speaking = state.speaking.has(person.id);
    if (speaking) avatar.classList.add('is-speaking');
    const name = document.createElement('span');
    name.className = 'server-voice-name';
    name.textContent = person.id === state.selfId ? `${person.name} (${t('chat.you')})` : (person.name || '?');
    li.append(avatar, name);
    ul.append(li);
  }
  return ul;
}

function renderChannels() {
  const server = state.server;
  if (!server) return;
  const activeChannelId = document.activeElement?.dataset?.channelId || '';
  const fill = (ul, type) => {
    if (!ul) return;
    ul.replaceChildren();
    const list = server.channels.filter((c) => c.type === type);
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'server-temp-empty';
      li.textContent = t('server.noChannels') || 'No channels';
      ul.append(li);
      return;
    }
    for (const ch of list) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'server-channel-row';
      const link = document.createElement('button');
      link.type = 'button';
      const isCurrent = ch.type === 'voice'
        ? state.voiceChannelId === ch.id
        : state.channelId === ch.id && !state.inVoice;
      link.className = 'server-channel' + (isCurrent ? ' is-current' : '');
      link.dataset.channelId = ch.id;
      if (isCurrent) link.setAttribute('aria-current', 'page');
      const glyph = document.createElement('span');
      glyph.className = 'server-channel-glyph';
      glyph.append(icon(ch.type === 'voice' ? 'i-volume2' : 'i-hash'));
      const label = document.createElement('span');
      label.className = 'server-channel-label';
      label.textContent = ch.name;
      link.append(glyph, label);
      if (ch.type === 'voice') {
        const occupants = occupantsFor(ch.id, 'voice');
        if (occupants.length) {
          const count = document.createElement('span');
          count.className = 'server-channel-count';
          count.textContent = String(occupants.length);
          link.append(count);
        }
      }
      row.append(link);
      if (hasPermission('manage_channels') && server.channels.length > 1) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'server-channel-del';
        del.title = t('server.deleteChannel');
        del.setAttribute('aria-label', t('server.deleteChannel'));
        del.append(icon('i-trash'));
        del.addEventListener('click', (e) => { e.stopPropagation(); deleteChannel(ch.id); });
        row.append(del);
      }
      link.addEventListener('click', () => selectChannel(ch));
      li.append(row);
      if (ch.type === 'voice') {
        const occ = renderOccupantList(ch.id, 'voice');
        if (occ) li.append(occ);
      }
      ul.append(li);
    }
  };
  fill(els.textChannels, 'text');
  fill(els.voiceChannels, 'voice');
  // A41: restore focus across re-renders.
  if (activeChannelId) {
    const el = ul2sel(activeChannelId);
    if (el) try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
  renderTempRooms();
}
function ul2sel(channelId) {
  return document.querySelector(`[data-channel-id="${CSS.escape(String(channelId))}"]`);
}

function renderTempRooms() {
  if (!els.tempRooms) return;
  els.tempRooms.replaceChildren();
  const rooms = state.tempRooms || [];
  if (els.tempKicker) els.tempKicker.textContent = t('server.tempRoomsTitle');
  if (!rooms.length) {
    const li = document.createElement('li');
    li.className = 'server-temp-empty';
    li.textContent = t('server.tempRoomsEmpty');
    els.tempRooms.append(li);
    return;
  }
  for (const room of rooms) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'server-channel-row';
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'server-channel server-channel-temp' + (room.id === state.tempRoomId ? ' is-current' : '');
    link.dataset.tempRoomId = room.id;
    if (room.id === state.tempRoomId) link.setAttribute('aria-current', 'page');
    const glyph = document.createElement('span');
    glyph.className = 'server-channel-glyph';
    glyph.append(icon('i-volume2'));
    const label = document.createElement('span');
    label.className = 'server-channel-label';
    label.textContent = room.name;
    const count = document.createElement('span');
    count.className = 'server-channel-count';
    count.textContent = String(room.memberCount ?? 0);
    link.append(glyph, label, count);
    row.append(link);
    // A2: creatorDeviceId is no longer broadcast — the server still enforces
    // creator-only rename; the button is shown for all and errors if not creator.
    // (Older servers that still send creatorDeviceId keep the precise check.)
    const isCreator = room.isCreator || (room.creatorDeviceId ? room.creatorDeviceId === state.deviceId : room.creatorName === state.selfName);
    if (isCreator) {
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'server-channel-del';
      rename.title = t('server.renameTempRoom');
      rename.setAttribute('aria-label', t('server.renameTempRoom'));
      rename.append(icon('i-pencil'));
      rename.addEventListener('click', (e) => { e.stopPropagation(); renameTempRoom(room); });
      row.append(rename);
    }
    link.addEventListener('click', () => joinTempRoom(room));
    li.append(row);
    const occ = renderOccupantList(room.id, 'temp');
    if (occ) li.append(occ);
    else if (Array.isArray(room.members) && room.members.length) {
      const ul = document.createElement('ul');
      ul.className = 'server-voice-occupants';
      for (const person of room.members) {
        const occLi = document.createElement('li');
        occLi.className = 'server-voice-occupant';
        const avatar = document.createElement('span');
        avatar.className = `server-voice-avatar tone-${toneFor(person.id || person.name)}`;
        avatar.textContent = initials(person.name || '?');
        const name = document.createElement('span');
        name.className = 'server-voice-name';
        name.textContent = person.id === state.selfId ? `${person.name} (${t('chat.you')})` : (person.name || '?');
        occLi.append(avatar, name);
        ul.append(occLi);
      }
      li.append(ul);
    }
    els.tempRooms.append(li);
  }
}

async function enterVoiceMedia(name) {
  enterVoiceContext({ tempRoomId: state.tempRoomId || null, voiceChannelId: state.voiceChannelId || null, name });
  const result = await state.mesh?.init({ mic: false, camera: false });
  if (result?.warning) toast(result.warning, 'error', 4800);
  renderTiles();
  updateVoiceControls();
}

async function createTempRoom() {
  if (state.creatingRoom) return;
  state.creatingRoom = true;
  if (els.createTempRoomBtn) els.createTempRoomBtn.disabled = true;
  const name = els.newTempRoomName?.value.trim() || '';
  try {
    const response = await emitAck('server:tempRoom:create', { name });
    if (!response?.ok) {
      if (response?.error === 'room-limit') toast(t('server.tempRoomLimit'), 'error', 3600);
      else if (response?.error === 'not-member') toast(t('server.notMember'), 'error', 3600);
      else toast(t('error.joinFailed'), 'error', 3600);
      return;
    }
    state.tempRooms = response.tempRooms || state.tempRooms;
    if (response.voiceOccupancy) state.voiceOccupancy = response.voiceOccupancy;
    if (response.tempOccupancy) state.tempOccupancy = response.tempOccupancy;
    if (els.newTempRoomName) els.newTempRoomName.value = '';
    if (response.room) {
      state.tempRoomId = response.room.id;
      state.voiceChannelId = null;
      state.inVoice = true;
      await enterVoiceMedia(response.room.name);
      toast(t('server.tempRoomCreated', { name: response.room?.name || '' }), 'info', 2400);
    }
  } catch { toast(t('error.joinFailed'), 'error', 3600); }
  finally {
    state.creatingRoom = false;
    if (els.createTempRoomBtn) els.createTempRoomBtn.disabled = false;
  }
}

async function joinTempRoom(room) {
  if (room.id === state.tempRoomId && state.inVoice) return;
  if (state.joiningVoice) return;
  state.joiningVoice = true;
  try {
    const response = await emitAck('server:tempRoom:join', { roomId: room.id });
    if (!response?.ok) { toast(t('error.joinFailed'), 'error', 3600); return; }
    state.tempRoomId = room.id;
    state.voiceChannelId = null;
    state.inVoice = true;
    await enterVoiceMedia(room.name);
  } catch { toast(t('error.joinFailed'), 'error', 3600); }
  finally { state.joiningVoice = false; }
}

async function renameTempRoom(room) {
  const next = window.prompt(t('server.renameTempRoom'), room.name);
  if (next === null) return;
  const trimmed = String(next).trim();
  if (!trimmed) { toast(t('error.generic'), 'error', 3200); return; }
  const response = await emitAck('server:tempRoom:rename', { roomId: room.id, name: trimmed });
  if (!response?.ok) {
    toast(t(response?.error === 'not-creator' ? 'server.onlyCreatorRename' : 'error.generic'), 'error', 3600);
    return;
  }
  room.name = response.name;
  if (state.tempRoomId === room.id && els.channelTitle) els.channelTitle.textContent = response.name;
  renderTempRooms();
}

async function selectChannel(channel) {
  if (!channel) return;
  if (channel.type === 'voice') { joinVoice(channel); return; }
  // Fix trap: clicking a text channel while in voice MUST exit voice first,
  // even if it is the same channelId as before (the old early-return left
  // the voice stage covering chat with no way out).
  const wasVoice = state.inVoice;
  if (wasVoice) {
    const wasTemp = Boolean(state.tempRoomId);
    const wasChannel = state.voiceChannelId;
    state.inVoice = false;
    state.voiceChannelId = null;
    state.tempRoomId = null;
    state.activeScreenId = null;
    state.mesh?.closeAll();
    state.mesh?.disableMic();
    state.mesh?.disableCamera();
    state.mesh?.stopScreen();
    // Optimistic local occupancy cleanup; server will confirm.
    if (wasChannel) delete state.voiceOccupancy[wasChannel];
    if (wasTemp) delete state.tempOccupancy[wasTemp];
    try { if (wasTemp) await emitAck('server:tempRoom:leave', {}); else await emitAck('server:voice:leave', {}); } catch { /* ignore */ }
    if (els.voiceStage) els.voiceStage.hidden = true;
    els.stage.classList.remove('is-voice');
    if (els.serverScreenStage) els.serverScreenStage.hidden = true;
    if (els.serverScreenVideo) els.serverScreenVideo.srcObject = null;
    syncLeaveChip();
    updateVoiceControls();
  }
  if (channel.id === state.channelId && !wasVoice) return;
  // A32: save the outgoing draft BEFORE switching; A31: bump the sequence
  // so stale history responses from the previous channel are ignored.
  saveDraftForCurrent();
  state.channelId = channel.id;
  state.lastTextChannelId = channel.id;
  clearReply();
  const seq = ++state.loadSeq;
  if (els.messageInput) els.messageInput.value = '';
  renderChannels();
  restoreDraft();
  if (seq !== state.loadSeq) return;
  await loadChannel(channel.id);
}

async function loadChannel(channelId, initialMessages) {
  if (!channelId) return;
  const seq = ++state.loadSeq;
  let messages = initialMessages;
  if (!Array.isArray(messages)) {
    try {
      const response = await emitAck('server:history', { channelId });
      // A31: a rapid A->B switch must not let A's late history overwrite B.
      if (seq !== state.loadSeq) return;
      messages = response?.ok ? response.messages || [] : [];
      if (!response?.ok) toast(t('server.historyFailed') || 'Could not load history', 'error', 3200);
    } catch {
      if (seq !== state.loadSeq) return;
      messages = [];
      toast(t('server.historyFailed') || 'Could not load history', 'error', 3200);
    }
  }
  if (seq !== state.loadSeq) return;
  // Cap DOM/memory: keep the last 200 (server holds 500; UI pages the tail).
  state.messages = Array.isArray(messages) ? messages.slice(-200) : [];
  const channel = state.server?.channels.find((c) => c.id === channelId);
  if (els.channelTitle) els.channelTitle.textContent = channel ? `# ${channel.name}` : '';
  if (els.channelTopic) els.channelTopic.textContent = t('server.permanent');
  renderMessages();
}

async function addChannel() {
  const name = els.newChannelName?.value.trim();
  const type = els.newChannelType?.value || 'text';
  if (!name) { els.newChannelName?.focus(); return; }
  const btn = els.addChannelForm?.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/channels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, type, deviceId: state.deviceId, sessionToken: state.sessionToken })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('channel-failed');
    state.server = data.server || state.server;
    els.newChannelName.value = '';
    toast(t('server.channelCreated'), 'info', 2400);
    applyServerUi();
  } catch { toast(t('server.channelFailed'), 'error', 3600); }
  finally { if (btn) btn.disabled = false; }
}

async function deleteChannel(channelId) {
  if (!window.confirm(t('server.deleteChannelConfirm'))) return;
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/channels/${encodeURIComponent(channelId)}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ deviceId: state.deviceId, sessionToken: state.sessionToken })
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
  const url = inviteUrl();
  try { await navigator.clipboard.writeText(url); toast(t('toast.inviteCopied'), 'info', 2400); } catch {
    // A34 fallback for non-secure contexts.
    try {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) toast(t('toast.inviteCopied'), 'info', 2400);
      else toast(t('toast.copyFailed'), 'error', 3600);
    } catch { toast(t('toast.copyFailed'), 'error', 3600); }
  }
}

async function regenerateInvite() {
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/regenerate-invite`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ deviceId: state.deviceId, sessionToken: state.sessionToken })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('regen-failed');
    state.server = data.server;
    applyServerUi();
    toast(t('server.inviteRegenerated') || 'Invite regenerated', 'info', 2400);
  } catch { toast(t('error.generic'), 'error', 3600); }
}

async function leaveServer() {
  const owner = isOwner();
  if (!window.confirm(t(owner ? 'server.leaveOwnerConfirm' : 'server.leaveConfirm'))) return;
  if (owner) {
    if (!window.confirm(t('server.deleteConfirm'))) return;
    try {
      await fetch(`/api/servers/${encodeURIComponent(state.serverId)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ deviceId: state.deviceId, sessionToken: state.sessionToken })
      });
    } catch { /* ignore */ }
  } else {
    try {
      await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/leave`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ deviceId: state.deviceId, sessionToken: state.sessionToken })
      });
    } catch { /* ignore */ }
  }
  saveSession('');
  state.socket?.emit('server:leave');
  state.mesh?.dispose();
  state.socket?.disconnect();
  window.location.href = '/#servers';
}

async function deleteServer() { leaveServer(); }

/* ---------------- Chat ---------------- */

function removeEmptyChatState() {
  els.messages?.querySelector('.chat-empty')?.remove();
}

function renderMessages() {
  els.messages.replaceChildren();
  if (!state.messages.length) {
    const empty = el('div', 'chat-empty');
    empty.textContent = t('chat.empty') || 'No messages yet. Say hello.';
    els.messages.append(empty);
  }
  for (const message of state.messages) els.messages.append(createMessageNode(message));
  scrollLatest('auto');
}

function createMessageNode(message) {
  const isSelf = message.isOwn === true || message.authorDeviceId === state.deviceId || message.authorId === state.selfId;
  const article = el('article', 'message');
  article.dataset.messageId = message.id;
  article.classList.toggle('is-self', isSelf);
  if (message.text && isEmojiOnlyMessage(message.text)) article.classList.add('is-emoji-only');
  const avatar = el('span', `message-avatar tone-${toneFor(message.authorName || message.id)}`, initials(message.authorName));
  const body = el('div', 'message-body');
  body.append(el('div', 'message-head'));
  const head = body.firstChild;
  head.append(el('span', 'message-author', message.authorName || t('chat.guest')), el('time', 'message-time', formatTime(message.createdAt)));
  const bubble = el('div', 'message-bubble');
  if (message.replyTo) {
    const quote = el('div', 'server-message-quote');
    quote.append(el('strong', '', t('server.replyingTo', { name: message.replyTo.authorName || t('chat.guest') })));
    if (message.replyTo.text) quote.append(el('span', '', message.replyTo.text));
    bubble.append(quote);
  }
  if (message.forwardedFrom) {
    const forwardLabel = el('div', 'server-forward-label', t('server.forwardedFrom', {
      name: message.forwardedFrom.authorName || t('chat.guest'),
      channel: message.forwardedFrom.channelName || ''
    }));
    bubble.append(forwardLabel);
    if (message.forwardedFrom.text) {
      const forwardedText = el('p', 'message-text');
      renderMessageText(forwardedText, message.forwardedFrom.text);
      bubble.append(forwardedText);
    }
  }
  if (message.text) {
    const p = el('p', 'message-text');
    renderMessageText(p, message.text);
    bubble.append(p);
  }
  const att = renderAttachment(message.attachment || message.forwardedFrom?.attachment);
  if (att) bubble.append(att);
  body.append(bubble);
  const meta = el('div', 'message-meta');
  if (message.editedAt) meta.append(el('span', 'message-edited', t('chat.edited')));
  const copy = el('button', 'message-copy'); copy.type = 'button'; copy.title = t('chat.copy'); copy.setAttribute('aria-label', t('chat.copy'));
  copy.append(icon('i-copy'));
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(message.text || message.forwardedFrom?.text || ''); toast(t('chat.copied'), 'info', 1800); }
    catch { toast(t('chat.copyFailed'), 'error', 2800); }
  });
  meta.append(copy);
  const reply = el('button', 'message-copy message-action-btn', t('server.reply'));
  reply.type = 'button'; reply.title = t('server.reply'); reply.setAttribute('aria-label', t('server.reply'));
  reply.addEventListener('click', () => setReplyTarget(message));
  meta.append(reply);
  const forward = el('button', 'message-copy message-action-btn', t('server.forward'));
  forward.type = 'button'; forward.title = t('server.forward'); forward.setAttribute('aria-label', t('server.forward'));
  forward.addEventListener('click', () => openForwardDialog(message));
  meta.append(forward);
  if (REACTIONS.length) {
    const reactBtn = el('button', 'message-react'); reactBtn.type = 'button'; reactBtn.title = t('chat.reactTitle'); reactBtn.setAttribute('aria-label', t('chat.reactTitle'));
    reactBtn.append(customEmojiImage('smile', 'custom-emoji custom-emoji-xs'));
    reactBtn.addEventListener('click', (e) => { e.stopPropagation(); openReactionPopover(message.id, reactBtn); });
    meta.append(reactBtn);
  }
  appendReactionChips(meta, message);
  const canDeleteAny = hasPermission('manage_messages');
  if (isSelf) {
    if (!message.forwardedFrom) {
      const edit = el('button', 'message-copy'); edit.type = 'button'; edit.title = t('chat.edit'); edit.setAttribute('aria-label', t('chat.edit')); edit.append(icon('i-pencil'));
      edit.addEventListener('click', () => editMessage(message.id));
      meta.append(edit);
    }
    const del = el('button', 'message-copy'); del.type = 'button'; del.title = t('chat.delete'); del.setAttribute('aria-label', t('chat.delete')); del.append(icon('i-trash'));
    del.addEventListener('click', () => deleteMessage(message.id));
    meta.append(del);
  } else if (canDeleteAny) {
    const delAny = el('button', 'message-copy'); delAny.type = 'button'; delAny.title = t('admin.deleteAny'); delAny.setAttribute('aria-label', t('admin.deleteAny')); delAny.append(icon('i-trash'));
    delAny.addEventListener('click', () => deleteMessageAny(message.id));
    meta.append(delAny);
  }
  body.append(meta);
  article.append(avatar, body);
  return article;
}

function appendReactionChips(meta, message) {
  const reactions = message.reactions || {};
  for (const emoji of REACTIONS) {
    const ids = reactions?.[emoji];
    if (!Array.isArray(ids) || !ids.length) continue;
    const chip = el('button', 'reaction-chip');
    chip.dataset.emoji = emoji;
    chip.type = 'button';
    chip.title = ids.length === 1 ? t('chat.reactionOne') : t('chat.reactionMany', { count: ids.length });
    chip.classList.toggle('is-mine', ids.includes(state.selfMemberId));
    chip.append(customEmojiImage(emoji, 'custom-emoji custom-emoji-xs'), el('span', '', String(ids.length)));
    chip.addEventListener('click', (e) => { e.stopPropagation(); sendReaction(message.id, emoji); });
    meta.append(chip);
  }
}

async function sendReaction(messageId, emoji) {
  const response = await emitAck('server:chat:react', { channelId: state.channelId, messageId, emoji });
  if (!response?.ok && response?.error === 'invalid-reaction') toast(t('chat.reactionFailed'), 'error', 2800);
}

function openReactionPopover(messageId, anchor) {
  closeReactionPopover();
  const popover = el('div', 'reaction-popover');
  popover.setAttribute('role', 'menu');
  popover.setAttribute('aria-label', t('chat.reactTitle'));
  for (const emoji of REACTIONS) {
    const button = el('button', 'reaction-choice');
    button.type = 'button';
    button.dataset.emoji = emoji;
    button.setAttribute('aria-label', t('chat.reactWith', { emoji: `:${emoji}:` }));
    button.title = `:${emoji}:`;
    button.append(customEmojiImage(emoji, 'custom-emoji custom-emoji-sm'));
    button.addEventListener('click', () => { sendReaction(messageId, emoji); closeReactionPopover(); });
    popover.append(button);
  }
  document.body.append(popover);
  const rect = anchor.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl' || document.documentElement.lang === 'ar';
  const popW = 170;
  let left;
  if (rtl) {
    const right = window.innerWidth - rect.right - 52;
    left = Math.max(8, Math.min(rect.left - 52, window.innerWidth - popW - 8));
    popover.style.right = `${Math.max(8, right)}px`;
    popover.style.left = 'auto';
  } else {
    left = Math.min(Math.max(8, rect.left - 52), window.innerWidth - popW);
    popover.style.left = `${left}px`;
    popover.style.right = 'auto';
  }
  popover.style.top = `${Math.max(8, rect.top - 52)}px`;
  state.reactionPopover = popover;
  state.reactionPopoverAnchor = anchor;
  // A26: Escape closes via the global handler below; outside-click also closes.
  setTimeout(() => document.addEventListener('click', closeReactionPopover, { once: true }), 0);
}
function closeReactionPopover() {
  if (state.reactionPopover) { state.reactionPopover.remove(); state.reactionPopover = null; state.reactionPopoverAnchor = null; }
}

async function deleteMessageAny(messageId) {
  if (!window.confirm(t('chat.deleteConfirm'))) return;
  const response = await emitAck('server:chat:deleteAny', { channelId: state.channelId, messageId });
  if (!response?.ok) { toast(t('chat.deleteFailed'), 'error', 3600); return; }
  state.messages = state.messages.filter((m) => m.id !== messageId);
  [...els.messages.querySelectorAll('.message')].find((n) => n.dataset.messageId === messageId)?.remove();
}

function renderMessageText(container, text) {
  const value = String(text ?? '');
  for (const part of splitEmojiShortcodes(value)) {
    if (part.emoji) {
      container.append(isCustomSticker(part.emoji)
        ? customStickerImage(part.emoji, 'custom-sticker message-sticker')
        : customEmojiImage(part.emoji, 'custom-emoji message-emoji'));
      continue;
    }
    // Direct GIF links render inline (no API, no fetch).
    const chunk = String(part.text ?? '');
    const gifParts = chunk.split(/(https:\/\/\S+\.gif(?:\?\S*)?)/gi);
    if (gifParts.length === 1) {
      container.append(document.createTextNode(chunk));
    } else {
      for (const token of gifParts) {
        if (isGifUrl(token)) container.append(gifImage(token));
        else if (token) container.append(document.createTextNode(token));
      }
    }
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
  let text = els.messageInput.value.replace(/\s+$/g, '');
  if (!text.trim()) { els.messageInput.focus(); return; }
  const command = text.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (command) {
    const name = command[1].toLowerCase();
    const argument = (command[2] || '').trim();
    if (name === 'help' || name === 'commands') {
      stopTyping();
      showLocalChatNotice(t('server.commandsHelp'));
      els.messageInput.value = '';
      try { sessionStorage.removeItem(draftKey()); } catch { /* ignore */ }
      autosize();
      return;
    }
    if (name === 'clear') {
      stopTyping();
      state.messages = [];
      renderMessages();
      toast(t('server.clearLocal'), 'info', 3600);
      els.messageInput.value = '';
      try { sessionStorage.removeItem(draftKey()); } catch { /* ignore */ }
      autosize();
      return;
    }
    if (name === 'me') {
      if (!argument) { toast(t('server.commandUsage'), 'info', 3200); return; }
      text = `${state.selfName} ${argument}`;
    } else if (name === 'shrug') {
      text = [argument, '¯\\_(ツ)_/¯'].filter(Boolean).join(' ');
    } else {
      toast(t('server.unknownCommand', { command: `/${name}` }), 'error', 3200);
      return;
    }
  }
  els.messageInput.value = '';
  try { sessionStorage.removeItem(draftKey()); } catch { /* ignore */ }
  autosize();
  stopTyping();
  const response = await emitAck('server:chat:send', {
    channelId: state.channelId,
    text: text.slice(0, 2000),
    replyToId: state.replyTo?.id || ''
  });
  if (!response?.ok) {
    toast(t(response?.error === 'spam' ? 'error.spam' : 'error.sendFailed'), 'error', 4200);
    els.messageInput.value = text;
    autosize();
  } else {
    clearReply();
  }
  els.messageInput.focus();
}

function showLocalChatNotice(text) {
  const notice = el('div', 'server-command-notice', text);
  notice.setAttribute('role', 'status');
  els.messages.append(notice);
  scrollLatest('smooth');
}

function setReplyTarget(message) {
  state.replyTo = message;
  els.replyText.textContent = t('server.replyingTo', {
    name: message.authorName || t('chat.guest')
  }) + (message.text || message.forwardedFrom?.text ? ` — ${message.text || message.forwardedFrom.text}` : '');
  els.replyPreview.hidden = false;
  els.messageInput.focus();
}

function clearReply() {
  state.replyTo = null;
  if (els.replyPreview) els.replyPreview.hidden = true;
}

function openForwardDialog(message) {
  const channels = (state.server?.channels || []).filter((channel) =>
    channel.type === 'text' && channel.id !== state.channelId);
  if (!channels.length) {
    toast(t('server.forwardNoChannel'), 'info', 3200);
    return;
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'server-forward-dialog';
  const title = el('h2', '', t('server.forwardTitle'));
  const label = el('label', 'field', t('server.forwardDestination'));
  const select = document.createElement('select');
  select.className = 'server-forward-select';
  for (const channel of channels) {
    const option = document.createElement('option');
    option.value = channel.id;
    option.textContent = `# ${channel.name}`;
    select.append(option);
  }
  label.append(select);
  const actions = el('div', 'server-forward-actions');
  const cancel = el('button', 'btn btn-quiet btn-sm', t('chat.cancel'));
  cancel.type = 'button';
  const submit = el('button', 'btn btn-primary btn-sm', t('server.forward'));
  submit.type = 'button';
  actions.append(cancel, submit);
  dialog.append(title, label, actions);
  document.body.append(dialog);
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  cancel.addEventListener('click', close);
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    const result = await emitAck('server:chat:forward', {
      messageId: message.id,
      sourceChannelId: message.channelId || state.channelId,
      targetChannelId: select.value
    });
    close();
    if (!result?.ok) toast(t('server.forwardFailed'), 'error', 3600);
    else toast(t('server.forwarded'), 'info', 2400);
  });
  dialog.showModal();
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
  const channelAtStart = state.channelId;
  if (!channelAtStart) { toast(t('error.notConnected'), 'error', 3600); return; }
  const ext = `.${String(file.name).split('.').pop() || ''}`.toLowerCase();
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.pdf', '.txt', '.md', '.csv', '.zip']);
  if (!allowed.has(ext)) { toast(t('upload.unsupported'), 'error', 4200); return; }
  if (file.size > 8 * 1024 * 1024) { toast(t('upload.tooLarge'), 'error', 4200); return; }
  showHint(t('upload.uploading', { name: file.name }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const body = new FormData();
    body.append('file', file);
    body.append('channelId', channelAtStart);
    body.append('deviceId', state.deviceId);
    // channelId in the query too: multer parses the body after the
    // server auth check, so the server needs it from the query upfront.
    const url = `/api/servers/${encodeURIComponent(state.serverId)}/upload?deviceId=${encodeURIComponent(state.deviceId)}&channelId=${encodeURIComponent(channelAtStart)}`;
    const res = await fetch(url, { method: 'POST', headers: { ...authHeaders() }, body, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data?.error || 'upload-failed';
      if (err === 'unsupported-file-type') toast(t('upload.unsupported'), 'error', 4200);
      else if (err === 'limit_file_size') toast(t('upload.tooLarge'), 'error', 4200);
      else if (err === 'upload-quota-exceeded') toast(t('upload.quota'), 'error', 4200);
      else if (err === 'not-member') toast(t('server.notMember'), 'error', 4200);
      else if (err === 'channel-not-found') toast(t('server.noChannels'), 'error', 4200);
      else toast(t('upload.failed'), 'error', 4200);
      return;
    }
    // Send into the channel the upload started in, even if the user
    // switched channels while it was uploading.
    const targetChannel = channelAtStart;
    const response = await emitAck('server:chat:send', { channelId: targetChannel, text: '', attachment: data });
    if (!response?.ok) throw new Error('send-failed');
    if (targetChannel === state.channelId) {
      // The socket relay only echoes to the current channel view; the
      // sender's own view appends through the relay — keep scroll fresh.
      scrollLatest('smooth');
    } else {
      toast(t('upload.sentToChannel', { name: state.server?.channels.find((c) => c.id === targetChannel)?.name || '' }), 'info', 3200);
    }
  } catch (error) {
    if (error?.name === 'AbortError') toast(t('error.serverNoResponse'), 'error', 4200);
    else toast(t('upload.failed'), 'error', 4200);
  } finally {
    clearTimeout(timeout);
    showHint('');
  }
}

/* ---------------- Lightbox ---------------- */

let lightboxReturnFocus = null;
function openImageLightbox(url, name) {
  const safe = safeAttachmentUrl(url);
  if (!safe || !els.imageLightbox) return;
  lightboxReturnFocus = document.activeElement;
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
  if (lightboxReturnFocus && document.contains(lightboxReturnFocus)) {
    try { lightboxReturnFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
  lightboxReturnFocus = null;
}

/* ---------------- Emoji + typing ---------------- */

function buildEmojiMenu() {
  els.emojiMenu.replaceChildren();
  const search = el('input', 'emoji-search');
  search.type = 'search';
  search.placeholder = t('emoji.search');
  search.setAttribute('aria-label', t('emoji.search'));
  search.value = state.emojiQuery;
  const tabs = el('div', 'emoji-tabs');
  for (const cat of EMOJI_CATEGORIES) {
    const tab = el('button', 'emoji-tab', cat.id === 'recent' ? t('emoji.recent') : cat.id === 'all' ? t('emoji.all') : t(`emoji.cat.${cat.id}`));
    tab.type = 'button';
    tab.dataset.cat = cat.id;
    tab.setAttribute('aria-pressed', String(state.emojiCat === cat.id));
    tab.addEventListener('click', () => {
      state.emojiCat = cat.id;
      for (const b of tabs.querySelectorAll('.emoji-tab')) b.setAttribute('aria-pressed', String(b === tab));
      renderEmojiGrid();
    });
    tabs.append(tab);
  }
  for (const cat of STICKER_CATEGORIES) {
    const tab = el('button', 'emoji-tab sticker-tab', locale() === 'ar' ? cat.ar : cat.en);
    tab.type = 'button';
    tab.dataset.cat = cat.id;
    tab.setAttribute('aria-pressed', String(state.emojiCat === cat.id));
    tab.addEventListener('click', () => {
      state.emojiCat = cat.id;
      for (const b of tabs.querySelectorAll('.emoji-tab')) b.setAttribute('aria-pressed', String(b === tab));
      renderEmojiGrid();
    });
    tab.title = `${cat.en} / ${cat.ar}`;
    tabs.append(tab);
  }
  const gifTab = el('button', 'emoji-tab', 'GIF');
  gifTab.type = 'button';
  gifTab.dataset.cat = 'gif';
  gifTab.setAttribute('aria-pressed', String(state.emojiCat === 'gif'));
  gifTab.addEventListener('click', () => {
    state.emojiCat = 'gif';
    for (const b of tabs.querySelectorAll('.emoji-tab')) b.setAttribute('aria-pressed', String(b === gifTab));
    renderEmojiGrid();
  });
  tabs.append(gifTab);
  const grid = el('div', 'emoji-grid');
  grid.id = 'emoji-grid';
  els.emojiMenu.setAttribute('role', 'dialog');
  els.emojiMenu.setAttribute('aria-label', t('chat.insertEmoji'));
  grid.setAttribute('role', 'listbox');
  els.emojiMenu.append(search, tabs, grid);
  search.addEventListener('input', () => { state.emojiQuery = search.value; renderEmojiGrid(); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEmojiMenu(); e.stopPropagation(); });
  renderEmojiGrid(search.value);
}
function renderEmojiGrid(query = state.emojiQuery) {
  const grid = $('#emoji-grid', els.emojiMenu);
  if (!grid) return;
  grid.replaceChildren();
  if (state.emojiCat === 'gif') {
    renderGifPanel(grid, query);
    return;
  }
  grid.classList.remove('is-panel');
  const isStickerCat = STICKER_CATEGORIES.some((c) => c.id === state.emojiCat);
  let list;
  if (isStickerCat && !query) {
    list = CUSTOM_STICKERS.filter((e) => e.cat === state.emojiCat);
  } else if (isStickerCat && query) {
    list = searchStickers(query);
  } else if (query) {
    const emojis = searchEmojis(query);
    const stickers = searchStickers(query);
    list = [...emojis.map((e) => ({ ...e, kind: 'emoji' })), ...stickers.map((e) => ({ ...e, kind: 'sticker' }))];
  } else if (state.emojiCat === 'recent') {
    const recent = getRecentEmojis();
    list = recent.map((id) => CUSTOM_EMOJIS.find((e) => e.id === id) || CUSTOM_STICKERS.find((e) => e.id === id)).filter(Boolean)
      .map((e) => ({ ...e, kind: isCustomSticker(e.id) ? 'sticker' : 'emoji' }));
    if (!list.length) {
      const empty = el('div', 'emoji-empty', t('emoji.noRecent'));
      grid.append(empty);
      return;
    }
  } else {
    list = state.emojiCat === 'all' ? CUSTOM_EMOJIS.map((e) => ({ ...e, kind: 'emoji' })) : CUSTOM_EMOJIS.filter((e) => e.cat === state.emojiCat).map((e) => ({ ...e, kind: 'emoji' }));
  }
  if (!list.length) { grid.append(el('div', 'emoji-empty', t('emoji.noResults'))); return; }
  for (const emoji of list) {
    const button = el('button', 'emoji-choice');
    button.type = 'button';
    button.dataset.emoji = emoji.id;
    const label = emoji.kind === 'sticker' ? stickerLabel(emoji.id, locale()) : emojiLabel(emoji.id, locale());
    button.title = `:${emoji.id}: — ${label}`;
    button.setAttribute('aria-label', `${label} :${emoji.id}:`);
    button.setAttribute('role', 'option');
    button.append(emoji.kind === 'sticker'
      ? customStickerImage(emoji.id, 'custom-sticker emoji-sticker')
      : customEmojiImage(emoji.id, 'custom-emoji custom-emoji-sm'));
    button.addEventListener('click', () => { insertEmoji(`:${emoji.id}:`); pushRecentEmoji(emoji.id); closeEmojiMenu(); });
    grid.append(button);
  }
}
function renderGifPanel(grid, query) {
  // v12: shared Giphy + custom-sticker panel (see gif-panel.js).
  buildGifPanel(grid, {
    query,
    t,
    toast,
    onInsert: (url) => { insertEmoji(url); closeEmojiMenu(); },
    onSendCustomSticker: async (file) => { closeEmojiMenu(); await uploadFile(file); },
    onOpenStickerCreator: () => openStickerCreator({ t, toast })
  });
}
function positionEmojiMenu() {
  if (!els.emojiMenu || !els.emojiBtn) return;
  // Fixed positioning: the stage has overflow:hidden, so an absolute
  // menu inside the composer gets clipped (empty-looking picker).
  const rect = els.emojiBtn.getBoundingClientRect();
  const menuW = Math.min(340, window.innerWidth - 24);
  const menuH = 420;
  const rtl = document.documentElement.dir === 'rtl' || document.documentElement.lang === 'ar';
  let left = rtl ? rect.right - menuW : rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
  let top = rect.top - menuH - 8;
  if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - menuH - 8);
  els.emojiMenu.style.left = `${left}px`;
  els.emojiMenu.style.right = 'auto';
  els.emojiMenu.style.top = `${Math.max(8, top)}px`;
  els.emojiMenu.style.bottom = 'auto';
}
function toggleEmojiMenu() {
  const open = els.emojiMenu.hidden;
  if (open) { closeGifMenu(); closeStickerMenu(); }
  els.emojiMenu.hidden = !open;
  if (open) positionEmojiMenu();
  els.emojiBtn?.setAttribute('aria-expanded', String(open));
}
function closeEmojiMenu() {
  if (els.emojiMenu.hidden) return;
  els.emojiMenu.hidden = true;
  els.emojiBtn?.setAttribute('aria-expanded', 'false');
}
/* Dedicated GIF + Sticker menus (v12.1) — shared builders in gif-panel.js */
function positionMenu(menu, btn, menuW = 360) {
  if (!menu || !btn) return;
  const rect = btn.getBoundingClientRect();
  const menuH = 420;
  const rtl = document.documentElement.dir === 'rtl' || document.documentElement.lang === 'ar';
  let left = rtl ? rect.right - menuW : rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
  let top = rect.top - menuH - 8;
  if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - menuH - 8);
  menu.style.left = `${left}px`;
  menu.style.right = 'auto';
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.bottom = 'auto';
}
function closeGifMenu() {
  if (!els.gifMenu || els.gifMenu.hidden) return;
  els.gifMenu.hidden = true;
  els.gifBtn?.setAttribute('aria-expanded', 'false');
}
function closeStickerMenu() {
  if (!els.stickerMenu || els.stickerMenu.hidden) return;
  els.stickerMenu.hidden = true;
  els.stickerBtn?.setAttribute('aria-expanded', 'false');
}
function toggleMenu(menu, btn, closeOthers) {
  if (!menu || !btn) return;
  const willOpen = menu.hidden;
  if (willOpen) closeOthers();
  menu.hidden = !willOpen;
  if (willOpen) positionMenu(menu, btn, Math.min(360, window.innerWidth - 24));
  btn.setAttribute('aria-expanded', String(willOpen));
}
function toggleGifMenu() { toggleMenu(els.gifMenu, els.gifBtn, () => { closeEmojiMenu(); closeStickerMenu(); }); }
function toggleStickerMenu() { toggleMenu(els.stickerMenu, els.stickerBtn, () => { closeEmojiMenu(); closeGifMenu(); }); }
function buildGifMenu() {
  if (!els.gifMenu) return;
  els.gifMenu.replaceChildren();
  const grid = el('div', 'emoji-grid is-panel');
  grid.id = 'gif-grid';
  els.gifMenu.setAttribute('role', 'dialog');
  els.gifMenu.setAttribute('aria-label', t('composer.gif'));
  els.gifMenu.append(grid);
  buildGifPanel(grid, {
    query: '', t, toast,
    onInsert: (url) => { insertEmoji(url); closeGifMenu(); },
    onSendCustomSticker: async (file) => { closeGifMenu(); await uploadFile(file); },
    onOpenStickerCreator: () => openStickerCreator({ t, toast })
  });
}
function buildStickerMenuPanel() {
  if (!els.stickerMenu) return;
  buildStickerMenu(els.stickerMenu, {
    t, toast, locale,
    onInsertSticker: (id) => { insertEmoji(`:${id}:`); pushRecentEmoji(id); closeStickerMenu(); },
    onSendCustomSticker: async (file) => { closeStickerMenu(); await uploadFile(file); },
    onOpenStickerCreator: () => openStickerCreator({ t, toast })
  });
}
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

/* ---------------- Voice (WebRTC P2P via server signaling) ---------------- */

function syncLeaveChip() {
  if (!els.leaveVoiceChip) return;
  els.leaveVoiceChip.hidden = !state.inVoice;
  if (els.leaveVoiceChipLabel) {
    const name = state.tempRoomId
      ? (state.tempRooms.find((r) => r.id === state.tempRoomId)?.name || t('server.tempRoomsTitle'))
      : (state.server?.channels.find((c) => c.id === state.voiceChannelId)?.name || '');
    els.leaveVoiceChipLabel.textContent = name ? t('server.leaveVoiceFrom', { name }) : t('control.leave');
  }
}

function enterVoiceContext({ channelId = null, tempRoomId = null, voiceChannelId = null, name = '' } = {}) {
  const resolvedChannelId = channelId ?? voiceChannelId;
  // Remember where to return when leaving voice (core of the trap fix).
  if (state.channelId) state.lastTextChannelId = state.channelId;
  state.inVoice = true;
  state.voiceChannelId = resolvedChannelId;
  state.tempRoomId = tempRoomId;
  els.voiceStage.hidden = false;
  els.stage.classList.add('is-voice');
  if (els.channelTitle) els.channelTitle.textContent = name || (resolvedChannelId ? (state.server?.channels.find((c) => c.id === resolvedChannelId)?.name || '') : '');
  if (els.channelTopic) els.channelTopic.textContent = t('server.voiceStaysOnDevice') || '';
  state.mesh?.resumeAudio();
  renderChannels();
  updateVoiceControls();
  updateScreenStage();
  syncLeaveChip();
  renderTiles();
}

async function joinVoice(channel) {
  if (state.joiningVoice) return;
  if (state.voiceChannelId === channel.id && state.inVoice) return;
  state.joiningVoice = true;
  try {
    const response = await emitAck('server:voice:join', { channelId: channel.id });
    if (!response?.ok) { toast(t('error.joinFailed'), 'error', 3600); return; }
    enterVoiceContext({ channelId: channel.id, name: channel.name });
    const result = await state.mesh.init({ mic: false, camera: false });
    if (result?.warning) toast(result.warning, 'error', 4800);
    renderTiles();
  } catch { toast(t('error.joinFailed'), 'error', 3600); }
  finally { state.joiningVoice = false; }
}
function leaveVoice() {
  if (!state.inVoice) return;
  const wasTemp = Boolean(state.tempRoomId);
  const wasChannel = state.voiceChannelId;
  const backTo = state.lastTextChannelId
    ? state.server?.channels.find((c) => c.id === state.lastTextChannelId && c.type === 'text')
    : state.server?.channels.find((c) => c.type === 'text');
  state.inVoice = false;
  state.voiceChannelId = null;
  state.tempRoomId = null;
  state.activeScreenId = null;
  state.mesh?.closeAll();
  state.mesh?.disableMic();
  state.mesh?.disableCamera();
  state.mesh?.stopScreen();
  if (wasChannel) delete state.voiceOccupancy[wasChannel];
  if (wasTemp) delete state.tempOccupancy[wasTemp];
  // Fire-and-forget server leave; UI must exit even if the ack times out.
  emitAck(wasTemp ? 'server:tempRoom:leave' : 'server:voice:leave', {}).catch(() => {});
  els.voiceStage.hidden = true;
  els.stage.classList.remove('is-voice');
  if (els.serverScreenStage) els.serverScreenStage.hidden = true;
  if (els.serverScreenVideo) els.serverScreenVideo.srcObject = null;
  syncLeaveChip();
  updateVoiceControls();
  renderChannels();
  renderTiles();
  if (backTo) {
    // Force a fresh view: if already on that channel, just reload it.
    if (state.channelId === backTo.id) { loadChannel(backTo.id); restoreDraft(); }
    else selectChannel(backTo);
  }
}
async function toggleScreen() {
  if (!state.inVoice) return;
  if (state.mesh.isOn('screen')) state.mesh.stopScreen();
  else await state.mesh.startScreen();
  updateVoiceControls();
  updatePresence();
  renderTiles();
  updateScreenStage();
}
function updateScreenStage() {
  if (!els.serverScreenStage) return;
  const sharers = [...state.online.values()].filter((p) => p.screenOn);
  if (state.mesh?.isOn('screen')) state.activeScreenId = state.selfId;
  else if (state.activeScreenId && state.activeScreenId !== state.selfId) {
    const still = sharers.find((p) => p.id === state.activeScreenId);
    if (!still) {
      const next = sharers[0];
      state.activeScreenId = next ? next.id : null;
    }
  } else if (!state.activeScreenId && sharers.length) {
    state.activeScreenId = sharers[0].id;
  }
  const id = state.activeScreenId;
  if (!id) {
    els.serverScreenStage.hidden = true;
    if (els.serverScreenVideo) els.serverScreenVideo.srcObject = null;
    if (els.serverScreenWatchBtn) els.serverScreenWatchBtn.hidden = true;
    els.serverScreenStage.classList.remove('is-enlarged');
    syncScreenEnlarge();
    syncServerScreenPip();
    return;
  }
  const stoppedWatching = state.hiddenScreenId === id;
  if (els.serverScreenWatchBtn) els.serverScreenWatchBtn.hidden = !stoppedWatching;
  if (stoppedWatching) {
    els.serverScreenStage.hidden = true;
    if (els.serverScreenVideo) els.serverScreenVideo.srcObject = null;
    syncServerScreenPip();
    return;
  }
  const stream = id === state.selfId
    ? state.mesh?.getLocalStream('screen')
    : state.mesh?.getRemoteStream(id, 'screen');
  els.serverScreenStage.hidden = false;
  if (els.serverScreenStopWatching) els.serverScreenStopWatching.hidden = id === state.selfId;
  if (els.serverScreenVideo) {
    if (stream && els.serverScreenVideo.srcObject !== stream) els.serverScreenVideo.srcObject = stream;
    if (!stream) els.serverScreenVideo.srcObject = null;
    els.serverScreenVideo.play?.().catch(() => {});
  }
  const ownerName = id === state.selfId ? state.selfName : (state.online.get(id)?.name || t('screen.someone'));
  if (els.serverScreenLabel) {
    els.serverScreenLabel.textContent = id === state.selfId
      ? t('screen.youSharing')
      : t('screen.someoneSharing', { name: ownerName });
  }
  syncServerScreenPip();
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
  const scr = state.mesh?.isOn('screen') ?? false;
  els.micBtn.setAttribute('aria-pressed', String(mic));
  els.cameraBtn.setAttribute('aria-pressed', String(cam));
  els.screenBtn?.setAttribute('aria-pressed', String(scr));
  els.micLabel.textContent = mic ? t('control.mute') : t('control.unmute');
  els.cameraLabel.textContent = cam ? t('control.stopVideo') : t('control.camera');
  if (els.screenLabelBtn) els.screenLabelBtn.textContent = scr ? t('control.stopShare') : t('control.share');
}
function updatePresence() {
  state.socket?.emit('server:presence', { micOn: state.mesh?.isOn('audio') ?? false, cameraOn: state.mesh?.isOn('camera') ?? false, screenOn: state.mesh?.isOn('screen') ?? false, deafened: state.deafened });
}

function handleMeshChange(peerId, kind) {
  if (peerId === null) {
    updateVoiceControls();
    updatePresence();
    updateScreenStage();
    return;
  }
  if (kind === 'screen') updateScreenStage();
  renderTiles();
}
function handleSpeaking(id, speaking) {
  const pid = id === 'self' ? state.selfId : id;
  if (speaking) state.speaking.add(pid); else state.speaking.delete(pid);
  for (const node of $$('.tile')) node.classList.toggle('is-speaking', speaking && node.dataset.participant === pid);
}

function renderTiles() {
  if (!els.tileGrid) return;
  // Only show people actually in THIS voice context (was: everyone online,
  // so tiles showed members from other voice channels / text).
  const currentOccupants = state.tempRoomId
    ? (state.tempOccupancy?.[state.tempRoomId] || [])
    : (state.voiceChannelId ? (state.voiceOccupancy?.[state.voiceChannelId] || []) : []);
  const occupantIds = new Set(currentOccupants.map((p) => p.id));
  const occupantNames = new Map(currentOccupants.map((p) => [p.id, p.name]));
  const ids = [state.selfId, ...[...state.online.keys()].filter((id) => {
    if (id === state.selfId) return false;
    if (!state.inVoice) return false;
    // If occupancy data exists, trust it; otherwise fall back to online.
    if (currentOccupants.length || occupantIds.size) return occupantIds.has(id);
    return true;
  })];
  els.tileGrid.replaceChildren();
  for (const id of ids) {
    const person = id === state.selfId ? { id, name: state.selfName } : { id, name: occupantNames.get(id) || state.online.get(id)?.name };
    const tile = document.createElement('div');
    tile.className = 'tile' + (id === state.selfId ? ' is-self' : '') + ` tone-${toneFor(id)}`;
    tile.dataset.participant = id;
    tile.classList.toggle('is-speaking', state.speaking.has(id));
    const onlineState = state.online.get(id);
    const micOn = id === state.selfId ? state.mesh?.isOn('audio') : onlineState?.micOn;
    const screenOn = id === state.selfId ? state.mesh?.isOn('screen') : onlineState?.screenOn;
    const video = document.createElement('video');
    video.className = 'tile-video';
    video.autoplay = true; video.playsInline = true; video.muted = true;
    const cameraOn = id === state.selfId ? state.mesh?.isOn('camera') : onlineState?.cameraOn;
    const stream = id === state.selfId ? state.mesh?.getLocalStream('camera') : state.mesh?.getRemoteStream(id, 'camera');
    const hasVideo = Boolean(cameraOn) && streamHasVideo(stream);
    tile.classList.toggle('has-video', hasVideo);
    if (hasVideo) { video.srcObject = stream; video.play?.().catch(() => {}); }
    const avatar = document.createElement('div');
    avatar.className = 'tile-avatar';
    avatar.append(el('span', '', initials(person?.name || '?')));
    const foot = document.createElement('div');
    foot.className = 'tile-foot';
    foot.append(el('span', 'tile-name', person?.name || ''));
    const badges = document.createElement('span');
    badges.className = 'tile-badges';
    badges.setAttribute('aria-hidden', 'false');
    const deafened = id === state.selfId ? state.deafened : onlineState?.deafened;
    if (deafened) {
      const b = el('span', 'tile-badge', t('deafen.on'));
      b.setAttribute('aria-label', t('deafen.on'));
      badges.append(b);
    } else if (micOn === false) {
      const b = el('span', 'tile-badge', t('chat.muted'));
      b.setAttribute('aria-label', t('chat.muted'));
      badges.append(b);
    }
    if (screenOn) {
      const b = el('span', 'tile-badge', t('chat.sharingScreen'));
      b.setAttribute('aria-label', t('chat.sharingScreen'));
      badges.append(b);
    }
    tile.append(video, avatar, foot);
    if (badges.childNodes.length) tile.append(badges);
    els.tileGrid.append(tile);
  }
}

function renderMembers() {
  if (!els.membersList) return;
  const activeId = document.activeElement?.closest?.('[data-member-key]')?.getAttribute('data-member-key') || '';
  els.membersList.replaceChildren();
  const onlineDeviceIds = new Set([...state.online.values()].map((p) => p.deviceId).filter(Boolean));
  const onlineMemberIds = new Set([...state.online.values()].map((p) => p.memberId).filter(Boolean));
  const all = new Map();
  for (const m of state.server?.members || []) {
    const key = m.memberId || m.deviceId || m.name;
    all.set(key, {
      key, memberId: m.memberId, deviceId: m.deviceId, name: m.name,
      roleIds: m.roleIds || ['member'], persistent: true, isOwner: m.isOwner, isYou: m.isYou
    });
  }
  const sorted = [...all.values()].sort((a, b) => (b.isOwner ? 1 : 0) - (a.isOwner ? 1 : 0)
    || roleRank(b) - roleRank(a) || String(a.name).localeCompare(String(b.name), locale()));
  if (!sorted.length) {
    const li = document.createElement('li');
    li.className = 'server-temp-empty';
    li.textContent = t('server.noMembers') || 'No members';
    els.membersList.append(li);
    return;
  }
  for (const member of sorted) {
    const li = document.createElement('li');
    li.className = 'person';
    const isSelf = (state.selfMemberId && member.memberId === state.selfMemberId)
      || member.isYou || (member.deviceId && member.deviceId === state.deviceId);
    const isOwnerMember = member.isOwner;
    const isOnline = isSelf || (member.memberId && onlineMemberIds.has(member.memberId)) || (member.deviceId && onlineDeviceIds.has(member.deviceId));
    li.classList.toggle('is-online', isOnline);
    const avatar = document.createElement('span');
    avatar.className = `person-avatar tone-${toneFor(member.key)}`;
    avatar.textContent = initials(member.name);
    const dot = document.createElement('span');
    dot.className = `online-dot${isOnline ? ' is-on' : ''}`;
    dot.title = isOnline ? t('server.onlineNow', { count: 1 }) : t('server.offlineNow');
    avatar.append(dot);
    const body = document.createElement('span');
    body.className = 'person-body';
    const nameRow = document.createElement('span');
    nameRow.className = 'person-name';
    nameRow.append(document.createTextNode(member.name));
    if (isOwnerMember) {
      const ownerBadge = document.createElement('span');
      ownerBadge.className = 'host-badge';
      ownerBadge.textContent = t('server.role.owner');
      nameRow.append(ownerBadge);
    } else {
      const roleIds = new Set(member.roleIds || ['member']);
      for (const role of [...(state.server?.roles || [])]
        .filter((entry) => roleIds.has(entry.id))
        .sort((a, b) => b.position - a.position)) {
        const badge = document.createElement('span');
        badge.className = 'member-role-badge';
        badge.style.setProperty('--role-color', role.color);
        badge.textContent = roleTitle(role);
        nameRow.append(badge);
      }
    }
    if (isSelf) {
      const you = document.createElement('span');
      you.className = 'person-you';
      you.textContent = t('chat.you');
      nameRow.append(you);
    }
    body.append(nameRow);
    li.append(avatar, body);
    if (canModerateMember(member) && !isSelf) {
      const kick = document.createElement('button');
      kick.type = 'button';
      kick.className = 'member-kick';
      kick.dataset.memberKey = member.key;
      kick.title = t('server.kickMember');
      kick.setAttribute('aria-label', `${t('server.kickMember')}: ${member.name}`);
      kick.append(icon('i-user-x'));
      kick.addEventListener('click', () => kickMember(member, member.name));
      li.append(kick);
    }
    if (isOwner() && !isSelf && !isOwnerMember) li.append(createMemberRoleAssignment(member));
    els.membersList.append(li);
  }
  // A41: restore focus after re-render.
  if (activeId) {
    const el = els.membersList.querySelector(`[data-member-key="${CSS.escape(activeId)}"]`);
    if (el) try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
}

function createMemberRoleAssignment(member) {
  const details = document.createElement('details');
  details.className = 'member-role-assign';
  const summary = document.createElement('summary');
  summary.textContent = t('server.roleAssign');
  details.append(summary);
  const form = document.createElement('form');
  form.className = 'member-role-form';
  const selected = new Set(member.roleIds || ['member']);
  const roles = [...(state.server?.roles || [])].sort((a, b) => b.position - a.position);
  for (const role of roles) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = role.id;
    checkbox.checked = selected.has(role.id);
    const title = document.createElement('span');
    title.textContent = roleTitle(role);
    label.append(checkbox, title);
    form.append(label);
  }
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn-quiet btn-sm';
  save.textContent = t('server.roleAssignSave');
  save.dataset.memberKey = member.key;
  form.append(save);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const roleIds = [...form.querySelectorAll('input[type="checkbox"]:checked')].map((checkbox) => checkbox.value);
    assignMemberRoles(member, roleIds);
  });
  details.append(form);
  return details;
}

async function kickMember(member, name) {
  const deviceId = typeof member === 'string' ? member : member?.deviceId;
  const memberId = typeof member === 'object' ? member?.memberId : null;
  if (!window.confirm(t('server.kickConfirm', { name }))) return;
  const response = await emitAck('server:kick', { deviceId: deviceId || '', memberId: memberId || '' });
  if (!response?.ok) { toast(t('error.generic'), 'error', 3200); return; }
  toast(t('server.kicked', { name }), 'info', 2400);
}

/* ---------------- Socket events ---------------- */

function bindSocketEvents(socket) {
  socket.on('server:chat:message', (message) => {
    if (!message?.id) return;
    maybeNotifyMention(message);
    if (message.channelId !== state.channelId) return;
    state.messages.push(message);
    removeEmptyChatState();
    els.messages.append(createMessageNode(message));
    scrollLatest('smooth');
    if (getSoundsEnabled() && !message.isOwn) playSound('message');
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
    if (!state.messages.length) renderMessages();
  });
  socket.on('server:chat:reaction', ({ channelId, messageId, reactions } = {}) => {
    if (channelId !== state.channelId || !messageId) return;
    const message = state.messages.find((m) => m.id === messageId);
    if (!message) return;
    message.reactions = reactions;
    const node = [...els.messages.querySelectorAll('.message')].find((n) => n.dataset.messageId === messageId);
    node?.replaceWith(createMessageNode(message));
  });
  socket.on('server:members:updated', ({ server } = {}) => {
    if (!server) return;
    receiveServerBroadcast(server);
    applyServerUi();
    void refreshServerSummary();
  });
  socket.on('server:kicked', () => {
    toast(t('server.youKicked'), 'error', 4200);
    setTimeout(() => {
      try { state.socket?.disconnect(); } catch { /* ignore */ }
      window.location.href = '/#servers';
    }, 1400);
  });
  socket.on('server:channels:updated', ({ server } = {}) => {
    if (!server) return;
    // Keep the channel you were in if it still exists (voice or text).
    const current = state.channelId;
    receiveServerBroadcast(server);
    applyServerUi();
    void refreshServerSummary();
    if (state.inVoice && state.voiceChannelId) {
      const vc = server.channels.find((c) => c.id === state.voiceChannelId);
      if (!vc) leaveVoice();
      else if (els.channelTitle) els.channelTitle.textContent = vc.name;
      return;
    }
    if (current) {
      const still = server.channels.find((c) => c.id === current);
      if (!still) {
        const first = server.channels.find((c) => c.type === 'text');
        if (first) { state.channelId = first.id; loadChannel(first.id); }
      } else {
        renderChannels();
      }
    }
  });
  socket.on('server:peer:joined', ({ participant } = {}) => {
    if (!participant?.id) return;
    state.online.set(participant.id, participant);
    renderMembers();
    renderTiles();
    applyServerUi();
  });
  socket.on('server:soundboard:added', ({ sound } = {}) => {
    if (!sound?.id) return;
    if (!state.customSounds.some((s) => s.id === sound.id)) state.customSounds.push(sound);
    renderSoundboardGrid();
  });
  socket.on('server:soundboard:deleted', ({ id } = {}) => {
    state.customSounds = state.customSounds.filter((s) => s.id !== id);
    renderSoundboardGrid();
  });
  socket.on('server:peer:left', ({ id, name } = {}) => {
    if (!id) return;
    state.online.delete(id);
    if (state.hiddenScreenId === id) state.hiddenScreenId = null;
    state.typingMap.delete(id);
    state.mesh?.closePeer(id);
    renderMembers();
    renderTiles();
    renderTyping([...state.typingMap.values()]);
    renderChannels();
  });
  socket.on('server:peer:updated', ({ id, name, micOn, screenOn, deafened } = {}) => {
    const existing = state.online.get(id) || { id, name };
    existing.micOn = micOn; existing.name = name || existing.name; existing.screenOn = screenOn; existing.deafened = deafened;
    state.online.set(id, existing);
    // Keep occupancy names fresh (server is source of truth, this is a hint).
    for (const [cid, list] of Object.entries(state.voiceOccupancy || {})) {
      const occ = list.find((p) => p.id === id);
      if (occ && name) occ.name = name;
    }
    for (const [rid, list] of Object.entries(state.tempOccupancy || {})) {
      const occ = list.find((p) => p.id === id);
      if (occ && name) occ.name = name;
    }
    renderTiles();
    updateScreenStage();
  });
  socket.on('server:voice:occupancy', ({ voiceOccupancy, tempOccupancy } = {}) => {
    state.voiceOccupancy = voiceOccupancy || {};
    state.tempOccupancy = tempOccupancy || {};
    renderChannels();
    renderTiles();
  });
  socket.on('server:tempRooms:updated', ({ tempRooms } = {}) => {
    state.tempRooms = Array.isArray(tempRooms) ? tempRooms : [];
    renderTempRooms();
  });
  socket.on('server:tempRoom:joined', ({ roomId, name } = {}) => {
    if (!roomId) return;
    if (!state.tempRooms.find((r) => r.id === roomId)) {
      state.tempRooms = [...(state.tempRooms || []), { id: roomId, name, creatorName: '', memberCount: 0, members: [] }];
    }
    renderTempRooms();
  });
  socket.on('server:tempRoom:deleted', ({ roomId } = {}) => {
    state.tempRooms = (state.tempRooms || []).filter((r) => r.id !== roomId);
    delete state.tempOccupancy[roomId];
    renderTempRooms();
    renderChannels();
    if (state.tempRoomId === roomId) leaveVoice();
  });
  socket.on('server:tempRoom:renamed', ({ roomId, name } = {}) => {
    const room = (state.tempRooms || []).find((r) => r.id === roomId);
    if (room) {
      room.name = name;
      renderTempRooms();
      if (state.tempRoomId === roomId && els.channelTitle) els.channelTitle.textContent = name;
    }
  });
  socket.on('server:voice:connect', ({ id } = {}) => {
    if (id && state.inVoice && id !== state.selfId) state.mesh?.connectToPeer(id);
  });
  socket.on('server:typing', ({ id, name, typing } = {}) => {
    if (id) {
      if (typing) state.typingMap.set(id, name || '?');
      else state.typingMap.delete(id);
    }
    renderTyping([...state.typingMap.values()]);
  });
  socket.on('server:soundboard:play', ({ id, custom = false, url = '', imageUrl = '', emojiId = '', name = '' } = {}) => {
    if (custom && url) { playCustomSound(url); return; }
    if (isSoundboardId(id)) playSoundboard(id);
  });
  socket.on('server:deleted', () => {
    toast(t('server.deletedNotice'), 'error', 4200);
    setTimeout(() => { window.location.href = '/'; }, 1200);
  });
}

function maybeNotifyMention(message) {
  try {
    if (message.isOwn) return;
    if (!getSettings().notifications || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
    const self = String(state.selfName || '').toLowerCase();
    const text = String(message?.text || '');
    if (!self || !text.toLowerCase().includes(`@${self}`)) return;
    new Notification(`Hush — ${state.server?.name || 'server'} · ${message.authorName || ''}`, {
      body: text.slice(0, 140),
      tag: `hush-server-mention-${message.id || Date.now()}`,
      silent: !getSoundsEnabled()
    });
  } catch (error) {
    console.warn('Desktop notification failed:', error);
  }
}

function scrollLatest(behavior) {
  requestAnimationFrame(() => {
    try { els.messages.scrollTo({ top: els.messages.scrollHeight, behavior }); }
    catch { els.messages.scrollTop = els.messages.scrollHeight; }
  });
}

/* ---------------- Soundboard (server) ---------------- */

let boardMyImageDataUrl = '';

async function loadPersonalSounds() {
  state.personalSounds = readIndex();
  renderPersonalGrid();
  const all = await listPersonalSounds();
  if (Array.isArray(all) && all.length) { state.personalSounds = all; renderPersonalGrid(); }
}

async function addPersonalSound() {
  const file = els.boardMyFile?.files?.[0];
  if (!file) { toast(t('soundboard.invalidFile'), 'error', 3600); return; }
  if (state.personalSounds.length >= MAX_PERSONAL_SOUNDS) { toast(t('soundboard.boardFull'), 'error', 3600); return; }
  if (validatePersonalAudio(file)) { toast(t('soundboard.invalidFile'), 'error', 3600); return; }
  if (els.boardMyAddBtn) els.boardMyAddBtn.disabled = true;
  try {
    const record = {
      id: (window.crypto?.randomUUID?.() || `snd-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      name: (els.boardMyName?.value || file.name.replace(/\.[^.]+$/, '')).slice(0, 40),
      emojiId: els.boardMyEmoji?.value || 'star',
      imageDataUrl: boardMyImageDataUrl || '',
      audio: file,
      mime: file.type || 'audio/mpeg',
      size: file.size,
      createdAt: Date.now()
    };
    await putPersonalSound(record);
    state.personalSounds = await listPersonalSounds();
    boardMyImageDataUrl = '';
    if (els.boardMyFile) els.boardMyFile.value = '';
    if (els.boardMyName) els.boardMyName.value = '';
    if (els.boardMyImage) els.boardMyImage.value = '';
    if (els.boardMyImagePreview) els.boardMyImagePreview.hidden = true;
    renderPersonalGrid();
    toast(t('soundboard.mySaved'), 'info', 2400);
  } catch { toast(t('error.generic'), 'error', 3600); }
  finally { if (els.boardMyAddBtn) els.boardMyAddBtn.disabled = false; }
}

function renderPersonalGrid() {
  if (!els.soundboardMyGrid) return;
  els.soundboardMyGrid.replaceChildren();
  const list = state.personalSounds || [];
  if (els.soundboardMyClear) els.soundboardMyClear.hidden = !list.length;
  for (const sound of list) {
    const wrap = el('span', 'soundboard-sound-wrap');
    const button = el('button', 'soundboard-sound is-custom');
    button.type = 'button';
    button.title = sound.name || '';
    if (sound.imageDataUrl) {
      const img = document.createElement('img');
      img.className = 'soundboard-thumb';
      img.src = sound.imageDataUrl;
      img.alt = '';
      button.append(img);
    } else {
      const face = el('span', 'soundboard-emoji');
      face.append(customEmojiImage(sound.emojiId || 'star'));
      button.append(face);
    }
    button.append(el('span', 'soundboard-name', sound.name || t('soundboard.custom')));
    button.addEventListener('click', async () => {
      let full = sound;
      try { full = (await import('./soundboard-store.js')).getPersonalSound(sound.id) || sound; } catch { /* use index copy */ }
      const url = personalBlobUrl(full);
      if (url) playBlobSound(url);
    });
    wrap.append(button);
    const share = el('button', 'btn btn-quiet btn-sm soundboard-share', t('soundboard.myShareServer'));
    share.type = 'button';
    share.title = t('soundboard.myShareServer');
    share.addEventListener('click', (event) => { event.stopPropagation(); sharePersonalSound(sound); });
    const del = el('button', 'custom-btn-delete', '×');
    del.type = 'button';
    del.title = t('soundboard.myDelete');
    del.setAttribute('aria-label', t('soundboard.myDelete'));
    del.addEventListener('click', async (event) => { event.stopPropagation(); await deletePersonalSound(sound.id); state.personalSounds = (state.personalSounds || []).filter((s) => s.id !== sound.id); renderPersonalGrid(); });
    wrap.append(share, del);
    els.soundboardMyGrid.append(wrap);
  }
}

async function sharePersonalSound(sound) {
  let full = sound;
  try { full = (await import('./soundboard-store.js')).getPersonalSound(sound.id) || sound; } catch { /* index copy */ }
  if (!full || !state.socket?.connected) { toast(t('chat.offlineUpload'), 'error', 3600); return; }
  if ((state.customSounds || []).length >= 24) { toast(t('soundboard.boardFull'), 'error', 3600); return; }
  const blob = full.audio instanceof Blob ? full.audio : new Blob([full.audio], { type: full.mime || 'audio/mpeg' });
  if (blob.size > 2 * 1024 * 1024) { toast(t('soundboard.invalidFile'), 'error', 3600); return; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const body = new FormData();
    const fileName = `${(full.name || 'sound').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 30) || 'sound'}.mp3`;
    body.append('file', new File([blob], fileName, { type: blob.type || full.mime || 'audio/mpeg' }));
    body.append('name', full.name || 'Sound');
    body.append('emojiId', full.emojiId || 'star');
    if (full.imageDataUrl) {
      const imgBlob = await (await fetch(full.imageDataUrl)).blob();
      body.append('image', new File([imgBlob], 'cover.png', { type: imgBlob.type || 'image/png' }));
    }
    const headers = { ...authHeaders(), 'X-Session-Token': state.sessionToken || '' };
    const res = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/soundboard?deviceId=${encodeURIComponent(state.deviceId)}`, { method: 'POST', body, headers, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error === 'board-full' ? 'soundboard.boardFull' : 'error.generic');
    toast(t('soundboard.myShared'), 'info', 2400);
  } catch (error) { toast(t('error.generic'), 'error', 3600); }
  finally { clearTimeout(timeout); }
}

function renderSoundboardGrid() {
  if (!els.soundboardGrid) return;
  els.soundboardGrid.replaceChildren();
  const q = state.boardQuery || '';
  const matches = (id, label) => !q || String(id).includes(q) || String(label).toLowerCase().includes(q);
  for (const cat of SOUNDBOARD_CATEGORIES) {
    const items = SOUNDBOARD_SOUNDS.filter((s) => s.cat === cat.id && matches(s.id, t(`soundboard.${s.id}`)));
    if (!items.length) continue;
    els.soundboardGrid.append(el('h4', 'soundboard-cat-title', `${cat.en} · ${cat.ar}`));
    const grid = el('div', 'soundboard-cat-grid');
    for (const sound of items) {
      const button = el('button', 'soundboard-sound');
      button.type = 'button';
      const face = el('span', 'soundboard-emoji');
      face.append(customEmojiImage(sound.emojiId));
      button.append(face, el('span', 'soundboard-name', t(`soundboard.${sound.id}`)));
      button.addEventListener('click', () => {
        playSoundboard(sound.id);
        state.socket?.emit('server:soundboard:play', { id: sound.id });
      });
      grid.append(button);
    }
    els.soundboardGrid.append(grid);
  }
  const custom = (state.customSounds || []).filter((s) => matches(String(s.id), s.name || ''));
  if (custom.length) {
    els.soundboardGrid.append(el('h4', 'soundboard-cat-title', t('soundboard.serverTitle')));
    const grid = el('div', 'soundboard-cat-grid');
    for (const sound of custom) {
      const button = el('button', 'soundboard-sound is-custom');
      button.type = 'button';
      button.title = sound.name || '';
      if (sound.imageUrl) {
        const img = document.createElement('img');
        img.className = 'soundboard-thumb';
        img.src = sound.imageUrl;
        img.alt = '';
        button.append(img);
      } else {
        const face = el('span', 'soundboard-emoji');
        face.append(customEmojiImage(sound.emojiId || 'star'));
        button.append(face);
      }
      button.append(el('span', 'soundboard-name', sound.name || t('soundboard.custom')));
      button.addEventListener('click', () => {
        if (sound.url) playCustomSound(sound.url);
        state.socket?.emit('server:soundboard:play', { id: sound.id });
      });
      grid.append(button);
    }
    els.soundboardGrid.append(grid);
  }
  if (els.soundboardVolume) els.soundboardVolume.value = String(Math.round(getSoundboardVolume() * 100));
}
function toggleSoundboard(force) {
  const open = typeof force === 'boolean' ? force : els.soundboardPanel.hidden;
  els.soundboardPanel.hidden = !open;
  els.soundboardBtn.setAttribute('aria-pressed', String(open));
  els.soundboardBtn?.setAttribute('aria-expanded', String(open));
}

function toggleDeafen(force) {
  state.deafened = typeof force === 'boolean' ? force : !state.deafened;
  state.mesh?.setDeafened(state.deafened);
  if (els.deafenBtn) {
    els.deafenBtn.setAttribute('aria-pressed', String(state.deafened));
    els.deafenBtn.classList.toggle('is-active', state.deafened);
  }
  if (els.deafenLabel) els.deafenLabel.textContent = t(state.deafened ? 'deafen.on' : 'deafen.off');
  playSound(state.deafened ? 'click' : 'success');
  updatePresence();
  renderTiles();
}

function stopWatchingScreen() {
  if (!state.activeScreenId || state.activeScreenId === state.selfId) return;
  state.hiddenScreenId = state.activeScreenId;
  updateScreenStage();
  toast(t('screen.stoppedWatching'), 'info', 2200);
}

// Enlarge = fixed overlay layer (always works, no Fullscreen API).
function toggleScreenEnlarge() {
  const stage = els.serverScreenStage;
  if (!stage || stage.hidden) return;
  stage.classList.toggle('is-enlarged');
  syncScreenEnlarge();
}

function syncScreenEnlarge() {
  const stage = els.serverScreenStage;
  if (!stage) return;
  const enlarged = stage.classList.contains('is-enlarged');
  els.serverScreenEnlarge?.setAttribute('aria-pressed', String(enlarged));
  if (els.serverScreenEnlarge) {
    els.serverScreenEnlarge.title = t(enlarged ? 'screen.shrink' : 'screen.enlarge');
    els.serverScreenEnlarge.setAttribute('aria-label', t(enlarged ? 'screen.shrink' : 'screen.enlarge'));
  }
}

function syncServerScreenPip() {
  const available =
    Boolean(els.serverScreenStage && !els.serverScreenStage.hidden) &&
    supportsPictureInPicture(els.serverScreenVideo);
  if (!els.serverScreenPip) return;
  els.serverScreenPip.hidden = !available;
  els.serverScreenPip.title = t('screen.pip');
  els.serverScreenPip.setAttribute('aria-label', t('screen.pip'));
}

async function toggleServerScreenPip() {
  if (!els.serverScreenVideo || els.serverScreenStage?.hidden) return;
  if (!supportsPictureInPicture(els.serverScreenVideo)) {
    toast(t('screen.pipUnavailable'), 'error');
    return;
  }
  const entered = await togglePictureInPicture(els.serverScreenVideo);
  els.serverScreenPip?.classList.toggle('is-active', Boolean(entered));
  if (els.serverScreenPip) {
    els.serverScreenPip.title = t(entered ? 'screen.pipExit' : 'screen.pip');
    els.serverScreenPip.setAttribute('aria-label', t(entered ? 'screen.pipExit' : 'screen.pip'));
  }
}

async function saveServerSettings() {
  const name = els.serverSettingsName?.value?.trim();
  const description = els.serverSettingsDesc?.value ?? '';
  if (!name) { els.serverSettingsName?.focus(); return; }
  if (els.serverSettingsSave) els.serverSettingsSave.disabled = true;
  try {
    const headers = { 'Content-Type': 'application/json', ...authHeaders() };
    const res = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ deviceId: state.deviceId, name, description })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.server) throw new Error(data.error || 'save-failed');
    state.server = data.server;
    // Image upload is a separate owner-only endpoint (file <= 2MB).
    const file = els.serverSettingsIcon?.files?.[0];
    if (file) {
      const form = new FormData();
      form.append('file', file);
      const iconRes = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}/icon?deviceId=${encodeURIComponent(state.deviceId)}`, { method: 'POST', body: form, headers: { ...authHeaders() } });
      const iconData = await iconRes.json().catch(() => ({}));
      if (!iconRes.ok || !iconData.server) throw new Error(iconData.error || 'icon-failed');
      state.server = iconData.server;
      if (els.serverSettingsIcon) els.serverSettingsIcon.value = '';
    }
    applyServerUi();
    toast(t('server.settingsSaved'), 'info', 2400);
  } catch { toast(t('error.generic'), 'error', 3600); }
  finally { if (els.serverSettingsSave) els.serverSettingsSave.disabled = false; }
}

async function removeServerIcon() {
  try {
    const headers = { 'Content-Type': 'application/json', ...authHeaders() };
    const res = await fetch(`/api/servers/${encodeURIComponent(state.serverId)}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ deviceId: state.deviceId, iconUrl: '' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.server) throw new Error(data.error || 'save-failed');
    state.server = data.server;
    applyServerUi();
    toast(t('server.settingsSaved'), 'info', 2400);
  } catch { toast(t('error.generic'), 'error', 3600); }
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
  while (els.toasts.children.length >= 3) els.toasts.firstChild?.remove();
  const node = el('div', `toast${variant === 'error' ? ' is-error' : ''}`, message);
  if (variant === 'error') node.setAttribute('role', 'alert');
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
  updateServerDrawerUi();
  if (state.server) applyServerUi();
  renderMessages();
  renderSoundboardGrid();
  buildEmojiMenu();
  if (els.gifMenu) buildGifMenu();
  if (els.stickerMenu) buildStickerMenuPanel();
  updateNameCount();
  for (const [btn, key] of [[els.gifBtn, 'composer.gifTitle'], [els.stickerBtn, 'composer.stickerTitle']]) {
    if (btn) { btn.title = t(key); btn.setAttribute('aria-label', t(key)); }
  }
  els.channelTopic && (els.channelTopic.textContent = t('server.permanent'));
  if (els.deafenLabel) els.deafenLabel.textContent = t(state.deafened ? 'deafen.on' : 'deafen.off');
  if (els.soundboardSearch) els.soundboardSearch.placeholder = t('soundboard.search');
  if (els.soundboardMyTitle) els.soundboardMyTitle.textContent = t('soundboard.myTitle');
  if (els.soundboardMyNote) els.soundboardMyNote.textContent = t('soundboard.myNote');
  if (els.serverScreenStopLabel) els.serverScreenStopLabel.textContent = t('screen.stopWatching');
  if (els.serverScreenWatchLabel) els.serverScreenWatchLabel.textContent = t('screen.watchAgain');
  document.title = state.server ? `${state.server.name} — Hush` : 'Server — Hush';
}
