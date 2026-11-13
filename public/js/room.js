import { MediaMesh, streamHasVideo } from './room/media.js';
import { MIC_PRESETS, DEFAULT_MIC_SETTINGS } from './room/mic-fx.js';
import { initI18n, onLanguageChange, t, locale } from './i18n.js';
import { initTheme, toggleTheme } from './theme.js';
import { startPing, refreshPing } from './ping.js';
import { initSettings, getSettings, updateSettings, registerVolumeSink } from './settings.js';
import { SOUNDBOARD_SOUNDS, SOUNDBOARD_CATEGORIES, playSoundboard, playCustomSound, playBlobSound, getSoundboardVolume, setSoundboardVolume, isSoundboardId, soundboardEmojiId } from './soundboard.js';
import { listPersonalSounds, putPersonalSound, deletePersonalSound, clearPersonalSounds, readIndex, personalBlobUrl, imageFileToDataUrl, validatePersonalAudio, MAX_PERSONAL_SOUNDS } from './soundboard-store.js';
import { CUSTOM_EMOJIS, CUSTOM_STICKERS, STICKER_CATEGORIES, EMOJI_CATEGORIES, customEmojiImage, customStickerImage, isCustomSticker, isGifUrl, gifImage, isCustomEmoji, emojiUrl, splitEmojiShortcodes, preloadCustomEmojis, pushRecentEmoji, getRecentEmojis, searchEmojis, searchStickers, isEmojiOnlyMessage, emojiLabel, stickerLabel } from './emoji.js';
import { buildGifPanel, buildStickerMenu, setStickerMenuDeps, openStickerCreator } from './gif-panel.js';
setStickerMenuDeps({ CUSTOM_STICKERS, STICKER_CATEGORIES, customStickerImage, searchStickers, stickerLabel });
import { playSound, getSoundsEnabled, setSoundsEnabled, getSoundVolume, setSoundVolume } from './sounds.js';
import { initChangelog } from './changelog.js';
import { initLibraries } from './libraries-log.js';
import { initFeedback } from './feedback.js';
import { animateDiceRoll } from './dice-password.js';
import {
  initViewportVars,
  initWakeLock,
  setWakeLock,
  haptic,
  shareUrl,
  canNativeShare,
  bindSheetDrag,
  bindTabSwipe,
  supportsPictureInPicture,
  togglePictureInPicture
} from './mobile.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Only custom Hush emojis (public/emoji/) — no Unicode/global emojis.
const REACTIONS = ['thumbsup', 'heart', 'laugh', 'tada', 'eyes', 'applause', 'fire', 'check'];
const EMOJIS = CUSTOM_EMOJIS.map((e) => e.id);
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
  '.pdf', '.txt', '.md', '.csv', '.zip'
]);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const CODE_RE = /^[A-Z0-9]{4,12}$/;
const PHONE_LAYOUT_QUERY = '(max-width: 700px)';
const NAME_KEY = 'hush:name';
const SOUND_KEY = 'hush:sounds';
const DEVICE_KEY = 'hush:device';
const ROOM_PASSWORD_MIN = 4;
const ROOM_PASSWORD_MAX = 128;
const ROOM_NAME_MAX = 60;
// Device icons (phone / pc / tablet) shown next to names everywhere.
const DEVICE_ICONS = { phone: 'i-phone', pc: 'i-pc', tablet: 'i-tablet' };

// Screen-share zoom/pan (wheel, pinch, drag, buttons, double-click).
const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 1.25;
const screenZoom = { scale: 1, x: 0, y: 0 };

function getOrCreateDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[a-zA-Z0-9-]{8,64}$/.test(id)) {
      id = (window.crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

// Per-peer voice volumes survive reloads per room (keyed by socket id AND
// by name, since socket ids change on reconnect but names usually don't).
function volumeStoreKey() { return `hush:volumes:${state.code || 'room'}`; }
function loadPeerVolumes() {
  try {
    const raw = localStorage.getItem(volumeStoreKey());
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) {
        const volume = Math.min(2, Math.max(0, Number(value) || 0));
        state.peerVolumes.set(key, volume);
      }
    }
  } catch { /* ignore */ }
}
function savePeerVolumes() {
  try {
    localStorage.setItem(volumeStoreKey(), JSON.stringify([...state.peerVolumes]));
  } catch { /* ignore */ }
}
function getPeerVolume(participant) {
  if (!participant) return 1;
  if (state.peerVolumes.has(participant.id)) return state.peerVolumes.get(participant.id);
  const byName = state.peerVolumes.get(`name:${participant.name}`);
  return byName !== undefined ? byName : 1;
}
function setPeerVolume(participant, value) {
  if (!participant) return 1;
  const volume = Math.min(2, Math.max(0, Number(value) || 0));
  state.peerVolumes.set(participant.id, volume);
  // Also remember by name so the setting survives a reconnect (new id).
  state.peerVolumes.set(`name:${participant.name}`, volume);
  savePeerVolumes();
  state.mesh?.setPeerVolume(participant.id, volume);
  renderPeople();
  renderTiles();
  return volume;
}
function applySavedPeerVolumes() {
  for (const participant of state.participants.values()) {
    if (participant.id === state.selfId) continue;
    const volume = getPeerVolume(participant);
    if (volume !== 1) state.peerVolumes.set(participant.id, volume);
    state.mesh?.setPeerVolume(participant.id, volume);
  }
}

/* ---------------- Device type + password helpers ---------------- */

// Best-effort client classification; the server whitelists the value
// (phone | pc | tablet) before storing it on the participant.
function detectDeviceType() {
  const ua = navigator.userAgent || '';
  const touchPoints = navigator.maxTouchPoints ?? 0;
  if (/iPhone|iPod|Windows Phone|IEMobile/i.test(ua)) return 'phone';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'phone' : 'tablet';
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua)) return 'tablet';
  // iPadOS 13+ pretends to be desktop Safari — it is the only "Mac" with
  // multi-touch, so use that to unmask it.
  if (/Macintosh/i.test(ua) && touchPoints > 1) return 'tablet';
  return 'pc';
}

// Small labeled icon (title/aria-label) shown next to a person's name.
function deviceBadge(type, className = 'device-badge') {
  const key = DEVICE_ICONS[type] ? type : 'pc';
  const node = el('span', className);
  node.title = t(`device.${key}`);
  node.setAttribute('aria-label', t(`device.${key}`));
  node.append(icon(DEVICE_ICONS[key]));
  return node;
}

// Remembered room password — entering it once must survive a page refresh
// on this device (per room). Stored raw client-side, verified server-side.
function roomPassKey() { return `hush:roompass:${state.code || 'room'}`; }
function getStoredRoomPassword() {
  try { return localStorage.getItem(roomPassKey()) || ''; } catch { return ''; }
}
function saveRoomPassword(password) {
  try {
    if (password) localStorage.setItem(roomPassKey(), password);
    else localStorage.removeItem(roomPassKey());
  } catch { /* storage may be blocked; joining still works */ }
}
function forgetRoomPassword() { saveRoomPassword(''); }

// Passwords sent to the server are trimmed the same way the server trims
// them, so the remembered value always matches what was verified.
function normalizeRoomPassword(value) {
  return String(value ?? '').trim();
}

function validRoomPassword(value) {
  const password = normalizeRoomPassword(value);
  return password.length >= ROOM_PASSWORD_MIN && password.length <= ROOM_PASSWORD_MAX;
}

const els = {
  gate: $('#join-gate'),
  joinForm: $('#join-form'),
  joinBtn: $('#join-btn'),
  joinError: $('#join-error'),
  nameInput: $('#name-input'),
  joinMic: $('#join-mic'),
  joinCam: $('#join-cam'),
  gateCode: $('#gate-code'),
  roomCode: $('#room-code'),
  inviteCode: $('#invite-code'),
  copyCode: $('#copy-code'),
  inviteBtn: $('#invite-btn'),
  inviteCopy: $('#invite-copy'),
  inviteShare: $('#invite-share'),
  barMenuBtn: $('#bar-menu-btn'),
  barMenu: $('#bar-menu'),
  status: $('#connection-status'),
  statusLabel: $('#connection-label'),
  stage: $('#stage'),
  stageTitle: $('#stage-title'),
  stageCount: $('#stage-count'),
  tileGrid: $('#tile-grid'),
  screenStage: $('#screen-stage'),
  screenVideo: $('#screen-video'),
  screenLabel: $('#screen-label'),
  screenPlaceholder: $('#screen-placeholder'),
  micBtn: $('#mic-btn'),
  micLabel: $('#mic-label'),
  cameraBtn: $('#camera-btn'),
  cameraLabel: $('#camera-label'),
  screenBtn: $('#screen-btn'),
  screenBtnLabel: $('#screen-label-btn'),
  handBtn: $('#hand-btn'),
  reactionBtn: $('#reaction-btn'),
  reactionMenu: $('#reaction-menu'),
  reactionLayer: $('#reaction-layer'),
  leaveBtn: $('#leave-btn'),
  leaveTop: $('#leave-btn-top'),
  moreBtn: $('#more-btn'),
  moreLabel: $('#more-label'),
  moreSheet: $('#more-sheet'),
  moreScrim: $('#more-scrim'),
  moreClose: $('#more-close'),
  moreTitle: $('#more-title'),
  moreReactions: $('#more-reactions'),
  moreHandLabel: $('#more-hand-label'),
  moreBoardLabel: $('#more-board-label'),
  moreDeafenLabel: $('#more-deafen-label'),
  moreFlipLabel: $('#more-flip-label'),
  moreFlipBtn: $('#more-flip'),
  morePipBtn: $('#more-pip'),
  morePipLabel: $('#more-pip-label'),
  moreInviteLabel: $('#more-invite-label'),
  moreMicLabel: $('#more-mic-label'),
  tabChat: $('#tab-chat'),
  tabPeople: $('#tab-people'),
  sidePanel: $('#side-panel'),
  chatFab: $('#chat-fab'),
  chatFabLabel: $('#chat-fab-label'),
  chatFabBadge: $('#chat-fab-badge'),
  sheetClose: $('#sheet-close'),
  sheetScrim: $('#sheet-scrim'),
  panelChat: $('#panel-chat'),
  panelPeople: $('#panel-people'),
  unreadBadge: $('#unread-badge'),
  peopleCount: $('#people-count'),
  messages: $('#messages'),
  jumpLatest: $('#jump-latest'),
  typing: $('#typing'),
  composer: $('#composer'),
  messageInput: $('#message-input'),
  attachBtn: $('#attach-btn'),
  fileInput: $('#file-input'),
  composerHint: $('#composer-hint'),
  peopleList: $('#people-list'),
  toasts: $('#toasts'),
  remoteAudio: $('#remote-audio'),
  chatSearch: $('#chat-search'),
  chatSearchInput: $('#chat-search-input'),
  chatSearchCount: $('#chat-search-count'),
  chatSearchClear: $('#chat-search-clear'),
  chatEmpty: $('#chat-empty'),
  saveChat: $('#save-chat'),
  soundToggle: $('#sound-toggle'),
  soundLabel: $('#sound-label'),
  shortcutsBtn: $('#shortcuts-btn'),
  shortcutsDialog: $('#shortcuts-dialog'),
  shortcutsClose: $('#shortcuts-close'),
  focusSearch: $('#focus-search'),
  micSettingsBtn: $('#mic-settings-btn'),
  micDialog: $('#mic-dialog'),
  micClose: $('#mic-close'),
  micDone: $('#mic-done'),
  micLead: $('#mic-lead'),
  micPreset: $('#mic-preset'),
  micDevice: $('#mic-device'),
  micAmp: $('#mic-amp'),
  micAmpValue: $('#mic-amp-value'),
  micGateThreshold: $('#mic-gate-threshold'),
  micGateThresholdValue: $('#mic-gate-threshold-value'),
  micDeDistort: $('#mic-de-distort'),
  micDeDistortValue: $('#mic-de-distort-value'),
  micEnhanceStrength: $('#mic-enhance-strength'),
  micEnhanceStrengthValue: $('#mic-enhance-strength-value'),
  micEnhance: $('#mic-enhance'),
  micEnhanceNote: $('#mic-enhance-note'),
  micEnabled: $('#mic-enabled'),
  micEnabledNote: $('#mic-enabled-note'),
  micGate: $('#mic-gate'),
  micNoise: $('#mic-noise'),
  micEcho: $('#mic-echo'),
  micAgc: $('#mic-agc'),
  micMonitor: $('#mic-monitor'),
  micMonitorWarn: $('#mic-monitor-warn'),
  micQuality: $('#mic-quality'),
  micReset: $('#mic-reset'),
  micMeterFill: $('#mic-meter-fill'),
  micGateState: $('#mic-gate-state'),
  sessionTimer: $('#session-timer'),
  sessionTime: $('#session-time'),
  pinnedBar: $('#pinned-bar'),
  pinnedText: $('#pinned-text'),
  pinnedClear: $('#pinned-clear'),
  emojiBtn: $('#emoji-btn'),
  emojiMenu: $('#emoji-menu'),
  gifBtn: $('#gif-btn'),
  gifMenu: $('#gif-menu'),
  stickerBtn: $('#sticker-btn'),
  stickerMenu: $('#sticker-menu'),
  nameCount: $('#name-count'),
  focusToggle: $('#focus-toggle'),
  focusModeBtn: $('#focus-mode-btn'),
  notificationsToggle: $('#notifications-toggle'),
  shell: $('#room-shell'),
  ctxMenu: $('#ctx-menu'),
  soundVolume: $('#sound-volume'),
  soundTest: $('#sound-test'),
  soundboardBtn: $('#soundboard-btn'),
  soundboardLabel: $('#soundboard-label'),
  soundboardPanel: $('#soundboard-panel'),
  soundboardTitle: $('#soundboard-title'),
  soundboardGrid: $('#soundboard-grid'),
  soundboardVolume: $('#soundboard-volume'),
  soundboardClose: $('#soundboard-close'),
  deafenBtn: $('#deafen-btn'),
  deafenLabel: $('#deafen-label'),
  boardAddForm: $('#board-add-form'),
  boardAddTitle: $('#board-add-title'),
  boardFile: $('#board-file'),
  boardName: $('#board-name'),
  boardEmoji: $('#board-emoji'),
  boardAddBtn: $('#board-add-btn'),
  boardClearBtn: $('#board-clear-btn'),
  boardAddNote: $('#board-add-note'),
  boardImage: $('#board-image'),
  boardImagePreview: $('#board-image-preview'),
  soundboardSearch: $('#soundboard-search'),
  soundboardMyTitle: $('#soundboard-my-title'),
  soundboardMyNote: $('#soundboard-my-note'),
  soundboardMyGrid: $('#soundboard-my-grid'),
  soundboardMyClear: $('#soundboard-my-clear'),
  boardMyForm: $('#board-my-form'),
  boardMyTitle: $('#board-my-title'),
  boardMyFile: $('#board-my-file'),
  boardMyName: $('#board-my-name'),
  boardMyImage: $('#board-my-image'),
  boardMyImagePreview: $('#board-my-image-preview'),
  boardMyEmoji: $('#board-my-emoji'),
  boardMyAddBtn: $('#board-my-add-btn'),
  boardMyNote: $('#board-my-note'),
  screenStopWatching: $('#screen-stop-watching'),
  screenStopLabel: $('#screen-stop-label'),
  screenEnlarge: $('#screen-enlarge'),
  screenPip: $('#screen-pip'),
  screenZoomBar: $('#screen-zoom-bar'),
  screenZoomIn: $('#screen-zoom-in'),
  screenZoomOut: $('#screen-zoom-out'),
  screenZoomReset: $('#screen-zoom-reset'),
  screenZoomLevel: $('#screen-zoom-level'),
  screenWatchBtn: $('#screen-watch-btn'),
  screenWatchLabel: $('#screen-watch-label'),
  joinPasswordField: $('#join-password-field'),
  joinPassword: $('#join-password'),
  joinPasswordToggle: $('#join-password-toggle'),
  joinPasswordHint: $('#join-password-hint'),
  roomSettingsBtn: $('#room-settings-btn'),
  roomSettingsBtnLabel: $('#room-settings-btn-label'),
  roomSettingsDialog: $('#room-settings-dialog'),
  roomSettingsClose: $('#room-settings-close'),
  roomSettingsCancel: $('#room-settings-cancel'),
  roomSettingsSave: $('#room-settings-save'),
  roomSettingsError: $('#room-settings-error'),
  roomSettingsLead: $('#room-settings-lead'),
  roomSettingsTitle: $('#room-settings-title'),
  roomNameLabel: $('#room-name-label'),
  roomNameInput: $('#room-name-input'),
  roomNameHint: $('#room-name-hint'),
  roomPasswordLabel: $('#room-password-label'),
  roomPasswordInput: $('#room-password-input'),
  roomPasswordHint: $('#room-password-hint'),
  roomPasswordToggle: $('#room-password-toggle'),
  roomDiceBtn: $('#room-dice-btn'),
  imageLightbox: $('#image-lightbox'),
  imageLightboxBackdrop: $('#image-lightbox-backdrop'),
  imageLightboxImg: $('#image-lightbox-img'),
  imageLightboxCaption: $('#image-lightbox-caption'),
  imageLightboxDownload: $('#image-lightbox-download'),
  imageLightboxClose: $('#image-lightbox-close'),
};

const state = {
  code: parseRoomCode(),
  socket: null,
  mesh: null,
  selfId: null,
  selfName: '',
  participants: new Map(),
  messages: [],
  media: { mic: false, camera: false, screen: false },
  handRaised: false,
  joinPayload: null,
  joining: false,
  joiningOnce: false,
  reconnecting: false,
  activeTab: 'chat',
  sheetOpen: false, // phone layout: chat/people bottom sheet visibility
  activeScreenId: null,
  unread: 0,
  lastDay: null,
  speaking: new Set(),
  typingUsers: new Map(),
  typingActive: false,
  typingTimer: null,
  reactionPopover: null,
  closeReactionPopover: null,
  online: false,
  searchQuery: '',
  soundsOn: true,
  audioCtx: null,
  joinErrorKey: null,
  statusMode: 'connecting',
  statusKey: 'status.joining',
  micMeterTimer: null,
  joinedAt: null,
  sessionTimerId: null,
  focusMode: false,
  pinnedMessageId: null,
  hostId: null,
  isHost: false,
  deviceId: getOrCreateDeviceId(),
  peerVolumes: new Map(), // participantId -> 0..2 (0=mute, 1=100%, 2=200%)
  deafened: false,
  soundboardOpen: false,
  boardCooldownUntil: 0,
  customSounds: [], // this room's uploaded sounds (deleted when room empties)
  personalSounds: [], // IndexedDB sounds on this device only
  boardQuery: '',
  hiddenScreenId: null, // screen id the user stopped watching (Discord-style)
  roomName: '', // optional host-set room name (falls back to the code)
  roomHasPassword: false, // server truth, refreshed on join/password-changed
  roomPasswordTouched: false, // host typed in the password field of the dialog
  deviceType: detectDeviceType(), // 'phone' | 'pc' | 'tablet' (sent on join)
};

initI18n();
initTheme();
initSettings();
initViewportVars();
initWakeLock();
// Settings owns the master-volume value; the mesh owns the actual gains
// (including deafen). Forwarding here keeps deafen in sync with the slider.
registerVolumeSink((volume) => state.mesh?.setMasterVolume(volume));
initChangelog();
initLibraries();
initFeedback();
startPing({ socketGetter: () => state.socket });
onLanguageChange(handleLanguageChange);
try {
  init();
} catch (error) {
  // Never leave the join gate dead: surface the failure and keep the form usable.
  console.error('Hush room init failed', error);
  try { showJoinError('error.generic'); } catch {}
  try { els.joinBtn.disabled = false; } catch {}
}

/* ---------------- Boot & join ---------------- */

function init() {
  try { document.querySelector('#room-shell')?.setAttribute('inert', ''); } catch { /* ignore */ }
  state.soundsOn = getSoundsEnabled();
  if (els.soundVolume) els.soundVolume.value = String(Math.round(getSoundVolume() * 100));
  if (els.soundboardVolume) els.soundboardVolume.value = String(Math.round(getSoundboardVolume() * 100));
  loadPeerVolumes();
  const formatted = formatCode(state.code);
  els.gateCode.textContent = formatted || '—';
  els.roomCode.textContent = formatted || '—';
  els.inviteCode.textContent = formatted || '—';

  let savedName = '';
  try {
    savedName = localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    savedName = '';
  }
  if (savedName) els.nameInput.value = savedName;

  if (!state.code || !CODE_RE.test(state.code)) {
    showJoinError('error.invalidLink');
    els.joinBtn.disabled = true;
    els.nameInput.disabled = true;
  }

  // Restore a saved draft for this room.
  try {
    const draft = localStorage.getItem(`hush:draft:${state.code}`);
    if (draft && els.messageInput) {
      els.messageInput.value = draft;
      autosizeInput();
    }
  } catch {
    // Drafts are a nicety; ignore blocked storage.
  }

  bindEvents();
  applyStatusLabel();
  updateDocumentTitle();
  updateSoundUi();
  renderSoundboardLabels();
  preloadCustomEmojis();
  updateDropLabel();
  updateSearchUi();
  updateChatEmpty(0);
  updateZoomLabels();
  void prefetchRoomInfo();
  setTimeout(() => els.nameInput.focus(), 120);
}

// Ask the server whether this room needs a password (and its name) before
// the user types anything, so the gate can show the password field early
// and prefill the remembered value. Join still re-validates everything.
async function prefetchRoomInfo() {
  if (!state.code || !CODE_RE.test(state.code)) return;
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(state.code)}`);
    if (!response.ok) return;
    const data = await response.json().catch(() => null);
    if (!data?.exists) return;
    state.roomName = data.name || '';
    state.roomHasPassword = Boolean(data.passwordRequired);
    if (state.roomHasPassword) {
      els.joinPasswordField.hidden = false;
      const stored = getStoredRoomPassword();
      if (stored) els.joinPassword.value = stored;
      renderJoinGateLabels();
    }
  } catch {
    // Offline / blocked — the join flow surfaces password errors itself.
  }
}

function startSessionTimer() {
  if (state.sessionTimerId) return;
  state.joinedAt = Date.now();
  const tick = () => {
    if (!state.joinedAt || !els.sessionTime) return;
    const seconds = Math.floor((Date.now() - state.joinedAt) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    const hh = Math.floor(seconds / 3600);
    els.sessionTime.textContent = hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
  };
  tick();
  if (els.sessionTimer) els.sessionTimer.hidden = false;
  state.sessionTimerId = setInterval(tick, 1000);
}

function toggleFocusMode(force) {
  state.focusMode = typeof force === 'boolean' ? force : !state.focusMode;
  els.shell?.classList.toggle('is-focus', state.focusMode);
  if (els.focusToggle) {
    els.focusToggle.classList.toggle('is-active', state.focusMode);
    els.focusToggle.setAttribute('aria-pressed', String(state.focusMode));
  }
  if (els.focusModeBtn) els.focusModeBtn.setAttribute('aria-pressed', String(state.focusMode));
}

function parseRoomCode() {
  const match = window.location.pathname.match(/^\/r\/([^/?#]+)\/?$/i);
  if (!match) return '';
  return match[1].toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatCode(code) {
  if (!code) return '';
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

function updateNameCount() {
  if (!els.nameCount || !els.nameInput) return;
  els.nameCount.textContent = t('name.count', { count: String(els.nameInput.value.length) });
}

function bindEvents() {
  els.joinForm.addEventListener('submit', joinRoom);
  els.nameInput?.addEventListener('input', updateNameCount);
  updateNameCount();

  els.micBtn.addEventListener('click', toggleMic);
  els.cameraBtn.addEventListener('click', toggleCamera);
  els.screenBtn.addEventListener('click', toggleScreen);
  els.handBtn.addEventListener('click', toggleHand);
  els.leaveBtn.addEventListener('click', leaveRoom);
  els.leaveTop.addEventListener('click', leaveRoom);

  els.copyCode.addEventListener('click', copyInvite);
  els.inviteBtn.addEventListener('click', copyInvite);
  els.inviteCopy.addEventListener('click', copyInvite);
  els.inviteShare?.addEventListener('click', shareInvite);
  bindPhoneMenus();

  els.tabChat.addEventListener('click', () => switchTab('chat'));
  els.tabPeople.addEventListener('click', () => switchTab('people'));
  els.chatFab?.addEventListener('click', () => {
    if (state.sheetOpen && state.activeTab === 'chat') closeSheet();
    else { switchTab('chat'); openSheet(); }
  });
  els.sheetClose?.addEventListener('click', closeSheet);
  els.sheetScrim?.addEventListener('click', closeSheet);
  // Leaving the phone layout (rotate / resize to desktop): drop sheet state
  // so the sidebar returns to its docked position cleanly.
  window.matchMedia?.(PHONE_LAYOUT_QUERY)?.addEventListener?.('change', (event) => {
    if (!event.matches) closeSheet();
  });
  // Mobile browser chrome appearing/disappearing changes the visual viewport;
  // mobile.js publishes --app-vh, so just keep the PiP availability honest.
  window.visualViewport?.addEventListener?.('resize', () => syncScreenPip());
  els.focusToggle?.addEventListener('click', () => toggleFocusMode());
  els.focusModeBtn?.addEventListener('click', () => toggleFocusMode());
  els.pinnedClear?.addEventListener('click', unpinMessage);
  els.pinnedText?.addEventListener('click', jumpToPinned);
  els.emojiBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleEmojiMenu();
  });
  els.gifBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleGifMenu();
  });
  els.stickerBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleStickerMenu();
  });
  if (els.emojiMenu) {
    buildRoomEmojiMenu();
  }
  if (els.gifMenu) buildGifMenu();
  if (els.stickerMenu) buildStickerMenuPanel();

  els.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    sendFromComposer();
  });

  els.messageInput.addEventListener('input', handleDraftInput);
  els.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendFromComposer();
    }
  });

  els.attachBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    els.fileInput.value = '';
    if (file) uploadFile(file);
  });

  // Paste (Ctrl+V): an image in the clipboard uploads straight into chat.
  document.addEventListener('paste', handlePasteImage);
  els.messageInput?.addEventListener('paste', handlePasteImage);

  // In-page image lightbox — never a new tab, so the call never drops/reconnects.
  els.imageLightboxClose?.addEventListener('click', closeImageLightbox);
  els.imageLightboxBackdrop?.addEventListener('click', closeImageLightbox);
  els.imageLightbox?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeImageLightbox();
  });

  els.jumpLatest.addEventListener('click', () => {
    scrollToLatest();
    setUnread(0);
  });

  if (els.chatSearchInput) {
    els.chatSearchInput.addEventListener('input', () => {
      state.searchQuery = els.chatSearchInput.value;
      renderMessages();
    });
    els.chatSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        clearSearch();
      }
    });
  }

  els.chatSearchClear?.addEventListener('click', clearSearch);
  els.focusSearch?.addEventListener('click', focusSearch);
  els.saveChat?.addEventListener('click', saveTranscript);
  els.soundToggle?.addEventListener('click', toggleSounds);
  els.soundVolume?.addEventListener('input', () => setSoundVolume(Number(els.soundVolume.value) / 100));
  els.soundTest?.addEventListener('click', () => playSound('success', { force: true }));
  // Soundboard + deafen
  els.soundboardBtn?.addEventListener('click', () => toggleSoundboard());
  els.soundboardClose?.addEventListener('click', () => toggleSoundboard(false));
  els.soundboardVolume?.addEventListener('input', () => setSoundboardVolume(Number(els.soundboardVolume.value) / 100));
  els.deafenBtn?.addEventListener('click', () => toggleDeafen());
  if (els.boardEmoji) {
    els.boardEmoji.replaceChildren();
    for (const emoji of CUSTOM_EMOJIS) {
      const option = document.createElement('option');
      option.value = emoji.id;
      option.textContent = emoji.id;
      els.boardEmoji.append(option);
    }
  }
  els.boardAddForm?.addEventListener('submit', (event) => { event.preventDefault(); addCustomSound(); });
  els.boardClearBtn?.addEventListener('click', clearCustomSounds);
  els.boardMyForm?.addEventListener('submit', (event) => { event.preventDefault(); addPersonalSound(); });
  els.soundboardMyClear?.addEventListener('click', async () => { await clearPersonalSounds(); state.personalSounds = []; renderPersonalGrid(); });
  els.soundboardSearch?.addEventListener('input', () => { state.boardQuery = els.soundboardSearch.value.trim().toLowerCase(); renderSoundboardGrid(); });
  els.screenStopWatching?.addEventListener('click', (event) => { event.stopPropagation(); stopWatchingScreen(); });
  els.screenEnlarge?.addEventListener('click', (event) => { event.stopPropagation(); toggleScreenEnlarge(); });
  els.screenStage?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.screenStage.classList.contains('is-enlarged')) {
      event.preventDefault();
      event.stopPropagation();
      els.screenStage.classList.remove('is-enlarged');
      resetScreenZoom();
      syncScreenEnlarge();
    }
  });

  // ---- Screen-share zoom / pan (wheel, pinch, drag, buttons, double-click) ----
  els.screenZoomIn?.addEventListener('click', (event) => { event.stopPropagation(); zoomByStep(1 / ZOOM_STEP); });
  els.screenZoomOut?.addEventListener('click', (event) => { event.stopPropagation(); zoomByStep(ZOOM_STEP); });
  els.screenZoomReset?.addEventListener('click', (event) => { event.stopPropagation(); resetScreenZoom(); });
  els.screenZoomIn?.addEventListener('dblclick', stopPropagationOnEvent);
  els.screenZoomOut?.addEventListener('dblclick', stopPropagationOnEvent);
  els.screenZoomReset?.addEventListener('dblclick', stopPropagationOnEvent);
  els.screenStage?.addEventListener('wheel', handleStageWheel, { passive: false });
  els.screenStage?.addEventListener('dblclick', handleStageDoubleClick);
  bindStagePointers();
  // Autoplay policy: AudioContexts created outside a gesture stay
  // suspended (silent remote audio + silent mic processing). Any pointer
  // or key gesture resumes them — this is what makes voice audible.
  const resumeMeshAudio = () => { try { state.mesh?.resumeAudio(); } catch { /* ignore */ } };
  document.addEventListener('pointerdown', resumeMeshAudio, { passive: true });
  document.addEventListener('keydown', resumeMeshAudio);
  els.screenWatchBtn?.addEventListener('click', () => { state.hiddenScreenId = null; updateScreenStage(); });
  els.boardImage?.addEventListener('change', () => previewBoardImage(els.boardImage, els.boardImagePreview));
  els.boardMyImage?.addEventListener('change', () => previewBoardImage(els.boardMyImage, els.boardMyImagePreview));
  if (els.boardMyEmoji) {
    els.boardMyEmoji.replaceChildren();
    for (const emoji of CUSTOM_EMOJIS) {
      const option = document.createElement('option');
      option.value = emoji.id;
      option.textContent = emoji.id;
      els.boardMyEmoji.append(option);
    }
  }
  renderSoundboardGrid();
  loadPersonalSounds();
  // Right-click menu (people + tiles): per-peer volume for everyone,
  // admin actions additionally when you are the host.
  document.addEventListener('contextmenu', (event) => {
    const node = event.target?.closest?.('.person, .tile');
    if (!node?.dataset?.participant) return;
    if (node.dataset.participant === state.selfId) return;
    event.preventDefault();
    openParticipantMenu(node.dataset.participant, event.clientX, event.clientY);
  });
  document.addEventListener('click', (event) => {
    if (els.ctxMenu && !els.ctxMenu.hidden && !els.ctxMenu.contains(event.target)) closeAdminMenu();
  });
  document.addEventListener('input', (event) => {
    if (event.target?.closest?.('[data-volume-input]')) syncMasterVolume();
  });
  els.micSettingsBtn?.addEventListener('click', openMicSettings);
  els.micClose?.addEventListener('click', closeMicSettings);
  els.micDone?.addEventListener('click', closeMicSettings);
  els.micPreset?.addEventListener('change', applyMicPreset);
  els.micDevice?.addEventListener('change', () => {
    void state.mesh?.setMicSettings({ deviceId: els.micDevice.value, preset: 'custom' });
  });
  els.micQuality?.addEventListener('change', () => {
    void state.mesh?.setMicSettings({ quality: els.micQuality.value, preset: 'custom' });
  });
  for (const [el, key] of [
    [els.micEnabled, 'enabled'],
    [els.micGate, 'gate'],
    [els.micNoise, 'noiseSuppression'],
    [els.micEcho, 'echoCancellation'],
    [els.micAgc, 'autoGainControl'],
    [els.micEnhance, 'enhance'],
    [els.micMonitor, 'monitor']
  ]) {
    el?.addEventListener('change', () => {
      void state.mesh?.setMicSettings({ [key]: el.checked, preset: 'custom' });
      if (key === 'enabled' && !el.checked) toast(t('tools.micOffNote'), 'info', 3200);
    });
  }
  els.micAmp?.addEventListener('input', () => {
    updateMicOutputs();
    void state.mesh?.setMicSettings({ amplificationDb: Number(els.micAmp.value), preset: 'custom' });
  });
  els.micGateThreshold?.addEventListener('input', () => {
    updateMicOutputs();
    void state.mesh?.setMicSettings({ gateThresholdDb: Number(els.micGateThreshold.value), preset: 'custom' });
  });
  els.micDeDistort?.addEventListener('input', () => {
    updateMicOutputs();
    void state.mesh?.setMicSettings({ deDistort: Number(els.micDeDistort.value), preset: 'custom' });
  });
  els.micEnhanceStrength?.addEventListener('input', () => {
    updateMicOutputs();
    void state.mesh?.setMicSettings({
      enhanceStrength: Number(els.micEnhanceStrength.value) / 100,
      preset: 'custom'
    });
  });
  els.micReset?.addEventListener('click', async () => {
    await state.mesh?.setMicSettings({ ...DEFAULT_MIC_SETTINGS });
    renderMicSettings();
    toast(t('tools.micSaved'), 'info', 2200);
  });
  els.micDialog?.addEventListener('click', (event) => {
    if (event.target === els.micDialog) closeMicSettings();
  });
  // ---- Host room settings (name + password + dice generator) ----
  els.roomSettingsBtn?.addEventListener('click', openRoomSettings);
  els.roomSettingsClose?.addEventListener('click', closeRoomSettings);
  els.roomSettingsCancel?.addEventListener('click', closeRoomSettings);
  els.roomSettingsSave?.addEventListener('click', () => { void saveRoomSettings(); });
  els.roomNameInput?.addEventListener('input', hideRoomSettingsError);
  els.roomPasswordInput?.addEventListener('input', () => {
    state.roomPasswordTouched = true;
    hideRoomSettingsError();
  });
  els.roomDiceBtn?.addEventListener('click', () => {
    animateDiceRoll(els.roomDiceBtn, els.roomPasswordInput);
    state.roomPasswordTouched = true;
  });
  bindPasswordToggle(els.joinPasswordToggle, els.joinPassword);
  bindPasswordToggle(els.roomPasswordToggle, els.roomPasswordInput);
  els.roomSettingsDialog?.addEventListener('click', (event) => {
    if (event.target === els.roomSettingsDialog) closeRoomSettings();
  });
  els.shortcutsBtn?.addEventListener('click', openShortcuts);
  els.shortcutsClose?.addEventListener('click', closeShortcuts);

  if (els.shortcutsDialog) {
    els.shortcutsDialog.addEventListener('click', (event) => {
      if (event.target === els.shortcutsDialog) closeShortcuts();
    });
  }

  els.reactionBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleReactionMenu();
  });

  $$('.reaction-choice', els.reactionMenu).forEach((button) => {
    button.addEventListener('click', () => {
      const emoji = button.dataset.emoji;
      closeReactionMenu();
      if (emoji) state.socket?.emit('reaction:send', { emoji });
    });
  });
  // Floating reactions use the same custom emoji picker (all 43).
  if (els.reactionMenu) {
    for (const emoji of CUSTOM_EMOJIS) {
      const button = el('button', 'reaction-choice reaction-choice-custom');
      button.type = 'button';
      button.dataset.emoji = emoji.id;
      button.setAttribute('aria-label', `:${emoji.id}:`);
      button.title = `:${emoji.id}:`;
      button.append(customEmojiImage(emoji.id, 'custom-emoji custom-emoji-sm'));
      button.addEventListener('click', () => {
        closeReactionMenu();
        state.socket?.emit('reaction:send', { emoji: emoji.id });
      });
      els.reactionMenu.append(button);
    }
  }

  // Single click cycles between sharers — but only after a short debounce,
  // so a double-click (zoom toggle) never triggers a cycle, and only when
  // the previous gesture was not a pan-drag.
  els.screenStage.addEventListener('click', handleStageClick);
  els.screenVideo?.addEventListener('playing', () => { els.screenPlaceholder.hidden = true; });
  els.screenVideo?.addEventListener('loadeddata', () => { els.screenPlaceholder.hidden = true; });

  document.addEventListener('click', (event) => {
    if (!els.reactionMenu.hidden && !els.reactionMenu.contains(event.target) && event.target !== els.reactionBtn) {
      closeReactionMenu();
    }
    if (els.emojiMenu && !els.emojiMenu.hidden && !els.emojiMenu.contains(event.target) && !els.emojiBtn?.contains(event.target)) {
      closeEmojiMenu();
    }
    if (els.gifMenu && !els.gifMenu.hidden && !els.gifMenu.contains(event.target) && !els.gifBtn?.contains(event.target)) {
      closeGifMenu();
    }
    if (els.stickerMenu && !els.stickerMenu.hidden && !els.stickerMenu.contains(event.target) && !els.stickerBtn?.contains(event.target)) {
      closeStickerMenu();
    }
  });

  document.addEventListener('keydown', handleShortcut);

  els.messages.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.panelChat.classList.add('is-dragging');
  });
  els.messages.addEventListener('dragleave', () => els.panelChat.classList.remove('is-dragging'));
  els.messages.addEventListener('drop', (event) => {
    event.preventDefault();
    els.panelChat.classList.remove('is-dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  });

  document.addEventListener('pointerdown', () => {
    state.mesh?.resumeAudio();
    state.audioCtx?.resume?.().catch(() => {});
  });
  window.addEventListener('pagehide', () => {
    state.mesh?.dispose();
    state.socket?.disconnect();
  });
  window.addEventListener('beforeunload', () => {
    state.mesh?.dispose();
    state.socket?.disconnect();
  });
}

async function joinRoom(event) {
  event.preventDefault();
  if (state.joining) return;
  if (!state.code || !CODE_RE.test(state.code)) {
    showJoinError('error.invalidLink');
    return;
  }

  const name = els.nameInput.value.trim();
  if (!name) {
    showJoinError('error.nameRequired');
    els.nameInput.focus();
    return;
  }

  state.joining = true;
  setJoinBusy(true);
  showJoinError(null);
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Name persistence is optional; joining must never fail because of it.
  }

  state.selfName = name;
  state.joinPayload = { mic: els.joinMic.checked, camera: els.joinCam.checked };

  try {
    const socket = ensureSocket();
    await waitForConnection(socket);
    // The gate shows the field after prefetch; if that fetch failed we
    // still try the remembered password (server decides if it is needed).
    const password = els.joinPasswordField.hidden
      ? getStoredRoomPassword()
      : normalizeRoomPassword(els.joinPassword.value);
    const response = await emitAck('room:join', {
      code: state.code,
      name,
      deviceId: state.deviceId,
      deviceType: state.deviceType,
      ...(password ? { password } : {})
    });
    if (!response?.ok) {
      handleJoinPasswordError(response?.error);
      showJoinError(joinErrorKey(response?.error));
      setStatus('offline', 'status.notConnected');
      return;
    }
    // Correct password (or none needed): remember it for refreshes.
    saveRoomPassword(response.room?.hasPassword && password ? password : '');

    state.joiningOnce = true;
    applyJoinState(response);
    hideGate();
    startSessionTimer();
    applyWakeLock();
    feedback('success');
    setStatus('online', 'status.connected');

    const existingIds = [...state.participants.keys()].filter((id) => id !== state.selfId);
    const mediaPromise = initMedia();
    await Promise.allSettled(existingIds.map((id) => state.mesh.connectToPeer(id)));
    await mediaPromise;

    setTimeout(() => {
      // On phones the keyboard would cover half the call the moment the gate
      // closes; wait for the user to tap the composer instead.
      if (!isPhoneLayout()) els.messageInput.focus();
    }, 200);
  } catch (error) {
    showJoinError(error?.message?.startsWith?.('error.') ? error.message : 'error.joinFailed');
    setStatus('offline', 'status.notConnected');
  } finally {
    state.joining = false;
    setJoinBusy(false);
  }
}

function ensureSocket() {
  if (state.socket) return state.socket;
  if (typeof window.io !== 'function') {
    throw new Error('error.realtimeClient');
  }

  const socket = window.io({
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 8000,
    transports: ['websocket', 'polling'],
    upgrade: true
  });
  state.socket = socket;

  state.mesh = new MediaMesh({
    socket,
    audioContainer: els.remoteAudio,
    translate: (key, vars) => t(key, vars),
    onChange: handleMeshChange,
    onSpeaking: handleSpeaking,
    onError: (message) => toast(message, 'error', 4800)
  });

  bindRoomEvents(socket);

  socket.on('connect', () => {
    if (state.joiningOnce && !state.joining && !state.reconnecting) rejoin();
  });

  socket.on('disconnect', () => {
    if (!state.joiningOnce) return;
    state.online = false;
    state.speaking.clear();
    setStatus('reconnecting', 'status.reconnecting');
    state.mesh?.closeAll();
    renderTiles();
    renderPeople();
    updateScreenStage();
  });

  socket.on('connect_error', () => {
    if (!state.joiningOnce) return;
    setStatus('reconnecting', 'status.connecting');
  });

  socket.on('room:error', ({ error } = {}) => {
    if (error) toast(t(joinErrorKey(error)), 'error', 4200);
  });

  return socket;
}

function waitForConnection(socket) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('error.serverUnreachable'));
    }, 12000);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('error.serverConnect'));
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
  });
}

function applyJoinState(response) {
  state.selfId = response.self.id;
  state.selfName = response.self.name;
  state.hostId = response.hostId || response.self.id;
  state.isHost = Boolean(response.isHost || response.self?.isHost || state.hostId === state.selfId);
  state.roomName = response.room?.name || '';
  state.roomHasPassword = Boolean(response.room?.hasPassword);
  updateRoomSettingsVisibility();
  playSound(state.isHost ? 'success' : 'join');
  if (state.isHost) setTimeout(() => toast(t('admin.youHost'), 'info', 4200), 600);
  state.participants = new Map(
    response.room.participants.map((participant) => [participant.id, participant])
  );
  if (!state.participants.has(state.selfId)) {
    state.participants.set(state.selfId, {
      id: state.selfId,
      name: state.selfName,
      micOn: false,
      cameraOn: false,
      screenOn: false,
      handRaised: false,
      deviceType: state.deviceType
    });
  }

  state.messages = response.room.messages ?? [];
  state.customSounds = Array.isArray(response.room.customSounds) ? response.room.customSounds : [];
  renderSoundboardGrid();
  state.pinnedMessageId = response.room.pinnedMessageId ?? null;
  state.lastDay = null;
  state.speaking.clear();
  applySavedPeerVolumes();
  syncMasterVolume();
  renderMessages();
  renderAll();
  renderPinned();
  updateDocumentTitle();
}

function syncMasterVolume() {
  // Always pass the REAL master volume — MediaMesh zeroes it internally
  // while deafened (via _effectiveVolume). Passing 0 here used to clobber
  // masterVolume, so undeafening stayed silent forever.
  const master = getSettings().volume ?? 1;
  state.mesh?.setMasterVolume(master);
}

function toggleDeafen(force) {
  state.deafened = typeof force === 'boolean' ? force : !state.deafened;
  state.mesh?.setDeafened(state.deafened);
  if (els.deafenBtn) {
    els.deafenBtn.setAttribute('aria-pressed', String(state.deafened));
    els.deafenBtn.classList.toggle('is-active', state.deafened);
  }
  if (els.deafenLabel) els.deafenLabel.textContent = t(state.deafened ? 'deafen.on' : 'deafen.off');
  feedback(state.deafened ? 'light' : 'success');
  renderMoreSheet();
  playSound(state.deafened ? 'click' : 'success');
  updatePresence();
}

function renderPinned() {
  if (!els.pinnedBar) return;
  const message = state.messages.find((item) => item.id === state.pinnedMessageId);
  els.pinnedBar.hidden = !message;
  if (!message) return;
  if (els.pinnedText) {
    els.pinnedText.textContent = `${message.authorName || ''}: ${message.text || message.attachment?.name || ''}`;
  }
  for (const node of els.messages?.querySelectorAll('.message') ?? []) {
    node.classList.toggle('is-pinned', node.dataset.messageId === state.pinnedMessageId);
  }
}

async function pinMessage(messageId) {
  try {
    const response = await emitAck('chat:pin', { messageId });
    if (!response?.ok) throw new Error(joinErrorKey(response?.error));
    state.pinnedMessageId = messageId;
    renderPinned();
  } catch (error) {
    toast(errorText(error, 'chat.pinFailed'), 'error', 3600);
  }
}

async function unpinMessage() {
  try {
    const response = await emitAck('chat:pin', { messageId: '' });
    if (!response?.ok) throw new Error(joinErrorKey(response?.error));
    state.pinnedMessageId = null;
    renderPinned();
  } catch (error) {
    toast(errorText(error, 'chat.pinFailed'), 'error', 3600);
  }
}

function jumpToPinned() {
  const node = findMessageNode(state.pinnedMessageId);
  if (!node) {
    // Pinned message may be filtered out by search — clear search first.
    clearSearch();
    const retry = findMessageNode(state.pinnedMessageId);
    retry?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    retry?.classList.add('is-flash');
    setTimeout(() => retry?.classList.remove('is-flash'), 1700);
    return;
  }
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  node.classList.add('is-flash');
  setTimeout(() => node.classList.remove('is-flash'), 1700);
}

async function initMedia() {
  const wants = state.joinPayload ?? { mic: true, camera: false };
  const result = await state.mesh.init(wants);
  syncLocalMediaState();
  if (result.warning) toast(result.warning, 'error', 5200);
  updatePresence();
}

function syncLocalMediaState() {
  state.media.mic = state.mesh?.isOn('audio') ?? false;
  state.media.camera = state.mesh?.isOn('camera') ?? false;
  state.media.screen = state.mesh?.isOn('screen') ?? false;
}

async function rejoin() {
  if (state.reconnecting || !state.socket) return;
  state.reconnecting = true;
  setStatus('connecting', 'status.rejoining');

  try {
    state.mesh?.closeAll();
    const storedPassword = getStoredRoomPassword();
    const response = await emitAck('room:join', {
      code: state.code,
      name: state.selfName,
      deviceId: state.deviceId,
      deviceType: state.deviceType,
      ...(storedPassword ? { password: storedPassword } : {})
    });
    if (!response?.ok) throw new Error(joinErrorKey(response?.error));

    applyJoinState(response);
    // The host may have changed the password while we were offline: keep
    // the remembered value in sync with what the server just verified.
    saveRoomPassword(response.room?.hasPassword && storedPassword ? storedPassword : '');
    updatePresence();
    setStatus('online', 'status.connected');
    state.online = true;

    const existingIds = [...state.participants.keys()].filter((id) => id !== state.selfId);
    await Promise.allSettled(existingIds.map((id) => state.mesh.connectToPeer(id)));
    toast(t('toast.reconnected'), 'info', 2400);
  } catch (error) {
    const key = error?.message?.startsWith?.('error.') ? error.message : '';
    if (key === 'error.passwordRequired' || key === 'error.wrongPassword') {
      // The remembered password is stale (or the host just added one): drop
      // it and let the user re-enter it through the join gate.
      forgetRoomPassword();
      state.online = false;
      setStatus('offline', 'status.offline');
      showGateForPassword(key === 'error.wrongPassword' ? 'error.wrongPassword' : 'error.passwordRequired');
      return;
    }
    setStatus('offline', 'status.offline');
    state.online = false;
    toast(errorText(error, 'error.reconnectFailed'), 'error', 5000);
  } finally {
    state.reconnecting = false;
  }
}

// Re-show the join gate mid-session (stale password): the room stays
// running in the background — submitting the gate rejoins it.
function showGateForPassword(errorKey) {
  try {
    state.mesh?.closeAll();
    renderTiles();
  } catch { /* ignore */ }
  try { document.querySelector('#room-shell')?.setAttribute('inert', ''); } catch { /* ignore */ }
  if (els.gate) els.gate.hidden = false;
  if (els.joinPasswordField) els.joinPasswordField.hidden = false;
  renderJoinGateLabels();
  showJoinError(errorKey);
  setStatus('offline', 'status.notConnected');
  setTimeout(() => { try { els.joinPassword?.focus(); } catch { /* ignore */ } }, 120);
}

function setJoinBusy(busy) {
  els.joinBtn.disabled = busy;
  els.joinBtn.textContent = busy ? t('join.busy') : t('join.idle');
}

function showJoinError(key) {
  state.joinErrorKey = key || null;
  applyJoinError();
}

function applyJoinError() {
  if (!els.joinError) return;
  if (state.joinErrorKey) {
    els.joinError.textContent = t(state.joinErrorKey);
    els.joinError.hidden = false;
  } else {
    els.joinError.textContent = '';
    els.joinError.hidden = true;
  }
}

// Password gate failures reveal the field (if the prefetch missed it) and,
// for a wrong value, drop the stale remembered password — the user's typed
// value is kept so they can fix a typo without retyping.
function handleJoinPasswordError(code) {
  if (code !== 'password-required' && code !== 'wrong-password') return;
  if (els.joinPasswordField) els.joinPasswordField.hidden = false;
  renderJoinGateLabels();
  if (code === 'wrong-password') forgetRoomPassword();
  try { els.joinPassword?.focus(); els.joinPassword?.select(); } catch { /* ignore */ }
}

function renderJoinGateLabels() {
  if (els.joinPassword) els.joinPassword.placeholder = t('join.passwordPlaceholder');
  if (els.joinPasswordHint) els.joinPasswordHint.textContent = t('join.passwordHint');
  if (els.joinPasswordToggle) {
    const show = els.joinPassword.type !== 'password';
    els.joinPasswordToggle.title = t(show ? 'password.hide' : 'password.show');
    els.joinPasswordToggle.setAttribute('aria-label', t(show ? 'password.hide' : 'password.show'));
  }
}

function bindPasswordToggle(button, input) {
  if (!button || !input) return;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.classList.toggle('is-visible', show);
    button.title = t(show ? 'password.hide' : 'password.show');
    button.setAttribute('aria-label', t(show ? 'password.hide' : 'password.show'));
  });
}

function hideGate() {
  els.gate.hidden = true;
  els.joinError.hidden = true;
  try { document.querySelector('#room-shell')?.removeAttribute('inert'); } catch { /* ignore */ }
}

function joinErrorKey(code) {
  switch (code) {
    case 'invalid-code':
      return 'error.invalidCode';
    case 'room-full':
      return 'error.roomFull';
    case 'not-in-room':
      return 'error.notInRoom';
    case 'rate-limited':
      return 'error.rateLimited';
    case 'message-too-long':
      return 'error.messageTooLong';
    case 'empty-message':
      return 'error.emptyMessage';
    case 'send-failed':
      return 'error.sendFailed';
    case 'invalid-reaction':
      return 'error.invalidReaction';
    case 'message-not-found':
      return 'error.messageNotFound';
    case 'reaction-failed':
      return 'error.reactionFailed';
    case 'banned':
      return 'error.banned';
    case 'spam':
      return 'error.spam';
    case 'muted':
      return 'error.muted';
    case 'duplicate-device':
      return 'error.duplicateDevice';
    case 'too-many-from-device':
      return 'error.tooManyFromDevice';
    case 'not-admin':
      return 'error.notAdmin';
    case 'user-not-found':
      return 'error.userNotFound';
    case 'cannot-target-self':
      return 'error.cannotTargetSelf';
    case 'password-required':
      return 'error.passwordRequired';
    case 'wrong-password':
      return 'error.wrongPassword';
    case 'invalid-room-password':
      return 'error.invalidRoomPassword';
    case 'rename-failed':
      return 'error.renameFailed';
    case 'password-failed':
      return 'error.passwordFailed';
    default:
      return 'error.generic';
  }
}

function errorText(error, fallbackKey) {
  const message = typeof error === 'string' ? error : error?.message;
  if (message && message.startsWith('error.')) return t(message);
  if (message) return message;
  return t(fallbackKey);
}

/* ---------------- Socket events ---------------- */

function bindRoomEvents(socket) {
  socket.on('peer:joined', ({ participant } = {}) => {
    if (!participant?.id) return;
    state.participants.set(participant.id, participant);
    const volume = getPeerVolume(participant);
    if (volume !== 1) state.peerVolumes.set(participant.id, volume);
    state.mesh?.setPeerVolume(participant.id, volume);
    if (state.soundsOn) playSound('join');
    renderTiles();
    renderPeople();
    updateStageHeader();
  });

  socket.on('peer:left', ({ id } = {}) => {
    if (!id) return;
    state.participants.delete(id);
    if (state.soundsOn) playSound('leave');
    state.speaking.delete(id);
    state.mesh?.closePeer(id);
    removeTyping(id);
    if (state.activeScreenId === id) state.activeScreenId = null;
    if (state.hiddenScreenId === id) state.hiddenScreenId = null;
    renderTiles();
    renderPeople();
    updateStageHeader();
    updateScreenStage();
  });

  socket.on('peer:updated', (participant) => {
    if (!participant?.id) return;
    state.participants.set(participant.id, participant);
    if (participant.id === state.selfId) {
      state.media.mic = participant.micOn;
      state.media.camera = participant.cameraOn;
      state.media.screen = participant.screenOn;
      state.handRaised = participant.handRaised;
    }
    if (!participant.screenOn) {
      if (state.activeScreenId === participant.id) state.activeScreenId = null;
      // The sharer stopped — forget any "stop watching" for them, or their
      // NEXT share would start hidden.
      if (state.hiddenScreenId === participant.id) state.hiddenScreenId = null;
    }
    if (participant.handRaised && participant.id !== state.selfId) playSound('hand');
    queueRender();
    updateScreenStage();
    renderControls();
  });

  socket.on('chat:message', (message) => {
    if (!message?.id) return;
    state.messages.push(message);
    appendMessage(message);
    refreshFilterUi();
    notifyNewMessage(message);
  });

  socket.on('chat:pinned', ({ pinnedMessageId } = {}) => {
    state.pinnedMessageId = pinnedMessageId ?? null;
    renderPinned();
  });

  socket.on('chat:edited', ({ messageId, text, editedAt } = {}) => {
    if (!messageId) return;
    const message = state.messages.find((item) => item.id === messageId);
    if (message) {
      message.text = text;
      message.editedAt = editedAt;
    }
    refreshMessageNode(messageId);
  });

  socket.on('chat:deleted', ({ messageId } = {}) => {
    if (!messageId) return;
    if (state.pinnedMessageId === messageId) state.pinnedMessageId = null;
    state.messages = state.messages.filter((item) => item.id !== messageId);
    findMessageNode(messageId)?.remove();
    renderPinned();
    updateChatEmpty(filteredMessages().length);
  });

  socket.on('chat:reaction', ({ messageId, reactions } = {}) => {
    if (!messageId || !reactions) return;
    const message = state.messages.find((item) => item.id === messageId);
    if (message) message.reactions = reactions;
    updateMessageReactions(messageId, reactions);
  });

  socket.on('chat:typing', ({ id, name, typing } = {}) => {
    if (!id || id === state.selfId) return;
    setTypingUser(id, name, typing);
  });

  socket.on('soundboard:play', ({ id, custom = false, url = '', emojiId = '', soundName = '', name, from } = {}) => {
    if (custom) {
      if (!url || !String(url).startsWith('/uploads/')) return;
      playCustomSound(url);
      if (from !== state.selfId) floatCustomEmoji(name || t('screen.someone'), emojiId || 'star', soundName || '');
      return;
    }
    if (!id || !isSoundboardId(id)) return;
    playSoundboard(id);
    if (from !== state.selfId) floatCustomEmoji(name || t('screen.someone'), soundboardEmojiId(id), t(`soundboard.${id}`));
  });

  socket.on('soundboard:added', ({ sound } = {}) => {
    if (!sound?.id || !sound?.url) return;
    if (!state.customSounds.some((s) => s.id === sound.id)) state.customSounds.push(sound);
    renderSoundboardGrid();
    toast(t('soundboard.added'), 'info', 2400);
  });

  socket.on('soundboard:deleted', ({ id } = {}) => {
    if (!id) return;
    state.customSounds = state.customSounds.filter((s) => s.id !== id);
    renderSoundboardGrid();
  });

  socket.on('soundboard:cleared', () => {
    state.customSounds = [];
    renderSoundboardGrid();
    toast(t('soundboard.cleared'), 'info', 2400);
  });

  socket.on('reaction:receive', ({ name, emoji, id } = {}) => {
    if (emoji) floatReaction(name || t('screen.someone'), emoji);
    if (id !== state.selfId && state.soundsOn) playSound('reaction');
  });

  socket.on('admin:host', ({ hostId, hostName } = {}) => {
    if (!hostId) return;
    state.hostId = hostId;
    state.isHost = hostId === state.selfId;
    updateRoomSettingsVisibility();
    renderPeople();
    renderTiles();
    if (state.isHost) toast(t('admin.youHost'), 'info', 3600);
  });

  // Host renamed the room — everyone updates the stage + document title.
  socket.on('room:renamed', ({ name, by } = {}) => {
    state.roomName = String(name ?? '').slice(0, ROOM_NAME_MAX);
    updateStageHeader();
    updateDocumentTitle();
    toast(t('toast.roomRenamed', { name: state.roomName || formatCode(state.code), by: by || '' }), 'info', 3400);
  });

  // Host added/changed/removed the password — non-hosts with a stale
  // remembered value will re-enter it on their next rejoin.
  socket.on('room:password-changed', ({ hasPassword, by } = {}) => {
    state.roomHasPassword = Boolean(hasPassword);
    // The old password is useless now — dropping it prevents a confusing
    // "wrong password" on the next reconnect.
    if (!state.roomHasPassword) forgetRoomPassword();
    toast(
      t(hasPassword ? 'toast.roomPasswordSet' : 'toast.roomPasswordRemoved', { by: by || '' }),
      'info',
      3600
    );
  });

  socket.on('admin:action', ({ type, targetName, by } = {}) => {
    if (type === 'kick') { toast(t('admin.kicked', { name: targetName || '', by: by || '' }), 'error', 3600); playSound('kick'); }
    if (type === 'ban') { toast(t('admin.banned', { name: targetName || '', by: by || '' }), 'error', 4000); playSound('ban'); }
    if (type === 'disconnect') { toast(t('admin.disconnected', { name: targetName || '', by: by || '' }), 'error', 3600); playSound('kick'); }
    if (type === 'mute') { toast(t('admin.muted', { name: targetName || '', by: by || '' }), 'error', 3600); playSound('knock'); }
  });

  socket.on('admin:muted', ({ by } = {}) => {
    toast(t('admin.youMuted'), 'error', 5000);
    playSound('knock');
  });

  socket.on('admin:removed', ({ reason } = {}) => {
    playSound(reason === 'banned' ? 'ban' : 'kick');
    const msg = reason === 'banned' ? t('admin.removedBanned') : reason === 'disconnected' ? t('admin.removedDisconnected') : t('admin.removedKicked');
    toast(msg, 'error', 6000);
    state.mesh?.dispose();
    try { state.socket?.disconnect(); } catch {}
    setTimeout(() => { window.location.href = '/'; }, 1200);
  });
}

function handleMeshChange(peerId, kind) {
  if (peerId === null) {
    syncLocalMediaState();
    updatePresence();
    return;
  }
  if (kind === 'screen') updateScreenStage();
  renderTiles();
  if (kind === 'camera') syncTileMedia();
}

function handleSpeaking(id, speaking) {
  const participantId = id === 'self' ? state.selfId : id;
  if (!participantId) return;
  if (speaking) state.speaking.add(participantId);
  else state.speaking.delete(participantId);
  setSpeakingClass(participantId, speaking);
}

function updatePresence() {
  if (!state.socket?.connected || !state.selfId) return;
  const self = state.participants.get(state.selfId);
  if (self) {
    self.micOn = state.media.mic;
    self.cameraOn = state.media.camera;
    self.screenOn = state.media.screen;
    self.handRaised = state.handRaised;
  }
  state.socket.emit('presence:update', {
    micOn: state.media.mic,
    cameraOn: state.media.camera,
    screenOn: state.media.screen,
    handRaised: state.handRaised,
    deafened: state.deafened
  });
  renderTiles();
  renderPeople();
  renderControls();
  updateStageHeader();
  updateScreenStage();
}

/* ---------------- Rendering ---------------- */

// Batch rapid presence bursts into one frame (12 ppl toggling mics used
// to re-render everyone's tiles+list dozens of times per second).
let renderQueued = false;
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderTiles();
    renderPeople();
    updateStageHeader();
  });
}

function renderAll() {
  renderTiles();
  renderPeople();
  renderControls();
  updateStageHeader();
  updateScreenStage();
  updateSearchUi();
}

function sortedParticipants() {
  return [...state.participants.values()].sort((a, b) => {
    if (a.id === state.selfId) return -1;
    if (b.id === state.selfId) return 1;
    const joined = (a.joinedAt ?? 0) - (b.joinedAt ?? 0);
    if (joined !== 0) return joined;
    return a.name.localeCompare(b.name, locale());
  });
}

function renderTiles() {
  if (!els.tileGrid) return;
  const list = sortedParticipants();
  const nextIds = list.map((participant) => participant.id);
  const current = $$('.tile', els.tileGrid);
  const same =
    current.length === nextIds.length &&
    current.every((tile, index) => tile.dataset.participant === nextIds[index]);

  if (!same) {
    const fragment = document.createDocumentFragment();
    for (const participant of list) fragment.append(createTile(participant));
    els.tileGrid.replaceChildren(fragment);
  } else {
    for (const participant of list) {
      const tile = current.find((node) => node.dataset.participant === participant.id);
      if (tile) updateTile(tile, participant);
    }
  }

  els.tileGrid.classList.toggle('is-single', list.length === 1);
  els.tileGrid.classList.toggle('is-pair', list.length === 2);
  syncTileMedia();
}

function createTile(participant) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.participant = participant.id;

  const video = document.createElement('video');
  video.className = 'tile-video';
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;

  const avatar = document.createElement('div');
  avatar.className = 'tile-avatar';
  avatar.append(document.createElement('span'));

  const badges = document.createElement('div');
  badges.className = 'tile-badges';

  const foot = document.createElement('div');
  foot.className = 'tile-foot';
  const name = document.createElement('span');
  name.className = 'tile-name';
  const you = document.createElement('span');
  you.className = 'tile-you';
  you.textContent = t('chat.you');
  foot.append(name, you);
  tile.append(video, avatar, badges, foot);
  updateTile(tile, participant);
  return tile;
}

function updateTile(tile, participant) {
  const isSelf = participant.id === state.selfId;
  tile.classList.toggle('is-self', isSelf);
  tile.classList.toggle('is-speaking', state.speaking.has(participant.id));
  tile.dataset.participant = participant.id;

  const name = $('.tile-name', tile);
  if (name) name.textContent = participant.name;
  const you = $('.tile-you', tile);
  if (you) {
    you.hidden = !isSelf;
    you.textContent = t('chat.you');
  }

  // Device-type icon (phone / PC / tablet) next to the name.
  const deviceType = participant.deviceType && DEVICE_ICONS[participant.deviceType]
    ? participant.deviceType
    : '';
  let deviceEl = $('.tile-device', tile);
  if (deviceType) {
    if (!deviceEl) {
      deviceEl = el('span', 'tile-device');
      (you || $('.tile-foot', tile))?.before(deviceEl);
    }
    deviceEl.title = t(`device.${deviceType}`);
    deviceEl.setAttribute('aria-label', t(`device.${deviceType}`));
    deviceEl.replaceChildren(icon(DEVICE_ICONS[deviceType]));
  } else {
    deviceEl?.remove();
  }

  const avatar = $('.tile-avatar', tile);
  if (avatar) {
    avatar.className = `tile-avatar tone-${toneFor(participant.id)}`;
    const initialsNode = $('span', avatar);
    if (initialsNode) initialsNode.textContent = initials(participant.name);
  }

  // Volume badge (left corner) when adjusted away from 100%.
  if (!isSelf && getPeerVolume(participant) !== 1) {
    let volBadge = $('.tile-vol', tile);
    if (!volBadge) {
      volBadge = document.createElement('span');
      volBadge.className = 'tile-vol';
      tile.append(volBadge);
    }
    volBadge.replaceChildren();
    volBadge.append(icon('i-volume'), document.createTextNode(`${Math.round(getPeerVolume(participant) * 100)}%`));
  } else {
    $('.tile-vol', tile)?.remove();
  }

  const badges = $('.tile-badges', tile);
  if (badges) {
    badges.replaceChildren();
    if (participant.deafened) {
      badges.append(badge('i-deafen', t('deafen.on'), 'is-deafen'));
    } else if (!participant.micOn) {
      badges.append(badge('i-mic-off', t('chat.muted')));
    }
    if (participant.handRaised) {
      badges.append(badge('i-hand', t('chat.handRaised')));
    }
    if (participant.screenOn) {
      badges.append(badge('i-screen', t('chat.sharingScreen'), 'is-screen'));
    }
  }
}

function badge(iconName, label, extraClass = '') {
  const node = document.createElement('span');
  node.className = `tile-badge ${extraClass}`.trim();
  node.title = label;
  node.setAttribute('aria-label', label);
  node.append(icon(iconName));
  return node;
}

function syncTileMedia() {
  if (!els.tileGrid || !state.mesh) return;

  for (const tile of $$('.tile', els.tileGrid)) {
    const id = tile.dataset.participant;
    const participant = state.participants.get(id);
    const video = $('.tile-video', tile);
    if (!video) continue;

    const stream =
      id === state.selfId
        ? state.mesh.getLocalStream('camera')
        : state.mesh.getRemoteStream(id, 'camera');

    const hasVideo =
      Boolean(participant?.cameraOn) &&
      streamHasVideo(stream);

    tile.classList.toggle('has-video', hasVideo);

    if (hasVideo) {
      if (video.srcObject !== stream) video.srcObject = stream;
      video.play?.().catch(() => {});
    } else if (video.srcObject) {
      video.srcObject = null;
    }
  }
}

function renderPeople() {
  if (!els.peopleList) return;
  const list = sortedParticipants();
  const fragment = document.createDocumentFragment();

  for (const participant of list) {
    const item = document.createElement('li');
    item.className = 'person';
    item.dataset.participant = participant.id;
    if (state.speaking.has(participant.id)) item.classList.add('is-speaking');

    const avatar = document.createElement('span');
    avatar.className = `person-avatar tone-${toneFor(participant.id)}`;
    avatar.textContent = initials(participant.name);
    // Green = online, red = offline (socket down => everyone red).
    const isOnline = Boolean(state.online && state.socket?.connected);
    item.classList.toggle('is-online', isOnline);
    const dot = document.createElement('span');
    dot.className = `presence-dot${isOnline ? ' is-on' : ''}`;
    dot.title = isOnline ? t('status.connected') : t('status.offline');
    avatar.append(dot);

    const body = document.createElement('span');
    body.className = 'person-body';

    const nameRow = document.createElement('span');
    nameRow.className = 'person-name';
    nameRow.append(document.createTextNode(participant.name));
    if (participant.id === state.selfId) {
      const you = document.createElement('span');
      you.className = 'person-you';
      you.textContent = t('chat.you');
      nameRow.append(you);
    }
    if (participant.deviceType && DEVICE_ICONS[participant.deviceType]) {
      nameRow.append(deviceBadge(participant.deviceType, 'device-badge person-device'));
    }
    if (state.hostId === participant.id) {
      const host = document.createElement('span');
      host.className = 'host-badge';
      host.textContent = t('admin.isHost');
      nameRow.append(host);
    }

    const statusText = document.createElement('span');
    statusText.className = 'person-state';
    statusText.textContent = participantState(participant);

    body.append(nameRow, statusText);
    const volume = getPeerVolume(participant);
    if (participant.id !== state.selfId && volume !== 1) {
      const volBadge = document.createElement('span');
      volBadge.className = 'person-vol';
      volBadge.append(icon('i-volume'));
      volBadge.append(document.createTextNode(`${Math.round(volume * 100)}%`));
      body.append(volBadge);
    }

    const status = document.createElement('span');
    status.className = 'person-status';
    status.setAttribute('aria-label', participantState(participant));
    if (!participant.micOn) status.append(icon('i-mic-off'));
    if (participant.handRaised) status.append(flag('i-hand', t('chat.handRaised')));
    if (participant.screenOn) status.append(flag('i-screen', t('chat.sharingScreen')));

    item.append(avatar, body, status);
    fragment.append(item);
  }

  els.peopleList.replaceChildren(fragment);
  els.peopleCount.textContent = String(list.length);
}

function flag(iconName, label) {
  const span = document.createElement('span');
  span.className = 'person-flag';
  span.title = label;
  span.append(icon(iconName));
  return span;
}

function participantState(participant) {
  if (participant.deafened) return t('deafen.on');
  if (participant.screenOn) return t('chat.sharingScreen');
  if (participant.handRaised) return t('chat.handRaised');
  if (participant.cameraOn) return t('chat.cameraOn');
  if (!participant.micOn) return t('chat.muted');
  return t('chat.inRoom');
}

function updateStageHeader() {
  const count = state.participants.size;
  const formatted = formatCode(state.code);
  if (els.stageTitle) {
    // A host-set room name replaces the raw code everywhere it is shown.
    els.stageTitle.textContent = state.roomName
      ? state.roomName
      : formatted
        ? t('screen.stageRoom', { code: formatted })
        : t('screen.room');
  }
  if (els.stageCount) {
    els.stageCount.textContent =
      count === 1
        ? t('screen.person', { count })
        : t('screen.people', { count });
  }
  if (els.peopleCount) els.peopleCount.textContent = String(count);
}

function updateScreenStage() {
  if (!els.screenStage) return;
  const sharers = sortedParticipants().filter((participant) => participant.screenOn);

  if (!sharers.length) {
    els.screenStage.hidden = true;
    els.stage.classList.remove('is-sharing');
    els.screenVideo.srcObject = null;
    state.activeScreenId = null;
    // Sharing ended while enlarged: shrink back cleanly + drop zoom state.
    els.screenStage.classList.remove('is-enlarged');
    resetScreenZoom();
    syncScreenEnlarge();
    syncScreenPip();
    return;
  }

  if (!state.activeScreenId || !sharers.some((person) => person.id === state.activeScreenId)) {
    state.activeScreenId = sharers[0].id;
  }

  const participant = state.participants.get(state.activeScreenId);
  // Discord-style: the user stopped watching this screen — stay hidden
  // until they press "Watch screen" again. The sharer is unaffected.
  const stoppedWatching = state.hiddenScreenId === state.activeScreenId;
  if (els.screenWatchBtn) els.screenWatchBtn.hidden = !stoppedWatching;
  if (stoppedWatching) {
    els.screenStage.hidden = true;
    els.stage.classList.remove('is-sharing');
    els.screenVideo.srcObject = null;
    syncScreenPip();
    return;
  }
  const stream =
    state.activeScreenId === state.selfId
      ? state.mesh?.getLocalStream('screen')
      : state.mesh?.getRemoteStream(state.activeScreenId, 'screen');

  // Attach the stream whenever a live track exists — the <video> renders
  // frames as they arrive (this is what the working server path does).
  // The old streamHasVideo gate (muted + videoWidth) stuck rooms on
  // "Waiting…" forever. Placeholder only when there is no stream at all.
  const hasStream = Boolean(stream) && stream.getVideoTracks().some((tr) => tr.readyState === 'live');

  els.screenStage.hidden = false;
  els.stage.classList.add('is-sharing');

  if (hasStream) {
    if (els.screenVideo.srcObject !== stream) els.screenVideo.srcObject = stream;
    els.screenVideo.play?.().catch(() => {});
    // Hide the placeholder as soon as real frames play (covers the gap
    // between attach and first frame without a timer).
    els.screenPlaceholder.hidden = streamHasVideo(stream);
  } else {
    els.screenVideo.srcObject = null;
    els.screenPlaceholder.hidden = false;
  }
  if (els.screenStopWatching) {
    // Only viewers get the red button — the sharer stops via Share toggle.
    els.screenStopWatching.hidden = state.activeScreenId === state.selfId;
  }

  if (state.activeScreenId === state.selfId) {
    els.screenLabel.textContent = t('screen.youSharing');
  } else {
    els.screenLabel.textContent = t('screen.someoneSharing', {
      name: participant?.name ?? t('screen.someone')
    });
  }

  if (sharers.length > 1) {
    els.screenStage.title = t('screen.switchTitle');
    els.screenLabel.textContent += ` · ${t('screen.sharingCount', { count: sharers.length })}`;
  } else {
    els.screenStage.title = '';
  }
  syncScreenPip();
}

function cycleScreenShare() {
  const sharers = sortedParticipants().filter((participant) => participant.screenOn);
  if (sharers.length < 2) return;
  const index = sharers.findIndex((participant) => participant.id === state.activeScreenId);
  const nextId = sharers[(index + 1) % sharers.length].id;
  // Switching to a different sharer: their layout differs, so drop zoom.
  if (nextId !== state.activeScreenId) resetScreenZoom();
  state.activeScreenId = nextId;
  updateScreenStage();
}

function setSpeakingClass(id, speaking) {
  for (const node of $$('.tile, .person')) {
    if (node.dataset.participant === id) node.classList.toggle('is-speaking', speaking);
  }
}

function renderControls() {
  els.micBtn.setAttribute('aria-pressed', String(state.media.mic));
  els.cameraBtn.setAttribute('aria-pressed', String(state.media.camera));
  els.screenBtn.setAttribute('aria-pressed', String(state.media.screen));
  els.handBtn.setAttribute('aria-pressed', String(state.handRaised));

  els.micLabel.textContent = state.media.mic ? t('control.mute') : t('control.unmute');
  els.cameraLabel.textContent = state.media.camera ? t('control.stopVideo') : t('control.camera');
  els.screenBtnLabel.textContent = state.media.screen ? t('control.stopShare') : t('control.share');

  els.micBtn.title = state.media.mic ? t('control.micOnTitle') : t('control.micOffTitle');
  els.cameraBtn.title = state.media.camera ? t('control.cameraOnTitle') : t('control.cameraOffTitle');
  els.screenBtn.title = state.media.screen ? t('control.screenOnTitle') : t('control.screenOffTitle');
  els.handBtn.title = state.handRaised ? t('control.handOnTitle') : t('control.handOffTitle');
  renderMoreSheet();
}

/* ---------------- Small helpers ---------------- */

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
  const value = `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  return value || '?';
}

function toneFor(id) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return (hash % 4) + 1;
}

function intlDateTime(timestamp, options) {
  try {
    return new Intl.DateTimeFormat(locale(), options).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function formatTime(timestamp) {
  return intlDateTime(timestamp, { hour: 'numeric', minute: '2-digit' });
}

function dayKey(timestamp) {
  try {
    return new Date(timestamp).toDateString();
  } catch {
    return '';
  }
}

function formatBytes(size) {
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function safeAttachmentUrl(url) {
  return typeof url === 'string' && url.startsWith('/uploads/') && !url.includes('..')
    ? url
    : null;
}

/* ---------------- Chat search ---------------- */

function normalizeSearch(value) {
  return String(value ?? '')
    .toLocaleLowerCase(locale())
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u0652]/g, '')
    .trim();
}

function matchesSearch(message) {
  const query = normalizeSearch(state.searchQuery);
  if (!query) return true;
  const haystack = normalizeSearch(
    [
      message.text,
      message.authorName,
      message.attachment?.name
    ]
      .filter(Boolean)
      .join(' ')
  );
  return haystack.includes(query);
}

function filteredMessages() {
  if (!state.searchQuery.trim()) return state.messages;
  return state.messages.filter(matchesSearch);
}

function refreshFilterUi() {
  updateSearchUi();
  updateChatEmpty(filteredMessages().length);
}

function updateSearchUi() {
  const query = state.searchQuery.trim();
  const hasQuery = Boolean(query);

  if (els.chatSearchClear) els.chatSearchClear.hidden = !hasQuery;
  els.chatSearch?.classList.toggle('has-query', hasQuery);

  if (els.chatSearchCount) {
    els.chatSearchCount.hidden = !hasQuery;
    if (hasQuery) {
      els.chatSearchCount.textContent = t('chat.searchCount', {
        shown: filteredMessages().length,
        total: state.messages.length
      });
    }
  }
}

function updateChatEmpty(visibleCount) {
  if (!els.chatEmpty) return;
  const query = state.searchQuery.trim();

  if (query && visibleCount === 0) {
    els.chatEmpty.hidden = false;
    els.chatEmpty.textContent = t('chat.searchEmpty', { query });
    return;
  }

  if (!state.messages.length) {
    els.chatEmpty.hidden = false;
    els.chatEmpty.textContent = t('chat.empty');
    return;
  }

  els.chatEmpty.hidden = true;
}

function clearSearch() {
  state.searchQuery = '';
  if (els.chatSearchInput) els.chatSearchInput.value = '';
  renderMessages();
}

function focusSearch() {
  switchTab('chat');
  els.chatSearchInput?.focus();
  els.chatSearchInput?.select();
}

/* ---------------- Chat rendering ---------------- */

function renderMessages() {
  if (!els.messages) return;
  state.lastDay = null;
  els.messages.replaceChildren();
  const list = filteredMessages();
  for (const message of list) appendMessage(message);
  updateChatEmpty(list.length);
  updateSearchUi();
  requestAnimationFrame(() => {
    if (!state.searchQuery.trim()) {
      scrollToLatest('auto');
    } else {
      try {
        els.messages.scrollTo({ top: 0, behavior: 'auto' });
      } catch {
        els.messages.scrollTop = 0;
      }
    }
  });
}

function appendMessage(message) {
  if (!els.messages || !message?.id) return false;
  if (!matchesSearch(message)) return false;

  const key = dayKey(message.createdAt);
  if (key && key !== state.lastDay) {
    state.lastDay = key;
    const divider = el('div', 'day-divider');
    divider.append(el('span', '', dayLabel(message.createdAt)));
    els.messages.append(divider);
  }

  els.messages.append(createMessageNode(message));
  return true;
}

function createMessageNode(message) {
  const isSelf = message.authorId === state.selfId;
  const article = el('article', 'message');
  article.dataset.messageId = message.id;
  article.classList.toggle('is-self', isSelf);
  if (message.text && isEmojiOnlyMessage(message.text)) article.classList.add('is-emoji-only');

  const avatar = el(
    'span',
    `message-avatar tone-${toneFor(message.authorId || message.authorName || message.id)}`,
    initials(message.authorName)
  );

  const body = el('div', 'message-body');

  const head = el('div', 'message-head');
  head.append(el('span', 'message-author', message.authorName || t('chat.guest')));
  if (message.authorDeviceType && DEVICE_ICONS[message.authorDeviceType]) {
    head.append(deviceBadge(message.authorDeviceType, 'device-badge message-device'));
  }
  head.append(el('time', 'message-time', formatTime(message.createdAt)));

  const bubble = el('div', 'message-bubble');
  if (message.text) {
    const paragraph = el('p', 'message-text');
    renderMessageText(paragraph, message.text);
    bubble.append(paragraph);
  }

  const attachment = renderAttachment(message.attachment);
  if (attachment) bubble.append(attachment);

  body.append(head, bubble, buildMessageMeta(message));

  article.append(avatar, body);
  return article;
}

function renderMessageText(container, text) {
  const value = String(text ?? '');
  const tokenRe = /(https?:\/\/[^\s<>"']+|@[\p{L}\p{N}_.-]+)/gu;
  let lastIndex = 0;

  for (const match of value.matchAll(tokenRe)) {
    const index = match.index ?? 0;
    if (index > lastIndex) appendHighlighted(container, value.slice(lastIndex, index));

    const token = match[0];
    if (token.startsWith('@')) {
      const mention = el('span', 'message-mention', token);
      const name = token.slice(1).toLocaleLowerCase(locale());
      if (state.selfName && name === state.selfName.toLocaleLowerCase(locale())) {
        mention.classList.add('is-self');
      }
      container.append(mention);
    } else {
      let url = token;
      let trailing = '';
      const trailingMatch = url.match(/[.,!?;:)\]}»]+$/);
      if (trailingMatch) {
        trailing = trailingMatch[0];
        url = url.slice(0, -trailing.length);
      }
      const link = el('a', 'message-link', url);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      if (isGifUrl(url)) {
        container.append(gifImage(url));
      } else {
        container.append(link);
      }
      if (trailing) appendHighlighted(container, trailing);
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < value.length) appendHighlighted(container, value.slice(lastIndex));
}

function appendHighlighted(parent, segment) {
  if (!segment) return;
  // Custom Hush emoji + sticker shortcodes (:laugh:, :sticker-01:) render as
  // images, even inside searched/highlighted text — the shortcode stays in
  // the stored text.
  for (const part of splitEmojiShortcodes(segment)) {
    if (part.emoji) {
      parent.append(isCustomSticker(part.emoji)
        ? customStickerImage(part.emoji, 'custom-sticker message-sticker')
        : customEmojiImage(part.emoji, 'custom-emoji message-emoji'));
      continue;
    }
    appendHighlightedText(parent, part.text);
  }
}

function appendHighlightedText(parent, segment) {
  if (!segment) return;
  const query = state.searchQuery.trim();
  if (!query) {
    parent.append(document.createTextNode(segment));
    return;
  }

  const haystack = segment.toLocaleLowerCase(locale());
  const needle = query.toLocaleLowerCase(locale());
  let from = 0;
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    if (index > from) parent.append(document.createTextNode(segment.slice(from, index)));
    const mark = el('mark', 'search-hit', segment.slice(index, index + query.length));
    parent.append(mark);
    from = index + query.length;
    index = haystack.indexOf(needle, from);
  }

  if (from < segment.length) parent.append(document.createTextNode(segment.slice(from)));
}

function renderAttachment(attachment) {
  const url = safeAttachmentUrl(attachment?.url);
  if (!url) return null;

  const name = String(attachment.name || t('upload.file'));
  const mime = String(attachment.mime || '');

  if (mime.startsWith('image/')) {
    // In-page viewer (lightbox) — NOT a new tab, so the voice/video call
    // is never interrupted. The close button, Esc and the backdrop all exit.
    const wrap = el('span', 'message-attachment');
    const button = el('button', 'message-image');
    button.type = 'button';
    button.dataset.imageUrl = url;
    button.dataset.imageName = name;
    button.title = t('chat.imageViewerClose');
    button.setAttribute('aria-label', t('chat.imageViewerClose'));
    const img = document.createElement('img');
    img.src = url;
    img.alt = name;
    img.loading = 'lazy';
    img.decoding = 'async';
    button.append(img);
    wrap.append(button);
    return wrap;
  }

  const wrap = el('div', 'message-attachment');
  const card = el('a', 'file-card');
  card.href = url;
  card.download = name;
  card.append(icon('i-file'));

  const text = el('span', 'file-card-text');
  text.append(
    el('span', 'file-card-name', name),
    el('span', 'file-card-size', formatBytes(attachment.size) || t('upload.download'))
  );
  card.append(text);
  wrap.append(card);
  return wrap;
}

function buildMessageMeta(message = {}) {
  const reactions = message.reactions || {};
  const isSelf = message.authorId && message.authorId === state.selfId;
  const meta = el('div', 'message-meta');

  if (message.editedAt) {
    meta.append(el('span', 'message-edited', t('chat.edited')));
  }

  for (const emoji of REACTIONS) {
    const ids = reactions?.[emoji];
    if (!Array.isArray(ids) || !ids.length) continue;
    const chip = el('button', 'reaction-chip');
    chip.type = 'button';
    chip.dataset.emoji = emoji;
    chip.classList.toggle('is-mine', ids.includes(state.selfId));
    chip.title = ids.length === 1
      ? t('chat.reactionOne')
      : t('chat.reactionMany', { count: ids.length });
    chip.append(customEmojiImage(emoji, 'custom-emoji custom-emoji-xs'), el('span', '', String(ids.length)));
    meta.append(chip);
  }

  const react = el('button', 'message-react');
  react.append(customEmojiImage('smile', 'custom-emoji custom-emoji-xs'));
  react.type = 'button';
  react.dataset.action = 'react';
  react.title = t('chat.reactTitle');
  react.setAttribute('aria-label', t('chat.reactTitle'));
  meta.append(react);

  const copy = el('button', 'message-copy');
  copy.type = 'button';
  copy.dataset.action = 'copy';
  copy.title = t('chat.copy');
  copy.setAttribute('aria-label', t('chat.copy'));
  copy.append(icon('i-copy'));
  meta.append(copy);

  const pin = el('button', 'message-copy');
  pin.type = 'button';
  pin.dataset.action = 'pin';
  pin.title = t('chat.pin');
  pin.setAttribute('aria-label', t('chat.pin'));
  pin.append(icon('i-pin'));
  meta.append(pin);

  if (isSelf) {
    const edit = el('button', 'message-copy');
    edit.type = 'button';
    edit.dataset.action = 'edit';
    edit.title = t('chat.edit');
    edit.setAttribute('aria-label', t('chat.edit'));
    edit.append(icon('i-pencil'));
    meta.append(edit);

    const del = el('button', 'message-copy');
    del.type = 'button';
    del.dataset.action = 'delete';
    del.title = t('chat.delete');
    del.setAttribute('aria-label', t('chat.delete'));
    del.append(icon('i-trash'));
    meta.append(del);
  }

  return meta;
}

function updateMessageReactions(messageId, reactions = {}) {
  if (!els.messages || !messageId) return;
  const node = findMessageNode(messageId);
  if (!node) return;
  const message = state.messages.find((item) => item.id === messageId);
  const meta = $('.message-meta', node);
  if (meta) meta.replaceWith(buildMessageMeta({ ...message, reactions }));
}

function refreshMessageNode(messageId) {
  const node = findMessageNode(messageId);
  const message = state.messages.find((item) => item.id === messageId);
  if (!node || !message) return;
  const bubble = $('.message-bubble', node);
  if (bubble) {
    bubble.replaceChildren();
    if (message.text) {
      const paragraph = el('p', 'message-text');
      renderMessageText(paragraph, message.text);
      bubble.append(paragraph);
    }
    const attachment = renderAttachment(message.attachment);
    if (attachment) bubble.append(attachment);
  }
  const meta = $('.message-meta', node);
  if (meta) meta.replaceWith(buildMessageMeta(message));
}

async function editMessage(messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) return;
  const node = findMessageNode(messageId);
  const bubble = node && $('.message-bubble', node);
  if (!bubble) return;

  const textarea = el('textarea', 'message-edit-input');
  textarea.value = message.text || '';
  textarea.maxLength = 2000;
  textarea.setAttribute('aria-label', t('chat.editPlaceholder'));
  const row = el('div', 'message-edit-row');
  const save = el('button', 'btn btn-primary btn-sm', t('chat.save'));
  save.type = 'button';
  const cancel = el('button', 'btn btn-quiet btn-sm', t('chat.cancel'));
  cancel.type = 'button';
  row.append(save, cancel);
  bubble.replaceChildren(textarea, row);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const finish = () => refreshMessageNode(messageId);
  cancel.addEventListener('click', finish);
  save.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) return;
    try {
      const response = await emitAck('chat:edit', { messageId, text });
      if (!response?.ok) throw new Error(joinErrorKey(response?.error));
      // The server broadcasts chat:edited to everyone including us; also
      // update locally so the UI is instant even if the echo is delayed.
      message.text = text;
      message.editedAt = Date.now();
      refreshMessageNode(messageId);
    } catch (error) {
      toast(errorText(error, 'chat.editFailed'), 'error', 3600);
      finish();
    }
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      save.click();
    }
    if (event.key === 'Escape') finish();
  });
}

async function deleteMessage(messageId) {
  if (!window.confirm(t('chat.deleteConfirm'))) return;
  try {
    const response = await emitAck('chat:delete', { messageId });
    if (!response?.ok) throw new Error(joinErrorKey(response?.error));
    state.messages = state.messages.filter((item) => item.id !== messageId);
    findMessageNode(messageId)?.remove();
    updateChatEmpty(filteredMessages().length);
    toast(t('chat.deleted'), 'info', 2200);
  } catch (error) {
    toast(errorText(error, 'chat.deleteFailed'), 'error', 3600);
  }
}

function findMessageNode(messageId) {
  return [...els.messages.querySelectorAll('.message')].find(
    (node) => node.dataset.messageId === messageId
  );
}

function maybeNotifyMention(message) {
  try {
    if (!getSettings().notifications) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    const self = String(state.selfName || '').toLowerCase();
    const text = String(message?.text || '').toLowerCase();
    if (!self || !text.includes(`@${self}`)) return;
    new Notification(`Hush — ${message.authorName || ''}`, {
      body: String(message.text || '').slice(0, 140),
      tag: `hush-mention-${message.id || Date.now()}`,
      silent: !state.soundsOn
    });
  } catch {
    // Notifications are opt-in; never break chat.
  }
}

function notifyNewMessage(message) {
  if (!message || message.authorId === state.selfId) {
    if (state.activeTab === 'chat' && !state.searchQuery.trim()) scrollToLatest('smooth');
    return;
  }

  maybeNotifyMention(message);

  const away = document.hidden || state.activeTab !== 'chat' || !isNearBottom();
  if (state.soundsOn && away) {
    const isMention = String(message?.text || '').toLowerCase().includes(`@${String(state.selfName || '').toLowerCase()}`);
    playSound(isMention ? 'mention' : 'message');
  }

  if (document.hidden || state.activeTab !== 'chat') {
    setUnread(state.unread + 1);
    return;
  }

  if (isNearBottom() && !state.searchQuery.trim()) {
    scrollToLatest('smooth');
    setUnread(0);
  } else {
    setUnread(state.unread + 1);
  }
}

function isNearBottom() {
  if (!els.messages) return true;
  const gap = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
  return gap < 90;
}

function scrollToLatest(behavior = 'smooth') {
  if (!els.messages) return;
  requestAnimationFrame(() => {
    try {
      els.messages.scrollTo({ top: els.messages.scrollHeight, behavior });
    } catch {
      els.messages.scrollTop = els.messages.scrollHeight;
    }
  });
}

function handleMessagesScroll() {
  if (isNearBottom() && state.unread) setUnread(0);
}

/* ---------------- Message reactions ---------------- */

function handleMessagesClick(event) {
  const imageButton = event.target.closest('.message-image');
  if (imageButton?.dataset.imageUrl) {
    event.preventDefault();
    event.stopPropagation();
    openImageLightbox(imageButton.dataset.imageUrl, imageButton.dataset.imageName || '');
    return;
  }

  const reactButton = event.target.closest('.message-react');
  if (reactButton) {
    event.stopPropagation();
    const node = reactButton.closest('.message');
    if (!node?.dataset.messageId) return;
    openReactionPopover(reactButton, node.dataset.messageId);
    return;
  }

  const copyButton = event.target.closest('[data-action="copy"]');
  if (copyButton) {
    const node = copyButton.closest('.message');
    if (node?.dataset.messageId) copyMessage(node.dataset.messageId);
    return;
  }

  const pinButton = event.target.closest('[data-action="pin"]');
  if (pinButton) {
    const node = pinButton.closest('.message');
    if (node?.dataset.messageId) pinMessage(node.dataset.messageId);
    return;
  }

  const editButton = event.target.closest('[data-action="edit"]');
  if (editButton) {
    const node = editButton.closest('.message');
    if (node?.dataset.messageId) editMessage(node.dataset.messageId);
    return;
  }

  const deleteButton = event.target.closest('[data-action="delete"]');
  if (deleteButton) {
    const node = deleteButton.closest('.message');
    if (node?.dataset.messageId) deleteMessage(node.dataset.messageId);
    return;
  }

  const chip = event.target.closest('.reaction-chip');
  if (chip) {
    const node = chip.closest('.message');
    const emoji = chip.dataset.emoji;
    if (node?.dataset.messageId && emoji) {
      sendMessageReaction(node.dataset.messageId, emoji);
    }
  }
}

async function copyMessage(messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) return;
  const text = message.text || message.attachment?.name || '';
  if (!text) return;

  try {
    await copyText(text);
    toast(t('chat.copied'), 'info', 2200);
  } catch {
    toast(t('chat.copyFailed'), 'error', 3200);
  }
}

function openReactionPopover(anchor, messageId) {
  closeReactionPopover();
  if (!anchor || !REACTIONS.length) return;

  const popover = el('div', 'reaction-popover');
  popover.setAttribute('role', 'menu');

  for (const emoji of REACTIONS) {
    const button = el('button', 'reaction-choice');
    button.type = 'button';
    button.dataset.emoji = emoji;
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-label', t('chat.reactWith', { emoji: `:${emoji}:` }));
    button.append(customEmojiImage(emoji, 'custom-emoji custom-emoji-sm'));
    button.addEventListener('click', () => {
      closeReactionPopover();
      sendMessageReaction(messageId, emoji);
    });
    popover.append(button);
  }

  document.body.append(popover);

  const rect = anchor.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
  let top = rect.top - popRect.height - 6;
  if (top < 8) top = Math.min(rect.bottom + 6, window.innerHeight - popRect.height - 8);

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;

  state.reactionPopover = popover;
}

function closeReactionPopover() {
  if (!state.reactionPopover) return;
  state.reactionPopover.remove();
  state.reactionPopover = null;
}

async function sendMessageReaction(messageId, emoji) {
  if (!state.socket?.connected) {
    toast(t('chat.reactOffline'), 'error', 3200);
    return;
  }
  try {
    const response = await emitAck('chat:react', { messageId, emoji });
    if (!response?.ok) throw new Error(joinErrorKey(response?.error));
  } catch (error) {
    toast(errorText(error, 'chat.reactionFailed'), 'error', 3600);
  }
}

function buildRoomEmojiMenu() {
  els.emojiMenu.replaceChildren();
  const search = el('input', 'emoji-search');
  search.type = 'search';
  search.placeholder = t('emoji.search');
  search.setAttribute('aria-label', t('emoji.search'));
  const tabs = el('div', 'emoji-tabs');
  let activeCat = 'all';
  const renderGrid = (query = '') => {
    const grid = $('#emoji-grid', els.emojiMenu);
    if (!grid) return;
    grid.replaceChildren();
    const isStickerCat = STICKER_CATEGORIES.some((c) => c.id === activeCat);
    if (activeCat === 'gif') {
      // v12: Giphy search (server proxy) + Trending/Random + My custom
      // stickers (IndexedDB) + paste-link fallback — shared gif-panel.js.
      buildGifPanel(grid, {
        query,
        t,
        toast,
        onInsert: (url) => { insertEmoji(url); closeEmojiMenu(); },
        onSendCustomSticker: async (file) => { closeEmojiMenu(); await uploadFile(file); },
        onOpenStickerCreator: () => openStickerCreator({ t, toast })
      });
      return;
    }
    grid.classList.remove('is-panel');
    let list;
    if (isStickerCat && !query) {
      list = CUSTOM_STICKERS.filter((e) => e.cat === activeCat).map((e) => ({ ...e, kind: 'sticker' }));
    } else if (isStickerCat && query) {
      list = searchStickers(query).map((e) => ({ ...e, kind: 'sticker' }));
    } else if (query) {
      const emojis = searchEmojis(query).map((e) => ({ ...e, kind: 'emoji' }));
      const stickers = searchStickers(query).map((e) => ({ ...e, kind: 'sticker' }));
      list = [...emojis, ...stickers];
    } else if (activeCat === 'recent') {
      list = getRecentEmojis()
        .map((id) => {
          const e = CUSTOM_EMOJIS.find((x) => x.id === id);
          const s = CUSTOM_STICKERS.find((x) => x.id === id);
          return e ? { ...e, kind: 'emoji' } : s ? { ...s, kind: 'sticker' } : null;
        })
        .filter(Boolean);
      if (!list.length) { grid.append(el('div', 'emoji-empty', t('emoji.noRecent'))); return; }
    } else {
      list = activeCat === 'all' ? CUSTOM_EMOJIS.map((e) => ({ ...e, kind: 'emoji' })) : CUSTOM_EMOJIS.filter((e) => e.cat === activeCat).map((e) => ({ ...e, kind: 'emoji' }));
    }
    if (!list.length) { grid.append(el('div', 'emoji-empty', t('emoji.noResults'))); return; }
    for (const entry of list) {
      const emoji = typeof entry === 'string' ? entry : entry.id;
      const kind = entry.kind || 'emoji';
      const button = el('button', 'emoji-choice');
      button.type = 'button';
      button.dataset.emoji = emoji;
      const label = kind === 'sticker' ? stickerLabel(emoji, locale()) : emojiLabel(emoji, locale());
      button.setAttribute('aria-label', `${label} :${emoji}:`);
      button.setAttribute('role', 'option');
      button.title = `:${emoji}: — ${label}`;
      button.append(kind === 'sticker'
        ? customStickerImage(emoji, 'custom-sticker emoji-sticker')
        : customEmojiImage(emoji, 'custom-emoji custom-emoji-sm'));
      button.addEventListener('click', () => {
        insertEmoji(`:${emoji}:`);
        pushRecentEmoji(emoji);
        closeEmojiMenu();
      });
      grid.append(button);
    }
  };
  for (const cat of EMOJI_CATEGORIES) {
    const tab = el('button', 'emoji-tab', cat.id === 'recent' ? t('emoji.recent') : cat.id === 'all' ? t('emoji.all') : t(`emoji.cat.${cat.id}`));
    tab.type = 'button';
    tab.dataset.cat = cat.id;
    tab.setAttribute('aria-pressed', String(cat.id === activeCat));
    tab.addEventListener('click', () => {
      activeCat = cat.id;
      for (const b of tabs.querySelectorAll('.emoji-tab')) b.setAttribute('aria-pressed', String(b === tab));
      renderGrid(search.value);
    });
    tabs.append(tab);
  }
  for (const cat of STICKER_CATEGORIES) {
    // v12.1: localized tabs — Arabic labels in ar, English in en
    // (was hardcoded cat.en, so Arabic users always saw English).
    const tab = el('button', 'emoji-tab sticker-tab', locale() === 'ar' ? cat.ar : cat.en);
    tab.type = 'button';
    tab.dataset.cat = cat.id;
    tab.setAttribute('aria-pressed', String(cat.id === activeCat));
    tab.title = `${cat.en} / ${cat.ar}`;
    tab.addEventListener('click', () => {
      activeCat = cat.id;
      for (const b of tabs.querySelectorAll('.emoji-tab')) b.setAttribute('aria-pressed', String(b === tab));
      renderGrid(search.value);
    });
    tabs.append(tab);
  }
  const gifTab = el('button', 'emoji-tab', 'GIF');
  gifTab.type = 'button';
  gifTab.dataset.cat = 'gif';
  gifTab.setAttribute('aria-pressed', String(activeCat === 'gif'));
  gifTab.addEventListener('click', () => {
    activeCat = 'gif';
    for (const b of tabs.querySelectorAll('.emoji-tab')) b.setAttribute('aria-pressed', String(b === gifTab));
    renderGrid(search.value);
  });
  tabs.append(gifTab);
  const grid = el('div', 'emoji-grid');
  grid.id = 'emoji-grid';
  els.emojiMenu.setAttribute('role', 'dialog');
  els.emojiMenu.setAttribute('aria-label', t('chat.insertEmoji'));
  grid.setAttribute('role', 'listbox');
  els.emojiMenu.append(search, tabs, grid);
  search.addEventListener('input', () => renderGrid(search.value));
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEmojiMenu(); e.stopPropagation(); });
  renderGrid();
}

function toggleEmojiMenu() {
  if (!els.emojiMenu) return;
  const willOpen = els.emojiMenu.hidden;
  if (willOpen) { closeGifMenu(); closeStickerMenu(); }
  els.emojiMenu.hidden = !willOpen;
  if (willOpen) {
    const rect = els.emojiBtn?.getBoundingClientRect();
    if (rect) {
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
  }
  els.emojiBtn?.setAttribute('aria-expanded', String(willOpen));
  // Do NOT steal focus from the composer on open — users type while the
  // picker is open. Focus stays in the message input (usage improvement).
}

function closeEmojiMenu() {
  if (!els.emojiMenu || els.emojiMenu.hidden) return;
  els.emojiMenu.hidden = true;
  els.emojiBtn?.setAttribute('aria-expanded', 'false');
}

/* ---------------- Dedicated GIF + Sticker menus (v12.1) ---------------- */
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
function closeAllPickers() { closeEmojiMenu(); closeGifMenu(); closeStickerMenu(); }
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
    query: '',
    t,
    toast,
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

function insertEmoji(emoji) {
  const input = els.messageInput;
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${emoji}${input.value.slice(end)}`;
  const next = start + emoji.length;
  input.focus();
  input.setSelectionRange(next, next);
  handleDraftInput();
}

function toggleReactionMenu() {
  if (!els.reactionMenu) return;
  const willOpen = els.reactionMenu.hidden;
  els.reactionMenu.hidden = !willOpen;
  els.reactionBtn.setAttribute('aria-expanded', String(willOpen));
}

function closeReactionMenu() {
  if (!els.reactionMenu || els.reactionMenu.hidden) return;
  els.reactionMenu.hidden = true;
  els.reactionBtn.setAttribute('aria-expanded', 'false');
}

function floatReaction(name, emoji) {
  if (!els.reactionLayer) return;
  // Legacy "custom:<id>" form still renders; anything else is ignored.
  const id = typeof emoji === 'string' && emoji.startsWith('custom:') ? emoji.slice(7) : emoji;
  if (!isCustomEmoji(id)) return;
  const node = el('div', 'floating-reaction');
  node.append(customEmojiImage(id), el('small', '', name));
  node.style.left = `${8 + Math.random() * 78}%`;
  els.reactionLayer.append(node);
  setTimeout(() => node.remove(), 3200);
}

function floatCustomEmoji(name, emojiId, label = '') {
  if (!els.reactionLayer) return;
  const node = el('div', 'floating-reaction');
  node.append(customEmojiImage(emojiId || 'star'), el('small', '', label ? `${name} · ${label}` : name));
  node.style.left = `${8 + Math.random() * 78}%`;
  els.reactionLayer.append(node);
  setTimeout(() => node.remove(), 3200);
}

/* ---------------- Typing & composer ---------------- */

function handleDraftInput() {
  autosizeInput();

  try {
    const value = els.messageInput.value;
    if (value) localStorage.setItem(`hush:draft:${state.code}`, value);
    else localStorage.removeItem(`hush:draft:${state.code}`);
  } catch {
    // Drafts are best-effort.
  }

  const hasText = els.messageInput.value.trim().length > 0;
  if (!state.socket?.connected) return;

  if (hasText) {
    if (!state.typingActive) {
      state.typingActive = true;
      state.socket.emit('chat:typing', { typing: true });
    }
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(stopTyping, 2600);
  } else {
    stopTyping();
  }
}

function stopTyping() {
  clearTimeout(state.typingTimer);
  state.typingTimer = null;
  if (!state.typingActive) return;
  state.typingActive = false;
  state.socket?.emit('chat:typing', { typing: false });
}

function setTypingUser(id, name, typing) {
  if (!id) return;
  const existing = state.typingUsers.get(id);
  if (existing?.timer) clearTimeout(existing.timer);

  if (!typing) {
    state.typingUsers.delete(id);
    renderTyping();
    return;
  }

  const timer = setTimeout(() => {
    state.typingUsers.delete(id);
    renderTyping();
  }, 4200);

  state.typingUsers.set(id, { name: name || t('chat.guest'), timer });
  renderTyping();
}

function removeTyping(id) {
  const existing = state.typingUsers.get(id);
  if (!existing) return;
  if (existing.timer) clearTimeout(existing.timer);
  state.typingUsers.delete(id);
  renderTyping();
}

function renderTyping() {
  if (!els.typing) return;
  const names = [...state.typingUsers.values()].map((entry) => entry.name);
  if (!names.length) {
    els.typing.replaceChildren();
    return;
  }

  let text;
  if (names.length === 1) text = t('chat.typingOne', { name: names[0] });
  else if (names.length === 2) text = t('chat.typingTwo', { a: names[0], b: names[1] });
  else text = t('chat.typingMany', { count: names.length });

  els.typing.replaceChildren(el('span', 'typing-dots', text));
}

function autosizeInput() {
  if (!els.messageInput) return;
  els.messageInput.style.height = 'auto';
  els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 120)}px`;
}

async function sendFromComposer() {
  const text = els.messageInput.value.replace(/\s+$/g, '');
  if (!text.trim()) {
    els.messageInput.focus();
    return;
  }

  els.messageInput.value = '';
  try { localStorage.removeItem(`hush:draft:${state.code}`); } catch {}
  autosizeInput();
  stopTyping();

  const sent = await sendChat({ text: text.slice(0, 2000) });
  if (!sent && !els.messageInput.value) {
    els.messageInput.value = text;
    autosizeInput();
  }
  els.messageInput.focus();
}

async function sendChat({ text = '', attachment = null } = {}) {
  if (!state.socket?.connected || !state.online) {
    toast(t('chat.offlineSend'), 'error', 3800);
    return false;
  }

  try {
    const response = await emitAck('chat:send', { text, attachment });
    if (!response?.ok) throw new Error(joinErrorKey(response?.error));
    return true;
  } catch (error) {
    toast(errorText(error, 'error.sendFailed'), 'error', 4200);
    return false;
  }
}

/* ---------------- Paste image (Ctrl+V) ---------------- */

function handlePasteImage(event) {
  const items = event.clipboardData?.items ? [...event.clipboardData.items] : [];
  const files = event.clipboardData?.files ? [...event.clipboardData.files] : [];
  let file = files.find((f) => f.type.startsWith('image/')) || null;
  if (!file) {
    const item = items.find((i) => i.type.startsWith('image/'));
    file = item?.getAsFile?.() || null;
  }
  if (!file) return; // let normal text paste through untouched
  event.preventDefault();
  event.stopPropagation();
  if (!state.online || !state.socket?.connected) {
    // Still allow the join gate: queue nothing, just inform.
    toast(t('chat.offlineUpload'), 'error', 3800);
    return;
  }
  showComposerHint(t('chat.pasteImage'));
  // uploadFile shows its own hints; keep paste-specific name for screenshots.
  const named = file.name && /\.(png|jpe?g|gif|webp|avif)$/i.test(file.name)
    ? file
    : new File([file], `pasted-${Date.now()}.png`, { type: file.type || 'image/png' });
  uploadFile(named);
}

/* ---------------- In-page image lightbox ---------------- */

let lightboxReturnFocus = null;
function openImageLightbox(url, name) {
  const safe = safeAttachmentUrl(url);
  if (!safe || !els.imageLightbox || !els.imageLightboxImg) return;
  lightboxReturnFocus = document.activeElement;
  els.imageLightboxImg.src = safe;
  els.imageLightboxImg.alt = name || '';
  if (els.imageLightboxCaption) els.imageLightboxCaption.textContent = name || '';
  if (els.imageLightboxDownload) {
    els.imageLightboxDownload.href = safe;
    els.imageLightboxDownload.download = name || '';
  }
  els.imageLightbox.hidden = false;
  els.imageLightboxClose?.focus();
}

function closeImageLightbox() {
  if (!els.imageLightbox || els.imageLightbox.hidden) return;
  els.imageLightbox.hidden = true;
  if (els.imageLightboxImg) els.imageLightboxImg.src = '';
  if (lightboxReturnFocus && document.contains(lightboxReturnFocus)) {
    try { lightboxReturnFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
  lightboxReturnFocus = null;
}

/* ---------------- Uploads ---------------- */

async function uploadFile(file) {
  if (!file) return;
  if (!state.online || !state.socket?.connected) {
    toast(t('chat.offlineUpload'), 'error', 3800);
    return;
  }

  const extension = `.${String(file.name).split('.').pop() || ''}`.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    toast(t('upload.unsupported'), 'error', 4200);
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    toast(t('upload.tooLarge'), 'error', 4200);
    return;
  }

  showComposerHint(t('upload.uploading', { name: file.name }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const body = new FormData();
    body.append('file', file);

    const response = await fetch(`/api/rooms/${encodeURIComponent(state.code)}/upload`, {
      method: 'POST',
      body,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(uploadErrorKey(data.error, response.status));

    hideComposerHint();
    await sendChat({ text: '', attachment: data });
  } catch (error) {
    toast(errorText(error, 'upload.failed'), 'error', 4800);
  } finally {
    clearTimeout(timeout);
    hideComposerHint();
  }
}

function uploadErrorKey(code, status) {
  switch (code) {
    case 'room-not-found':
      return 'error.uploadRoomGone';
    case 'unsupported-file-type':
      return 'error.uploadUnsupported';
    case 'LIMIT_FILE_SIZE':
    case 'limit_file_size':
      return 'error.uploadTooLarge';
    case 'rate-limited':
      return 'error.uploadRateLimited';
    default:
      return status === 413 ? 'error.uploadTooLarge' : 'error.uploadFailed';
  }
}

function showComposerHint(text) {
  if (!els.composerHint) return;
  els.composerHint.textContent = text;
  els.composerHint.hidden = !text;
}

function hideComposerHint() {
  showComposerHint('');
}

/* ---------------- Room tools ---------------- */

function loadSoundsOn() {
  return getSoundsEnabled();
}

function toggleSounds() {
  state.soundsOn = !state.soundsOn;
  setSoundsEnabled(state.soundsOn);
  updateSoundUi();
  if (state.soundsOn) playChime();
  toast(t(state.soundsOn ? 'tools.soundsEnabled' : 'tools.soundsDisabled'), 'info', 2400);
}

function updateSoundUi() {
  if (!els.soundToggle) return;
  els.soundToggle.setAttribute('aria-pressed', String(state.soundsOn));
  els.soundToggle.title = t('tools.sounds');
  els.soundToggle.setAttribute('aria-label', t('tools.sounds'));
  if (els.soundLabel) {
    els.soundLabel.textContent = t(state.soundsOn ? 'tools.soundOn' : 'tools.soundOff');
  }
  const use = els.soundToggle.querySelector('use');
  if (use) use.setAttribute('href', state.soundsOn ? '#i-bell' : '#i-bell-off');
}

function updateDropLabel() {
  if (els.panelChat) els.panelChat.dataset.dropLabel = t('chat.dropFile');
}

function playChime() {
  if (!state.soundsOn) return;
  playSound('message');
}

function saveTranscript() {
  if (!state.messages.length) {
    toast(t('tools.noMessages'), 'info', 3200);
    return;
  }

  const code = formatCode(state.code) || 'room';
  const savedAt = intlDateTime(new Date(), { dateStyle: 'medium', timeStyle: 'short' });
  const lines = [
    t('tools.transcriptHeader', { code }),
    t('tools.transcriptSavedAt', { date: savedAt }),
    ''
  ];

  for (const message of state.messages) {
    const when = formatTime(message.createdAt);
    const author = message.authorName || t('chat.guest');
    let line = `[${when}] ${author}: ${message.text || ''}`.trimEnd();
    if (message.attachment?.name) {
      line += ` [${t('upload.file')}: ${message.attachment.name}]`;
    }
    lines.push(line);
  }

  try {
    const blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hush-${state.code || 'room'}-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(t('tools.saved'), 'info', 2600);
  } catch {
    toast(t('error.generic'), 'error', 3600);
  }
}

function openShortcuts() {
  if (!els.shortcutsDialog) return;
  if (typeof els.shortcutsDialog.showModal === 'function') {
    if (!els.shortcutsDialog.open) els.shortcutsDialog.showModal();
  } else {
    els.shortcutsDialog.setAttribute('open', '');
  }
}

function closeShortcuts() {
  if (!els.shortcutsDialog) return;
  if (typeof els.shortcutsDialog.close === 'function') {
    if (els.shortcutsDialog.open) els.shortcutsDialog.close();
  } else {
    els.shortcutsDialog.removeAttribute('open');
  }
}

/* ---------------- Mic settings (Voice FX) ---------------- */

async function openMicSettings() {
  if (!els.micDialog) return;
  renderMicSettings();
  if (typeof els.micDialog.showModal === 'function') {
    if (!els.micDialog.open) els.micDialog.showModal();
  } else {
    els.micDialog.setAttribute('open', '');
  }
  await refreshMicDevices();
  startMicMeter();
}

function closeMicSettings() {
  stopMicMeter();
  if (!els.micDialog) return;
  if (typeof els.micDialog.close === 'function') {
    if (els.micDialog.open) els.micDialog.close();
  } else {
    els.micDialog.removeAttribute('open');
  }
  toast(t('tools.micSaved'), 'info', 1800);
}

async function refreshMicDevices() {
  if (!els.micDevice || !state.mesh) return;
  const current = state.mesh.getMicSettings().deviceId || '';
  const devices = await state.mesh.listMicDevices();
  const previous = els.micDevice.value;
  els.micDevice.replaceChildren();
  const fallback = document.createElement('option');
  fallback.value = '';
  fallback.textContent = t('tools.micDeviceDefault');
  els.micDevice.append(fallback);
  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId || '';
    option.textContent = device.label || `${t('tools.micDevice')} ${index + 1}`;
    els.micDevice.append(option);
  });
  els.micDevice.value = [...els.micDevice.options].some((o) => o.value === current)
    ? current
    : previous || '';
}

function renderMicSettings() {
  const settings = state.mesh?.getMicSettings() ?? { ...DEFAULT_MIC_SETTINGS };
  if (els.micLead) els.micLead.textContent = t('tools.micLead');
  if (els.micEnabledNote) els.micEnabledNote.textContent = t('tools.micOffNote');
  if (els.micEnhanceNote) els.micEnhanceNote.textContent = t('tools.micEnhanceNote');
  if (els.micMonitorWarn) els.micMonitorWarn.textContent = t('tools.micMonitorWarn');
  if (els.micPreset) {
    const labels = {
      off: t('tools.micPresetOff'),
      voice: t('tools.micPresetVoice'),
      podcast: t('tools.micPresetPodcast'),
      gaming: t('tools.micPresetGaming'),
      quiet: t('tools.micPresetQuiet')
    };
    for (const option of els.micPreset.options) {
      if (labels[option.value]) option.textContent = labels[option.value];
    }
    els.micPreset.value = MIC_PRESETS[settings.preset] ? settings.preset : 'voice';
  }
  if (els.micQuality) {
    const labels = {
      auto: t('tools.micQualityAuto'),
      performance: t('tools.micQualityPerformance'),
      quality: t('tools.micQualityQuality')
    };
    for (const option of els.micQuality.options) {
      if (labels[option.value]) option.textContent = labels[option.value];
    }
    els.micQuality.value = settings.quality || 'auto';
  }
  if (els.micEnabled) els.micEnabled.checked = Boolean(settings.enabled);
  if (els.micGate) els.micGate.checked = Boolean(settings.gate);
  if (els.micNoise) els.micNoise.checked = Boolean(settings.noiseSuppression);
  if (els.micEcho) els.micEcho.checked = Boolean(settings.echoCancellation);
  if (els.micAgc) els.micAgc.checked = Boolean(settings.autoGainControl);
  if (els.micEnhance) els.micEnhance.checked = settings.enhance !== false;
  if (els.micMonitor) els.micMonitor.checked = Boolean(settings.monitor);
  if (els.micAmp) els.micAmp.value = String(settings.amplificationDb ?? 6);
  if (els.micGateThreshold) els.micGateThreshold.value = String(settings.gateThresholdDb ?? -42);
  if (els.micDeDistort) els.micDeDistort.value = String(settings.deDistort ?? 25);
  if (els.micEnhanceStrength) {
    els.micEnhanceStrength.value = String(Math.round((settings.enhanceStrength ?? 0.85) * 100));
  }
  updateMicOutputs();
}

function updateMicOutputs() {
  if (els.micAmpValue && els.micAmp) els.micAmpValue.textContent = t('tools.micAmpValue', { value: els.micAmp.value });
  if (els.micGateThresholdValue && els.micGateThreshold) {
    els.micGateThresholdValue.textContent = t('tools.micGateThresholdValue', { value: els.micGateThreshold.value });
  }
  if (els.micDeDistortValue && els.micDeDistort) {
    els.micDeDistortValue.textContent = t('tools.micDeDistortValue', { value: els.micDeDistort.value });
  }
  if (els.micEnhanceStrengthValue && els.micEnhanceStrength) {
    els.micEnhanceStrengthValue.textContent = t('tools.micEnhanceStrengthValue', {
      value: els.micEnhanceStrength.value
    });
  }
}

/* ---------------- Host room settings (name + password) ---------------- */

function updateRoomSettingsVisibility() {
  if (!els.roomSettingsBtn) return;
  els.roomSettingsBtn.hidden = !state.isHost;
}

function openRoomSettings() {
  if (!els.roomSettingsDialog || !state.isHost) return;
  state.roomPasswordTouched = false;
  if (els.roomNameInput) els.roomNameInput.value = state.roomName || '';
  // Never echo the current password (only its hash exists server-side);
  // empty + untouched = "leave the password as it is".
  if (els.roomPasswordInput) {
    els.roomPasswordInput.value = '';
    els.roomPasswordInput.type = 'password';
  }
  els.roomPasswordToggle?.classList.remove('is-visible');
  hideRoomSettingsError();
  renderRoomSettingsLabels();
  if (typeof els.roomSettingsDialog.showModal === 'function') {
    if (!els.roomSettingsDialog.open) els.roomSettingsDialog.showModal();
  } else {
    els.roomSettingsDialog.setAttribute('open', '');
  }
  setTimeout(() => { try { els.roomNameInput?.focus(); } catch { /* ignore */ } }, 60);
}

function closeRoomSettings() {
  if (!els.roomSettingsDialog) return;
  if (typeof els.roomSettingsDialog.close === 'function') {
    if (els.roomSettingsDialog.open) els.roomSettingsDialog.close();
  } else {
    els.roomSettingsDialog.removeAttribute('open');
  }
}

function renderRoomSettingsLabels() {
  if (els.roomSettingsTitle) els.roomSettingsTitle.textContent = t('room.settingsTitle');
  if (els.roomSettingsLead) els.roomSettingsLead.textContent = t('room.settingsLead');
  if (els.roomSettingsBtnLabel) els.roomSettingsBtnLabel.textContent = t('room.settingsBtn');
  if (els.roomNameLabel) els.roomNameLabel.textContent = t('room.nameLabel');
  if (els.roomNameInput) els.roomNameInput.placeholder = t('room.namePlaceholder');
  if (els.roomNameHint) els.roomNameHint.textContent = t('room.nameHint');
  if (els.roomPasswordLabel) els.roomPasswordLabel.textContent = t('room.passwordLabel');
  if (els.roomPasswordInput) els.roomPasswordInput.placeholder = t('room.passwordPlaceholder');
  if (els.roomPasswordHint) {
    els.roomPasswordHint.textContent = t(state.roomHasPassword ? 'room.passwordHintSet' : 'room.passwordHintNone');
  }
  if (els.roomSettingsCancel) els.roomSettingsCancel.textContent = t('room.cancel');
  if (els.roomSettingsSave) els.roomSettingsSave.textContent = t('room.save');
  if (els.roomDiceBtn) {
    els.roomDiceBtn.title = t('room.diceTitle');
    els.roomDiceBtn.setAttribute('aria-label', t('room.diceTitle'));
  }
  if (els.roomPasswordToggle) {
    const show = els.roomPasswordInput && els.roomPasswordInput.type !== 'password';
    els.roomPasswordToggle.title = t(show ? 'password.hide' : 'password.show');
    els.roomPasswordToggle.setAttribute('aria-label', t(show ? 'password.hide' : 'password.show'));
  }
  if (els.roomSettingsClose) {
    els.roomSettingsClose.title = t('room.close');
    els.roomSettingsClose.setAttribute('aria-label', t('room.close'));
  }
}

function showRoomSettingsError(key) {
  if (!els.roomSettingsError) return;
  els.roomSettingsError.textContent = t(key);
  els.roomSettingsError.hidden = false;
}

function hideRoomSettingsError() {
  if (!els.roomSettingsError) return;
  els.roomSettingsError.textContent = '';
  els.roomSettingsError.hidden = true;
}

async function saveRoomSettings() {
  if (!state.isHost) return;
  const name = (els.roomNameInput?.value ?? '').trim().slice(0, ROOM_NAME_MAX);
  const password = normalizeRoomPassword(els.roomPasswordInput?.value ?? '');
  const passwordTouched = state.roomPasswordTouched;

  if (passwordTouched && password && !validRoomPassword(password)) {
    showRoomSettingsError('error.invalidRoomPassword');
    try { els.roomPasswordInput?.focus(); } catch { /* ignore */ }
    return;
  }

  if (els.roomSettingsSave) els.roomSettingsSave.disabled = true;
  try {
    if (name !== state.roomName) {
      const response = await emitAck('room:rename', { name });
      if (!response?.ok) {
        showRoomSettingsError(joinErrorKey(response?.error));
        return;
      }
      state.roomName = response.name ?? name;
      updateStageHeader();
      updateDocumentTitle();
    }

    if (passwordTouched) {
      const response = await emitAck('room:password', { password });
      if (!response?.ok) {
        showRoomSettingsError(joinErrorKey(response?.error));
        return;
      }
      state.roomHasPassword = Boolean(response.hasPassword);
      // The host's own device remembers the new password: refreshing the
      // page must not prompt them for it.
      saveRoomPassword(password);
      renderRoomSettingsLabels();
    }

    closeRoomSettings();
    toast(t('room.saved'), 'info', 2400);
  } catch (error) {
    const message = error?.message || '';
    showRoomSettingsError(message.startsWith('error.') ? message : 'error.generic');
  } finally {
    if (els.roomSettingsSave) els.roomSettingsSave.disabled = false;
  }
}

async function applyMicPreset() {
  const preset = MIC_PRESETS[els.micPreset?.value];
  if (!preset || !state.mesh) return;
  await state.mesh.setMicSettings({ ...preset, preset: els.micPreset.value });
  renderMicSettings();
}

function startMicMeter() {
  stopMicMeter();
  state.micMeterTimer = setInterval(() => {
    const level = state.mesh?.getMicLevel() ?? { rms: 0, gateOpen: true };
    const pct = Math.min(100, Math.max(0, (level.rms / 0.35) * 100));
    if (els.micMeterFill) els.micMeterFill.style.width = `${pct}%`;
    if (els.micGateState) {
      els.micGateState.textContent = t(level.gateOpen ? 'tools.micGateOpen' : 'tools.micGateClosed');
    }
  }, 100);
}

function stopMicMeter() {
  if (state.micMeterTimer) {
    clearInterval(state.micMeterTimer);
    state.micMeterTimer = null;
  }
}

/* ---------------- Media controls ---------------- */

async function toggleMic() {
  if (!state.mesh) return;
  state.mesh.resumeAudio();

  if (state.mesh.isOn('audio')) {
    state.mesh.disableMic();
  } else {
    const enabled = await state.mesh.enableMic();
    if (!enabled) return;
  }

  syncLocalMediaState();
  renderControls();
  feedback('light');
}

async function toggleCamera() {
  if (!state.mesh) return;

  if (state.mesh.isOn('camera')) {
    state.mesh.disableCamera();
  } else {
    const enabled = await state.mesh.enableCamera();
    if (!enabled) return;
    playSound('camera');
  }

  syncLocalMediaState();
  renderControls();
  syncTileMedia();
  feedback('light');
}

async function toggleScreen() {
  if (!state.mesh) return;

  if (state.mesh.isOn('screen')) {
    state.mesh.stopScreen();
  } else {
    // Most mobile browsers do not expose getDisplayMedia at all. Explain the
    // limitation instead of failing inside the media layer.
    if (!navigator.mediaDevices?.getDisplayMedia && isPhoneLayout()) {
      toast(t('screen.phoneShare'), 'error', 5200);
      return;
    }
    const started = await state.mesh.startScreen();
    if (!started) return;
    playSound('share');
  }

  feedback('light');
  syncLocalMediaState();
  renderControls();
  updateScreenStage();
}

function toggleHand() {
  state.handRaised = !state.handRaised;
  if (state.handRaised) playSound('hand');
  feedback('light');
  updatePresence();
  renderMoreSheet();
}

function feedback(kind = 'light') {
  if (getSettings().haptics === 'off') return;
  haptic(kind);
}

/* ---------------- Phone menus, sheet & screen extras ---------------- */

function toggleBarMenu(force) {
  if (!els.barMenu || !els.barMenuBtn) return;
  const open = typeof force === 'boolean' ? force : els.barMenu.hidden;
  els.barMenu.hidden = !open;
  els.barMenuBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    closeMoreSheet();
    feedback('light');
  }
}

function closeBarMenu() {
  toggleBarMenu(false);
}

function toggleMoreSheet(force) {
  if (!els.moreSheet || !els.moreBtn) return;
  const open = typeof force === 'boolean' ? force : els.moreSheet.hidden;
  if (open) {
    closeBarMenu();
    renderMoreSheet();
    els.moreSheet.hidden = false;
    if (els.moreScrim) els.moreScrim.hidden = false;
    // Next frame so the translate/opacity transition actually runs.
    requestAnimationFrame(() => {
      els.moreSheet?.classList.add('is-open');
      els.moreScrim?.classList.add('is-open');
    });
    els.moreBtn.setAttribute('aria-expanded', 'true');
    feedback('light');
  } else {
    els.moreSheet.classList.remove('is-open');
    els.moreScrim?.classList.remove('is-open');
    els.moreBtn.setAttribute('aria-expanded', 'false');
    const hide = () => {
      if (els.moreSheet && !els.moreSheet.classList.contains('is-open')) els.moreSheet.hidden = true;
      if (els.moreScrim) els.moreScrim.hidden = true;
    };
    setTimeout(hide, 220);
  }
}

function closeMoreSheet() {
  if (els.moreSheet && !els.moreSheet.hidden) toggleMoreSheet(false);
}

function renderMoreSheet() {
  if (!els.moreSheet) return;
  if (els.moreTitle) els.moreTitle.textContent = t('control.moreActions');
  if (els.moreLabel) els.moreLabel.textContent = t('control.more');
  if (els.moreBtn) {
    els.moreBtn.title = t('control.moreActions');
    els.moreBtn.setAttribute('aria-label', t('control.moreActions'));
  }
  if (els.moreHandLabel) {
    els.moreHandLabel.textContent = t(state.handRaised ? 'control.lowerHand' : 'control.raiseHand');
  }
  const handItem = els.moreSheet.querySelector('[data-more-action="hand"]');
  handItem?.setAttribute('aria-pressed', String(state.handRaised));
  const boardItem = els.moreSheet.querySelector('[data-more-action="board"]');
  boardItem?.setAttribute('aria-pressed', String(state.soundboardOpen));
  const deafenItem = els.moreSheet.querySelector('[data-more-action="deafen"]');
  deafenItem?.setAttribute('aria-pressed', String(state.deafened));
  if (els.moreDeafenLabel) els.moreDeafenLabel.textContent = t(state.deafened ? 'deafen.on' : 'deafen.off');
  if (els.moreBoardLabel) els.moreBoardLabel.textContent = t('soundboard.title');
  if (els.moreFlipLabel) els.moreFlipLabel.textContent = t('control.flipCamera');
  if (els.morePipLabel) els.morePipLabel.textContent = t('screen.pip');
  if (els.moreInviteLabel) els.moreInviteLabel.textContent = t('control.invite');
  if (els.moreMicLabel) els.moreMicLabel.textContent = t('control.micSettings');
  if (els.moreFlipBtn) els.moreFlipBtn.hidden = !state.media.camera;
  renderBarMenu();
  syncScreenPip();
}

function renderBarMenu() {
  if (!els.barMenu) return;
  const labels = {
    theme: 'control.theme',
    language: 'control.language',
    invite: 'control.invite',
    log: 'control.log',
    libraries: 'control.libraries',
    bug: 'control.bug',
    feature: 'control.feature'
  };
  els.barMenu.querySelectorAll('[data-bar-action]').forEach((item) => {
    const key = labels[item.dataset.barAction];
    const span = item.querySelector('span');
    if (key && span) span.textContent = t(key);
  });
  const installLabel = els.barMenu.querySelector('[data-bar-install-label]');
  if (installLabel) installLabel.textContent = t('control.install');
}

function bindPhoneMenus() {
  if (els.inviteShare && canNativeShare()) els.inviteShare.hidden = false;

  els.barMenuBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleBarMenu();
  });

  els.barMenu?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-bar-action]');
    if (!item) return;
    const action = item.dataset.barAction;
    closeBarMenu();
    runBarAction(action);
  });

  els.moreBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMoreSheet();
  });
  els.moreClose?.addEventListener('click', () => toggleMoreSheet(false));
  els.moreScrim?.addEventListener('click', () => toggleMoreSheet(false));
  els.moreSheet?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-more-action]');
    if (!item) return;
    runMoreAction(item.dataset.moreAction);
  });

  document.addEventListener('click', (event) => {
    if (!els.barMenu || els.barMenu.hidden) return;
    if (els.barMenu.contains(event.target) || els.barMenuBtn?.contains(event.target)) return;
    closeBarMenu();
  });

  buildMoreReactions();
  syncScreenPip();

  els.screenPip?.addEventListener('click', (event) => {
    event.stopPropagation();
    void toggleScreenPip();
  });

  bindSheetDrag({
    getSheet: () => els.sidePanel,
    getHandle: () => els.sidePanel?.querySelector('.side-tabs'),
    onClose: () => closeSheet()
  });
  bindTabSwipe({
    getHandle: () => els.sidePanel?.querySelector('.side-tabs'),
    onSwipe: (direction) => switchTab(direction > 0 ? 'people' : 'chat')
  });

  window.addEventListener('hush:settings', applyWakeLock);
}

function runBarAction(action) {
  switch (action) {
    case 'invite':
      els.inviteBtn?.click();
      break;
    case 'log':
      $('[data-open-log]')?.click();
      break;
    case 'libraries':
      $('[data-open-libraries-log]')?.click();
      break;
    case 'bug':
      $('[data-open-bug-report]')?.click();
      break;
    case 'feature':
      $('[data-open-feature-suggest]')?.click();
      break;
    case 'theme':
      $('.room-bar [data-theme-toggle]')?.click();
      break;
    case 'language':
      $('.room-bar [data-lang-toggle]')?.click();
      break;
    default:
      break;
  }
}

function runMoreAction(action) {
  switch (action) {
    case 'hand':
      toggleHand();
      break;
    case 'board':
      toggleSoundboard();
      closeMoreSheet();
      break;
    case 'deafen':
      toggleDeafen();
      renderMoreSheet();
      break;
    case 'flip':
      closeMoreSheet();
      void flipCamera();
      break;
    case 'pip':
      closeMoreSheet();
      void toggleScreenPip();
      break;
    case 'invite':
      closeMoreSheet();
      els.inviteBtn?.click();
      break;
    case 'mic-settings':
      closeMoreSheet();
      els.micSettingsBtn?.click();
      break;
    default:
      break;
  }
}

function applyWakeLock() {
  setWakeLock(Boolean(state.joinedAt) && getSettings().wakeLock !== 'off');
}

function buildMoreReactions() {
  if (!els.moreReactions || els.moreReactions.childElementCount) return;
  for (const emoji of REACTIONS) {
    const button = el('button');
    button.type = 'button';
    button.dataset.emoji = emoji;
    button.title = `:${emoji}:`;
    button.setAttribute('aria-label', t('chat.reactWith', { emoji: `:${emoji}:` }));
    button.append(customEmojiImage(emoji, 'custom-emoji custom-emoji-sm'));
    button.addEventListener('click', () => {
      state.socket?.emit('reaction:send', { emoji });
      feedback('light');
      closeMoreSheet();
    });
    els.moreReactions.append(button);
  }
}

function syncScreenPip() {
  const available =
    Boolean(els.screenStage && !els.screenStage.hidden) &&
    supportsPictureInPicture(els.screenVideo);
  const active = Boolean(
    available &&
    els.screenVideo &&
    document.pictureInPictureElement === els.screenVideo
  );
  if (els.screenPip) {
    els.screenPip.hidden = !available;
    els.screenPip.classList.toggle('is-active', active);
    els.screenPip.title = t(active ? 'screen.pipExit' : 'screen.pip');
    els.screenPip.setAttribute('aria-label', t(active ? 'screen.pipExit' : 'screen.pip'));
  }
  if (els.morePipBtn) els.morePipBtn.hidden = !available;
  if (els.morePipLabel) els.morePipLabel.textContent = t(active ? 'screen.pipExit' : 'screen.pip');
}

async function toggleScreenPip() {
  if (!els.screenVideo || els.screenStage?.hidden) return;
  if (!supportsPictureInPicture(els.screenVideo)) {
    toast(t('screen.pipUnavailable'), 'error');
    return;
  }
  const entered = await togglePictureInPicture(els.screenVideo);
  els.screenPip?.classList.toggle('is-active', Boolean(entered));
  if (els.morePipBtn) els.morePipBtn.classList.toggle('is-active', Boolean(entered));
  toast(t(entered ? 'screen.pipEntered' : 'screen.pipExited'), 'info', 1800);
}

async function flipCamera() {
  if (!state.mesh) return;
  if (!state.mesh.isOn('camera')) {
    toast(t('media.cameraFlipUnavailable'));
    return;
  }
  const flipped = await state.mesh.flipCamera();
  if (flipped) {
    feedback('success');
    toast(t('media.cameraFlipped'));
    syncTileMedia();
  } else {
    feedback('error');
    toast(t('media.cameraFlipFailed'), 'error');
  }
}

/* ---------------- Phone bottom sheet ---------------- */

function switchTab(tab) {
  state.activeTab = tab === 'people' ? 'people' : 'chat';
  const isChat = state.activeTab === 'chat';

  els.tabChat.classList.toggle('is-active', isChat);
  els.tabPeople.classList.toggle('is-active', !isChat);
  els.tabChat.setAttribute('aria-selected', String(isChat));
  els.tabPeople.setAttribute('aria-selected', String(!isChat));
  els.panelChat.hidden = !isChat;
  els.panelPeople.hidden = isChat;

  if (isChat) {
    setUnread(0);
    if (!state.searchQuery.trim()) scrollToLatest('auto');
  }

  // On phones the tabs live inside the bottom sheet: picking a tab means
  // the user wants to see it, so lift the sheet if it is still closed.
  if (isPhoneLayout() && !state.sheetOpen) openSheet();
}

/* ---------------- Phone bottom sheet ----------------
   <= 700px the side panel becomes a draggable-style bottom sheet over
   the stage. Desktop keeps the docked sidebar and never opens it. */

function isPhoneLayout() {
  return window.matchMedia?.(PHONE_LAYOUT_QUERY)?.matches ?? false;
}

function openSheet() {
  if (!els.sidePanel) return;
  state.sheetOpen = true;
  els.sidePanel.classList.add('is-open');
  els.sheetScrim?.classList.add('is-open');
  els.shell?.classList.add('is-sheet-open');
  els.chatFab?.setAttribute('aria-pressed', 'true');
  syncChatFab();
  closeBarMenu();
  closeMoreSheet();
}

function closeSheet() {
  if (!els.sidePanel) return;
  state.sheetOpen = false;
  els.sidePanel.classList.remove('is-open');
  els.sheetScrim?.classList.remove('is-open');
  els.chatFab?.setAttribute('aria-pressed', 'false');
  els.shell?.classList.remove('is-sheet-open');
  syncChatFab();
  // Keep whatever tab was active so reopening continues where the user left off.
  if (els.messageInput) els.messageInput.blur();
}

function setUnread(count) {
  state.unread = Math.max(0, Number(count) || 0);
  if (els.unreadBadge) {
    els.unreadBadge.hidden = state.unread === 0;
    els.unreadBadge.textContent = state.unread > 99 ? '99+' : String(state.unread);
  }
  syncChatFabBadge();
  if (els.jumpLatest) els.jumpLatest.hidden = state.unread === 0;
  updateDocumentTitle();
}

function syncChatFabBadge() {
  if (!els.chatFabBadge) return;
  // On phones the sheet hides the tab badge, so the FAB mirrors unread count.
  const show = state.unread > 0 && !state.sheetOpen;
  els.chatFabBadge.hidden = !show;
  els.chatFabBadge.textContent = state.unread > 99 ? '99+' : String(state.unread);
}

function syncChatFab() {
  if (!els.chatFab) return;
  const label = state.sheetOpen ? t('chat.closeChat') : t('chat.openChat');
  els.chatFab.title = label;
  els.chatFab.setAttribute('aria-label', label);
  if (els.chatFabLabel) els.chatFabLabel.textContent = t('chat.panelLabel');
  syncChatFabBadge();
}

function updateDocumentTitle() {
  const code = formatCode(state.code);
  let title = state.roomName
    ? t('meta.roomNameTitle', { name: state.roomName })
    : code
      ? t('meta.roomTitle', { code })
      : t('meta.roomUntitled');
  if (state.unread > 0) {
    title = t('meta.unreadTitle', { count: state.unread, title });
  }
  document.title = title;
}

/* ---------------- Invite, leave, status ---------------- */

async function copyInvite() {
  const url = `${window.location.origin}/r/${state.code}`;

  try {
    await copyText(url);
    toast(t('toast.inviteCopied'));
  } catch {
    toast(t('toast.copyFailed'), 'error', 4200);
  }
}

async function shareInvite() {
  const url = `${window.location.origin}/r/${state.code}`;
  const result = await shareUrl({ title: document.title, url });
  if (result === 'shared') {
    feedback('success');
    toast(t('toast.inviteShared'));
    return;
  }
  // Desktop browsers without the share sheet (or a cancelled share) fall
  // back to the copy path so the action never feels broken.
  if (result === 'unsupported') copyInvite();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  fallbackCopy(text);
}

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  document.body.append(area);
  area.select();
  const ok = document.execCommand?.('copy');
  area.remove();
  if (!ok) throw new Error('copy-failed');
}

function leaveRoom() {
  if (!window.confirm(t('confirm.leave'))) return;

  setWakeLock(false);
  stopTyping();
  try {
    state.socket?.emit('room:leave');
  } catch {
    // The socket may already be gone.
  }
  state.customSounds = [];
  state.mesh?.dispose();
  state.socket?.disconnect();
  window.location.href = '/';
}

function setStatus(mode, key) {
  state.statusMode = mode;
  state.statusKey = key;
  state.online = mode === 'online';
  applyStatusLabel();
  renderPeople();
}

function applyStatusLabel() {
  if (!els.status) return;
  els.status.dataset.state = state.statusMode;
  if (els.statusLabel) els.statusLabel.textContent = t(state.statusKey);
}

function toast(message, variant = 'info', timeout = 3200) {
  if (!els.toasts || !message) return;
  while (els.toasts.children.length >= 3) els.toasts.firstChild?.remove();
  const node = el('div', `toast${variant === 'error' ? ' is-error' : ''}`, message);
  if (variant === 'error') node.setAttribute('role', 'alert');
  els.toasts.append(node);

  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 180ms ease';
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

function emitAck(event, payload, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const socket = state.socket;
    if (!socket) {
      reject(new Error('error.notConnected'));
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error('error.serverNoResponse'));
    }, timeoutMs);

    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

/* ---------------- Language switching ---------------- */

function handleLanguageChange() {
  renderMessages();
  renderPinned();
  renderAll();
  renderSoundboardLabels();
  renderTyping();
  renderControls();
  updateDocumentTitle();
  updateSoundUi();
  updateDropLabel();
  applyStatusLabel();
  applyJoinError();
  if (els.joinBtn && !els.joinBtn.disabled) {
    els.joinBtn.textContent = t('join.idle');
  }
  closeReactionPopover();
  if (els.micDialog?.open) renderMicSettings();
  renderRoomSettingsLabels();
  renderJoinGateLabels();
  updateZoomLabels();
  // v12.1: picker tabs/labels are language-dependent — rebuild them.
  if (els.emojiMenu) buildRoomEmojiMenu();
  if (els.gifMenu) buildGifMenu();
  if (els.stickerMenu) buildStickerMenuPanel();
  updateNameCount();
  for (const [btn, key] of [[els.gifBtn, 'composer.gifTitle'], [els.stickerBtn, 'composer.stickerTitle']]) {
    if (btn) { btn.title = t(key); btn.setAttribute('aria-label', t(key)); }
  }
  renderMoreSheet();
  renderBarMenu();
  syncScreenPip();
}

/* ---------------- Keyboard shortcuts ---------------- */

function handleShortcut(event) {
  if (event.key === 'Escape') {
    if (els.moreSheet && !els.moreSheet.hidden) {
      toggleMoreSheet(false);
      return;
    }
    if (els.barMenu && !els.barMenu.hidden) {
      closeBarMenu();
      return;
    }
    if (els.screenStage?.classList.contains('is-enlarged')) {
      els.screenStage.classList.remove('is-enlarged');
      resetScreenZoom();
      syncScreenEnlarge();
      return;
    }
    if (isScreenZoomed() && !els.screenStage?.hidden) {
      resetScreenZoom();
      return;
    }
    if (stageClickTimer) cancelPendingStageClick();
    closeShortcuts();
    closeRoomSettings();
    closeMicSettings();
    closeReactionMenu();
    closeReactionPopover();
    closeAdminMenu();
    closeImageLightbox();
    closeAllPickers();
    toggleSoundboard(false);
    closeSheet();
    return;
  }

  if (els.shortcutsDialog?.open || els.micDialog?.open || els.roomSettingsDialog?.open) return;

  const target = event.target;
  const inField =
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') || target.isContentEditable);

  if (inField || event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === '/') {
    event.preventDefault();
    focusSearch();
    return;
  }

  if (event.key === '?') {
    event.preventDefault();
    openShortcuts();
    return;
  }

  if (!state.online) return;

  switch (event.key.toLowerCase()) {
    case 'm':
      event.preventDefault();
      toggleMic();
      break;
    case 'v':
      event.preventDefault();
      toggleCamera();
      break;
    case 's':
      event.preventDefault();
      toggleScreen();
      break;
    case 'h':
      event.preventDefault();
      toggleHand();
      break;
    case 'c':
      event.preventDefault();
      switchTab(state.activeTab === 'chat' ? 'people' : 'chat');
      break;
    case 't':
      event.preventDefault();
      toggleTheme();
      break;
    case 'f':
      event.preventDefault();
      toggleFocusMode();
      break;
    case 'p':
      event.preventDefault();
      refreshPing();
      break;
    case 'b':
      event.preventDefault();
      toggleSoundboard();
      break;
    case 'd':
      event.preventDefault();
      toggleDeafen();
      break;
    case '-':
    case '_':
      if (!els.screenStage?.hidden) {
        event.preventDefault();
        zoomByStep(1 / ZOOM_STEP);
      }
      break;
    case '+':
    case '=':
      if (!els.screenStage?.hidden) {
        event.preventDefault();
        zoomByStep(ZOOM_STEP);
      }
      break;
    case '0':
      if (!els.screenStage?.hidden && isScreenZoomed()) {
        event.preventDefault();
        resetScreenZoom();
      }
      break;
    default:
      break;
  }
}

/* ---------------- Day labels ---------------- */

function dayLabel(timestamp) {
  let date;
  try {
    date = new Date(timestamp);
  } catch {
    return '';
  }
  if (Number.isNaN(date.getTime())) return '';

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return t('date.today');
  if (date.toDateString() === yesterday.toDateString()) return t('date.yesterday');

  return intlDateTime(date, { weekday: 'long', month: 'short', day: 'numeric' }) || date.toDateString();
}

/* ---------------- Soundboard ---------------- */

let boardImageDataUrl = '';
let boardMyImageDataUrl = '';

function previewBoardImage(input, preview) {
  const file = input?.files?.[0];
  if (!file) { if (preview) { preview.hidden = true; preview.removeAttribute('src'); } return; }
  imageFileToDataUrl(file).then((url) => {
    if (input === els.boardImage) boardImageDataUrl = url; else boardMyImageDataUrl = url;
    if (preview) { preview.src = url; preview.hidden = false; }
  }).catch(() => toast(t('soundboard.invalidFile'), 'error', 3600));
}

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
  const invalid = validatePersonalAudio(file);
  if (invalid) { toast(t('soundboard.invalidFile'), 'error', 3600); return; }
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
      const full = (await getPersonalSoundSafe(sound.id)) || sound;
      const url = personalBlobUrl(full);
      if (url) playBlobSound(url);
    });
    wrap.append(button);
    const share = el('button', 'btn btn-quiet btn-sm soundboard-share', t('soundboard.myShare'));
    share.type = 'button';
    share.title = t('soundboard.myShare');
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

async function getPersonalSoundSafe(id) {
  try { const mod = await import('./soundboard-store.js'); return await mod.getPersonalSound(id); } catch { return null; }
}

async function sharePersonalSound(sound) {
  const full = (await getPersonalSoundSafe(sound.id)) || sound;
  if (!full) { toast(t('error.generic'), 'error', 3600); return; }
  if (!state.online || !state.socket?.connected) { toast(t('chat.offlineUpload'), 'error', 3600); return; }
  if (state.customSounds.length >= 12) { toast(t('soundboard.boardFull'), 'error', 3600); return; }
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
    body.append('addedById', state.selfId || '');
    body.append('addedBy', state.selfName || '');
    if (boardImageDataUrl) {
      try { const imgBlob = await (await fetch(boardImageDataUrl)).blob(); body.append('image', new File([imgBlob], 'cover.png', { type: imgBlob.type || 'image/png' })); } catch { /* image is optional */ }
    }
    const response = await fetch(`/api/rooms/${encodeURIComponent(state.code)}/soundboard`, { method: 'POST', body, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error === 'board-full' ? 'soundboard.boardFull' : 'error.generic');
    toast(t('soundboard.myShared'), 'info', 2400);
  } catch (error) { toast(errorText(error, 'error.generic'), 'error', 3600); }
  finally { clearTimeout(timeout); }
}

function stopWatchingScreen() {
  if (!state.activeScreenId || state.activeScreenId === state.selfId) return;
  state.hiddenScreenId = state.activeScreenId;
  updateScreenStage();
  toast(t('screen.stoppedWatching'), 'info', 2200);
}

// Enlarge = a fixed overlay layer over everything (always works, no
// Fullscreen-API dependency — the old fullscreen attempt was invisible/
// janky in Brave). Esc or the button shrinks back; zoom/pan computed for
// the enlarged layout would misplace the smaller view, so it resets.
function toggleScreenEnlarge() {
  const stage = els.screenStage;
  if (!stage || stage.hidden) return;
  const shrinking = stage.classList.contains('is-enlarged');
  stage.classList.toggle('is-enlarged');
  if (shrinking) resetScreenZoom();
  syncScreenEnlarge();
}

function syncScreenEnlarge() {
  const stage = els.screenStage;
  if (!stage) return;
  const enlarged = stage.classList.contains('is-enlarged');
  els.screenEnlarge?.setAttribute('aria-pressed', String(enlarged));
  if (els.screenEnlarge) {
    els.screenEnlarge.title = t(enlarged ? 'screen.shrink' : 'screen.enlarge');
    els.screenEnlarge.setAttribute('aria-label', t(enlarged ? 'screen.shrink' : 'screen.enlarge'));
  }
}

/* ---------------- Screen-share zoom & pan (v15) ----------------
   Wheel + pinch zoom, drag-to-pan while zoomed, double-click toggles 2x,
   live zoom % indicator, reset button, keyboard +/-/0. A pan-drag never
   fires the click-to-cycle handler, and double-click coexists with the
   single click (debounced) — see handleStageClick. */

function stopPropagationOnEvent(event) { event.stopPropagation(); }

function isScreenZoomed() {
  return screenZoom.scale !== 1 || screenZoom.x !== 0 || screenZoom.y !== 0;
}

function applyScreenTransform() {
  if (!els.screenVideo) return;
  els.screenVideo.style.transform = isScreenZoomed()
    ? `translate(${Math.round(screenZoom.x)}px, ${Math.round(screenZoom.y)}px) scale(${screenZoom.scale})`
    : '';
  els.screenStage?.classList.toggle('is-zoomed', isScreenZoomed());
  if (els.screenZoomLevel) {
    els.screenZoomLevel.textContent = `${Math.round(screenZoom.scale * 100)}%`;
  }
  if (els.screenZoomReset) els.screenZoomReset.disabled = !isScreenZoomed();
}

function clampPan() {
  const rect = els.screenStage?.getBoundingClientRect();
  if (!rect) return;
  // Keep the visible content inside the stage: the video box may zoom up to
  // (scale - 1) * half the stage beyond each edge.
  const maxX = Math.max(0, (rect.width * (screenZoom.scale - 1)) / 2);
  const maxY = Math.max(0, (rect.height * (screenZoom.scale - 1)) / 2);
  screenZoom.x = Math.min(maxX, Math.max(-maxX, screenZoom.x));
  screenZoom.y = Math.min(maxY, Math.max(-maxY, screenZoom.y));
}

// Zoom while keeping the given viewport point stationary (wheel at the
// cursor, pinch at the midpoint, double-click at the click point).
function zoomAtPoint(clientX, clientY, nextScale) {
  const rect = els.screenStage?.getBoundingClientRect();
  if (!rect) return;
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextScale));
  const prev = screenZoom.scale;
  if (next === ZOOM_MIN) {
    resetScreenZoom();
    return;
  }
  if (next === prev) {
    clampPan();
    applyScreenTransform();
    return;
  }
  const ratio = next / prev;
  const dx = clientX - rect.left - rect.width / 2;
  const dy = clientY - rect.top - rect.height / 2;
  screenZoom.x = dx - (dx - screenZoom.x) * ratio;
  screenZoom.y = dy - (dy - screenZoom.y) * ratio;
  screenZoom.scale = next;
  clampPan();
  applyScreenTransform();
}

function zoomByStep(factor) {
  const rect = els.screenStage?.getBoundingClientRect();
  if (!rect) return;
  zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, screenZoom.scale * factor);
}

function resetScreenZoom() {
  screenZoom.scale = 1;
  screenZoom.x = 0;
  screenZoom.y = 0;
  applyScreenTransform();
}

function updateZoomLabels() {
  if (els.screenZoomIn) {
    els.screenZoomIn.title = t('screen.zoomIn');
    els.screenZoomIn.setAttribute('aria-label', t('screen.zoomIn'));
  }
  if (els.screenZoomOut) {
    els.screenZoomOut.title = t('screen.zoomOut');
    els.screenZoomOut.setAttribute('aria-label', t('screen.zoomOut'));
  }
  if (els.screenZoomReset) {
    els.screenZoomReset.title = t('screen.zoomReset');
    els.screenZoomReset.setAttribute('aria-label', t('screen.zoomReset'));
  }
  applyScreenTransform();
}

function handleStageWheel(event) {
  if (!els.screenStage || els.screenStage.hidden) return;
  // Wheel over the shared screen always zooms (Ctrl+wheel included).
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
  const delta = -event.deltaY * unit;
  zoomAtPoint(event.clientX, event.clientY, screenZoom.scale * Math.exp(delta * 0.0022));
}

function handleStageDoubleClick(event) {
  if (!els.screenStage || els.screenStage.hidden) return;
  if (event.target.closest?.('.screen-zoom-bar, .screen-enlarge-btn, .screen-stop-btn')) return;
  event.preventDefault();
  cancelPendingStageClick();
  if (screenZoom.scale > 1) resetScreenZoom();
  else zoomAtPoint(event.clientX, event.clientY, 2);
}

let stageClickTimer = null;
function cancelPendingStageClick() {
  if (stageClickTimer) {
    clearTimeout(stageClickTimer);
    stageClickTimer = null;
  }
}

// Single click cycles between sharers — debounced so double-click zoom
// never triggers a cycle, and skipped right after a pan-drag.
function handleStageClick(event) {
  if (!els.screenStage || els.screenStage.hidden) return;
  if (screenPanDragged) {
    screenPanDragged = false;
    return;
  }
  cancelPendingStageClick();
  stageClickTimer = setTimeout(() => {
    stageClickTimer = null;
    cycleScreenShare();
  }, 240);
}

// Pointer tracking: one pointer + zoomed = drag-pan, two pointers = pinch.
const stagePointers = new Map();
let pinchBase = null;
let panGesture = null;
let screenPanDragged = false;

function isStageControl(event) {
  return Boolean(event.target.closest?.('.screen-zoom-bar, .screen-enlarge-btn, .screen-stop-btn'));
}

function pinchInfo() {
  const [a, b] = [...stagePointers.values()];
  if (!a || !b) return null;
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2
  };
}

function bindStagePointers() {
  if (!els.screenStage) return;
  els.screenStage.addEventListener('pointerdown', (event) => {
    if (els.screenStage.hidden) return;
    if (isStageControl(event)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (stagePointers.size === 1) {
      screenPanDragged = false;
      panGesture = screenZoom.scale > 1
        ? { startX: event.clientX, startY: event.clientY, baseX: screenZoom.x, baseY: screenZoom.y, moved: false }
        : null;
      try { els.screenStage.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    } else if (stagePointers.size === 2) {
      panGesture = null;
      pinchBase = pinchInfo();
      screenPanDragged = false;
    }
  });
  els.screenStage.addEventListener('pointermove', (event) => {
    if (!stagePointers.has(event.pointerId)) return;
    stagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (stagePointers.size >= 2 && pinchBase) {
      const info = pinchInfo();
      if (info) zoomAtPoint(info.cx, info.cy, pinchBase.scale * (info.dist / pinchBase.dist));
      screenPanDragged = true;
      return;
    }
    if (panGesture) {
      const dx = event.clientX - panGesture.startX;
      const dy = event.clientY - panGesture.startY;
      if (!panGesture.moved && Math.hypot(dx, dy) > 6) {
        panGesture.moved = true;
        screenPanDragged = true;
        els.screenStage.classList.add('is-panning');
      }
      if (panGesture.moved) {
        screenZoom.x = panGesture.baseX + dx;
        screenZoom.y = panGesture.baseY + dy;
        clampPan();
        applyScreenTransform();
      }
    }
  });
  const endPointer = (event) => {
    stagePointers.delete(event.pointerId);
    if (stagePointers.size < 2) pinchBase = null;
    els.screenStage.classList.remove('is-panning');
    if (stagePointers.size === 1 && screenZoom.scale > 1) {
      // Finger lifted mid-pinch: continue as a pan with the remaining one.
      const [only] = [...stagePointers.values()];
      panGesture = { startX: only.x, startY: only.y, baseX: screenZoom.x, baseY: screenZoom.y, moved: screenPanDragged };
    } else if (stagePointers.size === 0) {
      panGesture = null;
    }
  };
  els.screenStage.addEventListener('pointerup', endPointer);
  els.screenStage.addEventListener('pointercancel', endPointer);
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
      button.dataset.sound = sound.id;
      const face = el('span', 'soundboard-emoji');
      face.append(customEmojiImage(sound.emojiId));
      button.append(face);
      const name = el('span', 'soundboard-name');
      name.dataset.boardName = sound.id;
      name.textContent = t(`soundboard.${sound.id}`);
      button.append(name);
      button.addEventListener('click', () => playBoardSound(sound.id));
      grid.append(button);
    }
    els.soundboardGrid.append(grid);
  }
  const custom = state.customSounds.filter((s) => matches(String(s.id), s.name || ''));
  if (custom.length) {
    els.soundboardGrid.append(el('h4', 'soundboard-cat-title', t('soundboard.roomTitle')));
    const grid = el('div', 'soundboard-cat-grid');
    for (const sound of custom) {
      const wrap = el('span', 'soundboard-sound-wrap');
      const button = el('button', 'soundboard-sound is-custom');
      button.type = 'button';
      button.dataset.sound = sound.id;
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
      button.title = sound.name || '';
      button.addEventListener('click', () => playBoardSound(sound.id));
      wrap.append(button);
      const mine = sound.addedById === state.selfId;
      if (mine || state.isHost) {
        const del = el('button', 'custom-btn-delete', '×');
        del.type = 'button';
        del.title = t('soundboard.delete');
        del.setAttribute('aria-label', t('soundboard.delete'));
        del.addEventListener('click', (event) => { event.stopPropagation(); deleteCustomSound(sound.id); });
        wrap.append(del);
      }
      grid.append(wrap);
    }
    els.soundboardGrid.append(grid);
  }
  if (els.boardClearBtn) els.boardClearBtn.hidden = !(state.isHost && state.customSounds.length);
}

async function addCustomSound() {
  const file = els.boardFile?.files?.[0];
  if (!file) { toast(t('soundboard.invalidFile'), 'error', 3600); return; }
  if (state.customSounds.length >= 12) { toast(t('soundboard.boardFull'), 'error', 3600); return; }
  if (file.size > 2 * 1024 * 1024) { toast(t('soundboard.invalidFile'), 'error', 3600); return; }
  if (!/audio\//.test(file.type) && !/\.(mp3|wav|ogg|oga|m4a|webm|opus)$/i.test(file.name)) {
    toast(t('soundboard.invalidFile'), 'error', 3600);
    return;
  }
  if (els.boardAddBtn) els.boardAddBtn.disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const body = new FormData();
    body.append('file', file);
    body.append('name', els.boardName?.value || file.name.replace(/\.[^.]+$/, ''));
    body.append('emojiId', els.boardEmoji?.value || 'star');
    body.append('addedById', state.selfId || '');
    body.append('addedBy', state.selfName || '');
    const response = await fetch(`/api/rooms/${encodeURIComponent(state.code)}/soundboard`, { method: 'POST', body, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const key = data.error === 'board-full' ? 'soundboard.boardFull'
        : data.error === 'unsupported-file-type' || data.error === 'limit_file_size' ? 'soundboard.invalidFile'
        : 'error.generic';
      throw new Error(key);
    }
    if (els.boardFile) els.boardFile.value = '';
    if (els.boardName) els.boardName.value = '';
  } catch (error) {
    toast(errorText(error, 'error.generic'), 'error', 4200);
  } finally {
    clearTimeout(timeout);
    if (els.boardFile) els.boardFile.value = '';
    if (els.boardAddBtn) els.boardAddBtn.disabled = false;
  }
}

async function deleteCustomSound(id) {
  try {
    const response = await emitAck('soundboard:deleteCustom', { id }, 5000);
    if (!response?.ok) throw new Error(response?.error === 'not-admin' ? 'admin.notAdmin' : 'soundboard.invalidFile');
    toast(t('soundboard.removed'), 'info', 2200);
  } catch (error) {
    toast(errorText(error, 'error.generic'), 'error', 3600);
  }
}

async function clearCustomSounds() {
  try {
    const response = await emitAck('soundboard:clearCustom', {}, 5000);
    if (!response?.ok) throw new Error('admin.notAdmin');
  } catch (error) {
    toast(errorText(error, 'error.generic'), 'error', 3600);
  }
}

function toggleSoundboard(force) {
  state.soundboardOpen = typeof force === 'boolean' ? force : !state.soundboardOpen;
  if (els.soundboardPanel) els.soundboardPanel.hidden = !state.soundboardOpen;
  if (els.soundboardBtn) {
    els.soundboardBtn.setAttribute('aria-pressed', String(state.soundboardOpen));
    els.soundboardBtn.setAttribute('aria-expanded', String(state.soundboardOpen));
  }
  if (state.soundboardOpen) renderSoundboardLabels();
}

function renderSoundboardLabels() {
  if (els.soundboardTitle) els.soundboardTitle.textContent = t('soundboard.title');
  if (els.soundboardLabel) els.soundboardLabel.textContent = t('soundboard.open');
  if (els.boardAddTitle) els.boardAddTitle.textContent = t('soundboard.addTitle');
  if (els.boardAddNote) els.boardAddNote.textContent = t('soundboard.addNote');
  if (els.boardAddBtn) els.boardAddBtn.textContent = t('soundboard.add');
  if (els.boardClearBtn) els.boardClearBtn.textContent = t('soundboard.clearAll');
  if (els.boardName) els.boardName.placeholder = t('soundboard.addName');
  if (els.soundboardSearch) els.soundboardSearch.placeholder = t('soundboard.search');
  if (els.soundboardMyTitle) els.soundboardMyTitle.textContent = t('soundboard.myTitle');
  if (els.soundboardMyNote) els.soundboardMyNote.textContent = t('soundboard.myNote');
  if (els.boardMyTitle) els.boardMyTitle.textContent = t('soundboard.myTitle');
  if (els.boardMyAddBtn) els.boardMyAddBtn.textContent = t('soundboard.myAdd');
  if (els.boardMyName) els.boardMyName.placeholder = t('soundboard.addName');
  if (els.screenStopLabel) els.screenStopLabel.textContent = t('screen.stopWatching');
  syncScreenEnlarge();
  if (els.screenWatchLabel) els.screenWatchLabel.textContent = t('screen.watchAgain');
  if (els.boardEmoji) els.boardEmoji.setAttribute('aria-label', t('soundboard.chooseEmoji'));
  if (els.soundboardBtn) {
    els.soundboardBtn.title = t('soundboard.title');
    els.soundboardBtn.setAttribute('aria-label', t('soundboard.title'));
  }
  if (els.sheetClose) {
    els.sheetClose.title = t('chat.closePanel');
    els.sheetClose.setAttribute('aria-label', t('chat.closePanel'));
  }
  syncChatFab();
  if (els.deafenLabel) els.deafenLabel.textContent = t(state.deafened ? 'deafen.on' : 'deafen.off');
  if (els.deafenBtn) {
    els.deafenBtn.title = t(state.deafened ? 'deafen.on' : 'deafen.off');
    els.deafenBtn.setAttribute('aria-label', t(state.deafened ? 'deafen.on' : 'deafen.off'));
  }
  for (const node of document.querySelectorAll('[data-board-name]')) {
    node.textContent = t(`soundboard.${node.dataset.boardName}`);
  }
}

async function playBoardSound(id) {
  if (Date.now() < state.boardCooldownUntil) return;
  // Built-in: synth. Custom: play the uploaded file locally first.
  if (isSoundboardId(id)) {
    state.boardCooldownUntil = Date.now() + 700;
    playSoundboard(id);
  } else {
    const sound = state.customSounds.find((s) => s.id === id);
    if (!sound) return;
    state.boardCooldownUntil = Date.now() + 700;
    playCustomSound(sound.url);
  }
  if (state.socket?.connected && state.online) {
    try { await emitAck('soundboard:play', { id }, 4000); } catch { /* local play already happened */ }
  }
}

/* ---------------- Context menu (right-click): volume + admin ---------------- */

function openParticipantMenu(targetId, x, y) {
  if (!els.ctxMenu) return;
  const target = state.participants.get(targetId);
  if (!target) return;
  els.ctxMenu.replaceChildren();
  const title = el('div', 'ctx-title', t('admin.menuFor', { name: target.name }));
  els.ctxMenu.append(title);

  // Per-peer voice volume — available to everyone, not just the host.
  const volume = getPeerVolume(target);
  const section = el('div', 'ctx-volume');
  const row = el('div', 'ctx-volume-label');
  row.append(el('span', '', t('volume.title')));
  const valueOut = el('span', 'ctx-volume-value', `${Math.round(volume * 100)}%`);
  row.append(valueOut);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0'; slider.max = '200'; slider.step = '5';
  slider.value = String(Math.round(volume * 100));
  slider.setAttribute('aria-label', t('volume.for', { name: target.name }));
  slider.addEventListener('input', () => {
    const next = setPeerVolume(target, Number(slider.value) / 100);
    valueOut.textContent = `${Math.round(next * 100)}%`;
  });
  slider.addEventListener('change', () => playSound('click'));
  // Stop the slider from closing the menu via the document click handler.
  slider.addEventListener('click', (event) => event.stopPropagation());
  slider.addEventListener('pointerdown', (event) => event.stopPropagation());
  const quick = el('div', 'ctx-volume-quick');
  for (const [label, value] of [['0%', 0], ['50%', 0.5], ['100%', 1], ['150%', 1.5], ['200%', 2]]) {
    const btn = el('button', '', label);
    btn.type = 'button';
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const next = setPeerVolume(target, value);
      slider.value = String(Math.round(next * 100));
      valueOut.textContent = `${Math.round(next * 100)}%`;
    });
    quick.append(btn);
  }
  const muteRow = el('button', 'ctx-item', volume === 0 ? t('volume.unmute') : t('volume.mute'));
  muteRow.type = 'button';
  muteRow.setAttribute('role', 'menuitem');
  muteRow.addEventListener('click', () => {
    setPeerVolume(target, volume === 0 ? 1 : 0);
    closeAdminMenu();
  });
  const resetRow = el('button', 'ctx-item', t('volume.reset'));
  resetRow.type = 'button';
  resetRow.setAttribute('role', 'menuitem');
  resetRow.addEventListener('click', () => {
    setPeerVolume(target, 1);
    closeAdminMenu();
  });
  section.append(row, slider, quick);
  els.ctxMenu.append(section, muteRow, resetRow);

  // Admin actions only when you are the host.
  if (state.isHost) {
    els.ctxMenu.append(el('div', 'ctx-sep'));
    const mk = (label, danger, handler) => {
      const btn = el('button', `ctx-item${danger ? ' is-danger' : ''}`, label);
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.addEventListener('click', () => { closeAdminMenu(); handler(); });
      els.ctxMenu.append(btn);
    };
    mk(t('admin.kick'), true, () => adminAction('admin:kick', targetId, t('admin.kickConfirm', { name: target.name })));
    mk(t('admin.disconnect'), true, () => adminAction('admin:disconnect', targetId, t('admin.kickConfirm', { name: target.name })));
    mk(t('admin.mute'), false, () => adminAction('admin:mute', targetId, null));
    mk(t('admin.ban'), true, () => adminAction('admin:ban', targetId, t('admin.banConfirm', { name: target.name, minutes: 60 })));
    mk(t('admin.transfer'), false, () => adminAction('admin:transfer', targetId, null));
  }

  els.ctxMenu.hidden = false;
  const w = 240, h = els.ctxMenu.offsetHeight || 240;
  els.ctxMenu.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
  els.ctxMenu.style.top = `${Math.min(y, window.innerHeight - h - 8)}px`;
  playSound('click');
}

// Backwards-compatible alias (older code path).
function openAdminMenu(targetId, x, y) { openParticipantMenu(targetId, x, y); }

function closeAdminMenu() {
  if (els.ctxMenu) els.ctxMenu.hidden = true;
}

async function adminAction(event, targetId, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  try {
    const response = await emitAck(event, { targetId, minutes: 60 });
    if (!response?.ok) throw new Error(joinErrorKey(response?.error));
    playSound('success');
  } catch (error) {
    toast(errorText(error, 'error.generic'), 'error', 3600);
  }
}

/* ---------------- Global listeners ---------------- */

els.messages?.addEventListener('scroll', handleMessagesScroll, { passive: true });
els.messages?.addEventListener('click', handleMessagesClick);

document.addEventListener('click', (event) => {
  if (state.reactionPopover && !state.reactionPopover.contains(event.target)) {
    closeReactionPopover();
  }
});

window.addEventListener('resize', closeReactionPopover);
window.addEventListener('scroll', closeReactionPopover, true);
