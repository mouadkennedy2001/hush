/**
 * Hush — shared room-password generator + dice roll animation.
 *
 * Used by BOTH the landing "create room" dialog and the in-room host
 * "Room settings" dialog, so they stay perfectly in sync: the same word
 * list, the same strength rules, the same dice roll feel.
 *
 * Password shape: word-word-word-NN (three short memorable words + two
 * digits). ~17-21 chars, only lowercase letters and digits — easy to read
 * aloud on a phone and to type on Arabic/English keyboards alike.
 */

const DICE_WORDS = [
  'amber', 'anchor', 'apple', 'arrow', 'atlas', 'autumn', 'bamboo', 'beacon',
  'birch', 'blossom', 'brave', 'breeze', 'brook', 'canyon', 'cedar', 'charm',
  'cinder', 'citrus', 'clover', 'cobalt', 'comet', 'coral', 'cosmos', 'cotton',
  'crane', 'crimson', 'crystal', 'dahlia', 'dapper', 'dawn', 'delta', 'denim',
  'diamond', 'dolphin', 'drift', 'ember', 'emerald', 'fable', 'falcon', 'fern',
  'fjord', 'flint', 'forest', 'fox', 'galaxy', 'garnet', 'ginger',
  'glacier', 'granite', 'harbor', 'harvest', 'hazel', 'heron', 'hollow', 'indigo',
  'ivory', 'jasper', 'jungle', 'juniper', 'kelvin', 'lagoon', 'lantern', 'larch',
  'linden', 'lotus', 'lunar', 'mango', 'maple', 'marble', 'meadow', 'meteor',
  'midnight', 'mirage', 'moon', 'nectar', 'noble', 'north', 'nova', 'oasis',
  'ocean', 'onyx', 'opal', 'orbit', 'otter', 'pebble', 'pepper', 'pine',
  'pixel', 'planet', 'plum', 'polar', 'poppy', 'prairie', 'prism', 'quartz',
  'raven', 'reef', 'ripple', 'river', 'rocket', 'rustic', 'saffron', 'sage',
  'sailor', 'salmon', 'sand', 'sequoia', 'shadow', 'shore', 'signal', 'silver',
  'sky', 'slate', 'solar', 'sparrow', 'spiral', 'spring', 'spruce', 'star',
  'stone', 'storm', 'summer', 'sunset', 'tangerine', 'teal', 'thistle', 'thunder',
  'tiger', 'topaz', 'tundra', 'valley', 'velvet', 'violet', 'willow',
  'winter', 'wolf', 'zenith', 'zephyr'
];

const ROLL_MS = 560;

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickDistinctWords(count) {
  const words = [];
  let guard = 0;
  while (words.length < count && guard < count * 20) {
    guard += 1;
    const word = pick(DICE_WORDS);
    if (!words.includes(word)) words.push(word);
  }
  while (words.length < count) words.push(pick(DICE_WORDS));
  return words;
}

/**
 * Generate a strong, human-friendly room password.
 * @returns {string} e.g. "amber-comet-42-lotus"
 */
export function generateRoomPassword() {
  const words = pickDistinctWords(3);
  const digits = String(Math.floor(Math.random() * 90) + 10);
  return [...words.slice(0, 2), digits, words[2]].join('-');
}

export function isValidRoomPassword(password, { min = 4, max = 128 } = {}) {
  const value = String(password ?? '').trim();
  return value.length >= min && value.length <= max;
}

/**
 * Dice roll: spin the icon, shuffle random values through the input
 * for ~0.5s, then land on the final generated password.
 *
 * Re-entrancy-safe: a second click while rolling is ignored. Dispatches
 * an `input` event at the end so existing listeners (touched-state,
 * validation) react exactly as if the user typed it.
 *
 * @param {HTMLButtonElement} button the dice button (gets .is-rolling)
 * @param {HTMLInputElement} input the password field to fill
 */
export function animateDiceRoll(button, input) {
  if (!button || !input) return;
  if (button.classList.contains('is-rolling')) return;
  button.classList.add('is-rolling');
  const start = performance.now();
  const tick = () => {
    const elapsed = performance.now() - start;
    if (elapsed >= ROLL_MS) {
      button.classList.remove('is-rolling');
      input.value = generateRoomPassword();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // Shuffle random candidates while the dice spins.
    input.value = generateRoomPassword();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
