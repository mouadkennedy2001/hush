/**
 * Mobile comfort layer for Hush.
 *
 * Everything here is progressive: unsupported browsers silently keep the
 * desktop behaviour. The module owns four phone-only concerns:
 *   - viewport variables (keyboard-aware bottom sheet + safe areas)
 *   - haptic feedback
 *   - screen wake lock during a call
 *   - native share sheet + drag/swipe gestures on the bottom sheet
 */

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

export function isPhoneViewport() {
  return isBrowser ? window.matchMedia?.('(max-width: 700px)')?.matches ?? false : false;
}

export function isStandalone() {
  if (!isBrowser) return false;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}

export function canNativeShare() {
  return isBrowser && typeof navigator.share === 'function';
}

export function canHaptic() {
  return isBrowser && typeof navigator.vibrate === 'function';
}

/** Short haptic pulse. `kind` is a semantic name, not a duration. */
export function haptic(kind = 'light') {
  if (!canHaptic()) return;
  const patterns = {
    light: 8,
    medium: 14,
    heavy: 22,
    success: [10, 40, 10],
    error: [18, 50, 18]
  };
  try {
    navigator.vibrate(patterns[kind] ?? patterns.light);
  } catch {
    /* vibration can be blocked by the browser */
  }
}

export async function shareUrl(payload = {}) {
  if (!canNativeShare()) return 'unsupported';
  try {
    await navigator.share(payload);
    return 'shared';
  } catch (error) {
    return error?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/**
 * Publish `--app-vh` (visible viewport height) and `--kb-inset` (space the
 * on-screen keyboard covers). The CSS uses them to keep the composer and
 * the bottom sheet above the keyboard on iOS and Android.
 */
export function initViewportVars() {
  if (!isBrowser) return () => {};
  const root = document.documentElement;
  const viewport = window.visualViewport;

  const apply = () => {
    const height = viewport ? viewport.height : window.innerHeight;
    const inset = viewport
      ? Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop))
      : 0;
    root.style.setProperty('--app-vh', `${Math.round(height)}px`);
    root.style.setProperty('--kb-inset', `${Math.round(inset)}px`);
    root.classList.toggle('is-keyboard-open', inset > 120);
  };

  apply();
  viewport?.addEventListener('resize', apply);
  viewport?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 250));
  return apply;
}

/* ---------------- Wake lock ---------------- */

let wakeLockSentinel = null;
let wakeLockWanted = false;

async function acquireWakeLock() {
  if (!wakeLockWanted || !isBrowser || document.visibilityState !== 'visible') return;
  if (!('wakeLock' in navigator)) return;
  if (wakeLockSentinel) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
  } catch {
    wakeLockSentinel = null;
  }
}

function releaseWakeLock() {
  try {
    wakeLockSentinel?.release?.();
  } catch {
    /* already released */
  }
  wakeLockSentinel = null;
}

/** Keep the screen awake while in a call (default: on). */
export function setWakeLock(enabled) {
  wakeLockWanted = Boolean(enabled);
  if (wakeLockWanted) acquireWakeLock();
  else releaseWakeLock();
}

export function initWakeLock() {
  if (!isBrowser) return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeLockWanted) acquireWakeLock();
  });
}

export function wakeLockActive() {
  return Boolean(wakeLockSentinel);
}

/* ---------------- Bottom-sheet gestures ---------------- */

/**
 * Drag the sheet down to dismiss. The listener lives on the tab bar so it
 * never fights the message list's own scrolling.
 */
export function bindSheetDrag({ getSheet, getHandle, onClose, isEnabled = isPhoneViewport }) {
  const handle = getHandle?.();
  if (!handle) return;

  let dragging = false;
  let startY = 0;
  let delta = 0;

  const sheet = () => getSheet?.();
  const reset = () => {
    const node = sheet();
    if (node) {
      node.style.transition = '';
      node.style.transform = '';
    }
    delta = 0;
    dragging = false;
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || !isEnabled()) return;
    if (event.target.closest('button, a, input')) return;
    dragging = true;
    startY = event.clientY;
    delta = 0;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* not fatal */
    }
  });

  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    delta = event.clientY - startY;
    const node = sheet();
    if (!node) return;
    if (delta > 0) {
      node.style.transition = 'none';
      node.style.transform = `translateY(${Math.min(delta, 240)}px)`;
    } else {
      node.style.transform = '';
    }
  });

  const finish = (event) => {
    if (!dragging) return;
    const shouldClose = delta > 84 && event.type !== 'pointercancel';
    reset();
    if (shouldClose) onClose?.();
  };

  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}

/**
 * Horizontal swipe on the tab bar switches Chat <-> People. RTL users get
 * the mirrored direction automatically.
 */
export function bindTabSwipe({ getHandle, onSwipe, threshold = 48 }) {
  const handle = getHandle?.();
  if (!handle) return;

  let startX = 0;
  let startY = 0;
  let tracking = false;

  handle.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || !isPhoneViewport()) return;
    if (event.target.closest('button, a, input')) return;
    tracking = true;
    startX = event.clientX;
    startY = event.clientY;
  });

  handle.addEventListener('pointerup', (event) => {
    if (!tracking) return;
    tracking = false;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const rtl = document.documentElement.dir === 'rtl';
    const direction = dx > 0 ? -1 : 1;
    onSwipe?.(rtl ? -direction : direction);
  });

  handle.addEventListener('pointercancel', () => {
    tracking = false;
  });
}

/** iOS Safari's old webkitPresentationMode is the only PiP path there. */
export function supportsPictureInPicture(video) {
  if (!isBrowser || !video) return false;
  if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
    return true;
  }
  return typeof video.webkitSetPresentationMode === 'function';
}

export async function togglePictureInPicture(video) {
  if (!video) return false;
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      return false;
    }
    if (typeof video.requestPictureInPicture === 'function') {
      await video.requestPictureInPicture();
      return true;
    }
    if (typeof video.webkitSetPresentationMode === 'function') {
      const next = video.webkitPresentationMode === 'picture-in-picture'
        ? 'inline'
        : 'picture-in-picture';
      video.webkitSetPresentationMode(next);
      return next === 'picture-in-picture';
    }
  } catch {
    /* blocked by the browser or no video track */
  }
  return Boolean(document.pictureInPictureElement);
}
