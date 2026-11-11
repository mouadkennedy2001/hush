import { randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Public feedback board — bug reports + feature suggestions.
 *
 * Two separate user actions, one server-side board:
 *  - reports:      "something is broken / this code errors"
 *  - suggestions:  "add this feature", with one unique check/vote per device
 *
 * Lifecycle (configurable, defaults match the product request):
 *  - suggestions collect votes for 30 days
 *  - at review the most-checked suggestion(s) get a ✓ and are approved
 *  - unchecked suggestions get a 2-day grace period, then are deleted
 *  - bug reports stay until the maintainer marks them fixed
 *
 * Everything here is plain JSON on disk (data/feedback.json), validated on
 * the way in and on the way out. User text is never treated as HTML; the
 * browser renders it with textContent.
 */

export const FEEDBACK_VERSION = 1;
export const MAX_TITLE = 140;
export const MAX_DETAILS = 4000;
export const MAX_CODE = 4000;
export const MAX_AUTHOR = 32;
export const MAX_SUGGESTIONS = 200;
export const MAX_REPORTS = 300;
export const DEFAULT_CYCLE_DAYS = 30;
export const DEFAULT_GRACE_DAYS = 2;
export const DEFAULT_MAX_CHECKED = 1;
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const ID_RE = /^fb_[a-z0-9]{6,20}$/i;
const VOTER_RE = /^[a-zA-Z0-9-]{8,64}$/;
const SUGGESTION_STATUS = new Set(['open', 'approved', 'pending-delete']);
const REPORT_STATUS = new Set(['open', 'fixed']);

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Strip control/bidi characters and normalize whitespace. Never returns HTML. */
export function cleanFeedbackText(value, max, { multiline = false } = {}) {
  let text = String(value ?? '').replace(/\r\n?/g, '\n');
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  if (multiline) {
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  } else {
    text = text.replace(/\s+/g, ' ');
  }
  return text.trim().slice(0, max);
}

export function cleanFeedbackTitle(value) {
  return cleanFeedbackText(value, MAX_TITLE);
}

export function cleanFeedbackDetails(value) {
  return cleanFeedbackText(value, MAX_DETAILS, { multiline: true });
}

export function cleanFeedbackCode(value) {
  return cleanFeedbackText(value, MAX_CODE, { multiline: true });
}

export function cleanFeedbackAuthor(value) {
  // Empty is kept empty on purpose: the browser localizes the fallback
  // ("Guest" / "ضيف") so the stored data stays language-neutral.
  return cleanFeedbackText(value, MAX_AUTHOR);
}

export function cleanVoterId(value) {
  const id = String(value ?? '').trim();
  return VOTER_RE.test(id) ? id : '';
}

export function isValidFeedbackId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

export function feedbackId() {
  return `fb_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function safeTime(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function uniqueVoters(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = cleanVoterId(value);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function normalizeSuggestion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '');
  const title = cleanFeedbackTitle(raw.title);
  const details = cleanFeedbackDetails(raw.details);
  if (!ID_RE.test(id) || title.length < 4 || details.length < 10) return null;
  const createdAt = safeTime(raw.createdAt, Date.now());
  const status = SUGGESTION_STATUS.has(raw.status) ? raw.status : 'open';
  return {
    id,
    title,
    details,
    author: cleanFeedbackAuthor(raw.author),
    authorVoterId: cleanVoterId(raw.authorVoterId),
    votes: uniqueVoters(raw.votes),
    checked: raw.checked === true,
    status,
    createdAt,
    updatedAt: safeTime(raw.updatedAt, createdAt),
    approvedAt: safeTime(raw.approvedAt, 0) || null,
    deleteAt: safeTime(raw.deleteAt, 0) || null
  };
}

function normalizeReport(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '');
  const title = cleanFeedbackTitle(raw.title);
  const details = cleanFeedbackDetails(raw.details);
  if (!ID_RE.test(id) || title.length < 4 || details.length < 10) return null;
  const createdAt = safeTime(raw.createdAt, Date.now());
  return {
    id,
    title,
    details,
    code: cleanFeedbackCode(raw.code),
    author: cleanFeedbackAuthor(raw.author),
    authorVoterId: cleanVoterId(raw.authorVoterId),
    status: REPORT_STATUS.has(raw.status) ? raw.status : 'open',
    createdAt,
    updatedAt: safeTime(raw.updatedAt, createdAt),
    fixedAt: safeTime(raw.fixedAt, 0) || null
  };
}

function publicSuggestion(item, voterId = '') {
  return {
    id: item.id,
    title: item.title,
    details: item.details,
    author: item.author,
    voteCount: item.votes.length,
    voted: Boolean(voterId && item.votes.includes(voterId)),
    checked: item.checked === true,
    status: item.status,
    createdAt: item.createdAt,
    approvedAt: item.approvedAt || null,
    deleteAt: item.deleteAt || null
  };
}

function publicReport(item) {
  return {
    id: item.id,
    title: item.title,
    details: item.details,
    code: item.code,
    author: item.author,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    fixedAt: item.fixedAt || null
  };
}

function tokenMatches(provided, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(provided ?? ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export class FeedbackStore {
  #data = {
    version: FEEDBACK_VERSION,
    cycleStartedAt: Date.now(),
    suggestions: [],
    reports: []
  };
  #saveChain = Promise.resolve();

  constructor({
    dataDir,
    now = () => Date.now(),
    log = console,
    cycleDays = DEFAULT_CYCLE_DAYS,
    graceDays = DEFAULT_GRACE_DAYS,
    maxChecked = DEFAULT_MAX_CHECKED,
    adminToken = ''
  } = {}) {
    if (!dataDir) throw new Error('FeedbackStore requires a dataDir');
    this.dataDir = dataDir;
    this.now = now;
    this.log = log;
    this.cycleDays = clampNumber(cycleDays, 1, 365, DEFAULT_CYCLE_DAYS);
    this.graceDays = clampNumber(graceDays, 1, 30, DEFAULT_GRACE_DAYS);
    this.maxChecked = Math.round(clampNumber(maxChecked, 1, 20, DEFAULT_MAX_CHECKED));
    this.adminToken = String(adminToken || '');
    this.cycleMs = this.cycleDays * DAY_MS;
    this.graceMs = this.graceDays * DAY_MS;
  }

  #file() {
    return path.join(this.dataDir, 'feedback.json');
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    let loaded = false;
    try {
      const raw = await fs.readFile(this.#file(), 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Non-critical local state: quarantine the bad file, keep the server up.
        const bad = `${this.#file()}.corrupt-${Date.now()}.json`;
        try { await fs.writeFile(bad, raw, 'utf8'); } catch { /* ignore */ }
        this.log.warn?.('feedback.json was corrupt — quarantined and reset.');
        parsed = null;
      }
      if (parsed && typeof parsed === 'object') {
        loaded = true;
        this.#data.version = FEEDBACK_VERSION;
        this.#data.cycleStartedAt = safeTime(parsed.cycleStartedAt, Date.now());
        const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
        const reports = Array.isArray(parsed.reports) ? parsed.reports : [];
        const seenS = new Set();
        for (const item of suggestions) {
          const normalized = normalizeSuggestion(item);
          if (normalized && !seenS.has(normalized.id)) {
            seenS.add(normalized.id);
            this.#data.suggestions.push(normalized);
          }
        }
        const seenR = new Set();
        for (const item of reports) {
          const normalized = normalizeReport(item);
          if (normalized && !seenR.has(normalized.id)) {
            seenR.add(normalized.id);
            this.#data.reports.push(normalized);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const changed = this.#maintain(this.now());
    if (changed || !loaded) await this.#queueSave();
  }

  async #queueSave() {
    const write = this.#saveChain.then(() => this.#write());
    this.#saveChain = write.catch((error) => {
      this.log.warn?.('Could not persist feedback:', error.message);
    });
    return write;
  }

  async #write() {
    const payload = JSON.stringify(this.#data, null, 2);
    const file = this.#file();
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, payload, 'utf8');
    try {
      const fh = await fs.open(temp, 'r');
      try { await fh.sync(); } finally { await fh.close(); }
    } catch { /* best-effort */ }
    try { await fs.copyFile(file, `${file}.bak`); } catch { /* none yet */ }
    await fs.rename(temp, file);
  }

  /**
   * Recompute which open suggestion currently owns the ✓.
   * Only the top `maxChecked` with at least one vote are checked.
   */
  #refreshChecks() {
    const open = this.#data.suggestions
      .filter((item) => item.status === 'open' && item.votes.length > 0)
      .sort((a, b) => (b.votes.length - a.votes.length) || (a.createdAt - b.createdAt));
    const winners = new Set(open.slice(0, this.maxChecked).map((item) => item.id));
    let changed = false;
    for (const item of this.#data.suggestions) {
      if (item.status !== 'open') continue;
      const checked = winners.has(item.id);
      if (item.checked !== checked) {
        item.checked = checked;
        item.updatedAt = this.now();
        changed = true;
      }
    }
    return changed;
  }

  /** Apply the 30-day review + 2-day cleanup. Returns true when data changed. */
  #maintain(at = this.now()) {
    let changed = this.#refreshChecks();
    for (const item of this.#data.suggestions) {
      if (item.status !== 'open') continue;
      if (at - item.createdAt < this.cycleMs) continue;
      if (item.checked) {
        item.status = 'approved';
        item.approvedAt = at;
        item.deleteAt = null;
        item.updatedAt = at;
      } else {
        item.status = 'pending-delete';
        item.deleteAt = at + this.graceMs;
        item.updatedAt = at;
      }
      changed = true;
    }
    const before = this.#data.suggestions.length;
    this.#data.suggestions = this.#data.suggestions.filter(
      (item) => !(item.status === 'pending-delete' && item.deleteAt && item.deleteAt <= at)
    );
    if (this.#data.suggestions.length !== before) changed = true;
    return changed;
  }

  async maintain(at = this.now()) {
    const changed = this.#maintain(at);
    if (changed) await this.#queueSave();
    return changed;
  }

  list({ voterId = '' } = {}) {
    const voter = cleanVoterId(voterId);
    this.#refreshChecks();
    const suggestions = [...this.#data.suggestions]
      .sort((a, b) => {
        if ((a.status === 'approved') !== (b.status === 'approved')) return a.status === 'approved' ? -1 : 1;
        if (a.checked !== b.checked) return a.checked ? -1 : 1;
        if (b.votes.length !== a.votes.length) return b.votes.length - a.votes.length;
        return b.createdAt - a.createdAt;
      })
      .slice(0, MAX_SUGGESTIONS)
      .map((item) => publicSuggestion(item, voter));
    const reports = [...this.#data.reports]
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
        return b.createdAt - a.createdAt;
      })
      .slice(0, MAX_REPORTS)
      .map(publicReport);
    const open = this.#data.suggestions.filter((item) => item.status === 'open');
    const nextReviewAt = open.length
      ? Math.min(...open.map((item) => item.createdAt + this.cycleMs))
      : null;
    return {
      cycle: {
        days: this.cycleDays,
        graceDays: this.graceDays,
        maxChecked: this.maxChecked,
        startedAt: this.#data.cycleStartedAt,
        nextReviewAt
      },
      suggestions,
      reports
    };
  }

  #isDuplicate(list, authorVoterId, title, at) {
    if (!authorVoterId) return false;
    const needle = title.toLowerCase();
    return list.some((item) => item.authorVoterId === authorVoterId
      && item.title.toLowerCase() === needle
      && at - item.createdAt < DUPLICATE_WINDOW_MS);
  }

  #makeRoomForSuggestion() {
    if (this.#data.suggestions.length < MAX_SUGGESTIONS) return true;
    // Drop the least valuable item: an expired pending-delete first, then the
    // oldest open suggestion with no votes. Never drop an approved feature.
    const pending = this.#data.suggestions.find((item) => item.status === 'pending-delete');
    if (pending) {
      this.#data.suggestions = this.#data.suggestions.filter((item) => item !== pending);
      return true;
    }
    const unvoted = [...this.#data.suggestions]
      .filter((item) => item.status === 'open' && item.votes.length === 0)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (unvoted) {
      this.#data.suggestions = this.#data.suggestions.filter((item) => item !== unvoted);
      return true;
    }
    return false;
  }

  async createSuggestion(body = {}) {
    const at = this.now();
    const title = cleanFeedbackTitle(body.title);
    const details = cleanFeedbackDetails(body.details);
    const voterId = cleanVoterId(body.voterId);
    if (title.length < 4) return { error: 'title-too-short', status: 400 };
    if (details.length < 10) return { error: 'details-too-short', status: 400 };
    if (!voterId) return { error: 'voter-required', status: 400 };
    if (this.#isDuplicate(this.#data.suggestions, voterId, title, at)) {
      return { error: 'duplicate', status: 409 };
    }
    if (!this.#makeRoomForSuggestion()) return { error: 'full', status: 429 };
    const item = {
      id: feedbackId(),
      title,
      details,
      author: cleanFeedbackAuthor(body.author),
      authorVoterId: voterId,
      votes: [voterId],
      checked: false,
      status: 'open',
      createdAt: at,
      updatedAt: at,
      approvedAt: null,
      deleteAt: null
    };
    this.#data.suggestions.push(item);
    this.#refreshChecks();
    await this.#queueSave();
    return { suggestion: publicSuggestion(item, voterId) };
  }

  async createReport(body = {}) {
    const at = this.now();
    const title = cleanFeedbackTitle(body.title);
    const details = cleanFeedbackDetails(body.details);
    const code = cleanFeedbackCode(body.code);
    const voterId = cleanVoterId(body.voterId);
    if (title.length < 4) return { error: 'title-too-short', status: 400 };
    if (details.length < 10) return { error: 'details-too-short', status: 400 };
    if (this.#isDuplicate(this.#data.reports, voterId, title, at)) {
      return { error: 'duplicate', status: 409 };
    }
    if (this.#data.reports.length >= MAX_REPORTS) {
      const fixed = [...this.#data.reports]
        .filter((item) => item.status === 'fixed')
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (fixed) this.#data.reports = this.#data.reports.filter((item) => item !== fixed);
      else return { error: 'full', status: 429 };
    }
    const item = {
      id: feedbackId(),
      title,
      details,
      code,
      author: cleanFeedbackAuthor(body.author),
      authorVoterId: voterId,
      status: 'open',
      createdAt: at,
      updatedAt: at,
      fixedAt: null
    };
    this.#data.reports.push(item);
    await this.#queueSave();
    return { report: publicReport(item) };
  }

  async vote(body = {}) {
    const at = this.now();
    const id = String(body.id ?? '');
    const voterId = cleanVoterId(body.voterId);
    if (!isValidFeedbackId(id)) return { error: 'not-found', status: 404 };
    if (!voterId) return { error: 'voter-required', status: 400 };
    const item = this.#data.suggestions.find((entry) => entry.id === id);
    if (!item) return { error: 'not-found', status: 404 };
    if (item.status !== 'open') return { error: 'vote-closed', status: 409 };
    const index = item.votes.indexOf(voterId);
    let voted;
    if (index >= 0) {
      item.votes.splice(index, 1);
      voted = false;
    } else {
      item.votes.push(voterId);
      voted = true;
    }
    item.updatedAt = at;
    this.#refreshChecks();
    await this.#queueSave();
    return { suggestion: publicSuggestion(item, voterId), voted };
  }

  async admin(body = {}) {
    if (!this.adminToken) return { error: 'admin-disabled', status: 403 };
    if (!tokenMatches(body.token, this.adminToken)) return { error: 'forbidden', status: 403 };
    const at = this.now();
    const action = String(body.action ?? '');
    const id = String(body.id ?? '');
    if (action === 'run-maintenance') {
      const changed = this.#maintain(at);
      if (changed) await this.#queueSave();
      return { ok: true, changed };
    }
    if (!isValidFeedbackId(id)) return { error: 'not-found', status: 404 };
    if (action === 'fix-report' || action === 'reopen-report') {
      const item = this.#data.reports.find((entry) => entry.id === id);
      if (!item) return { error: 'not-found', status: 404 };
      item.status = action === 'fix-report' ? 'fixed' : 'open';
      item.fixedAt = action === 'fix-report' ? at : null;
      item.updatedAt = at;
      await this.#queueSave();
      return { ok: true, report: publicReport(item) };
    }
    if (action === 'approve-suggestion' || action === 'reopen-suggestion') {
      const item = this.#data.suggestions.find((entry) => entry.id === id);
      if (!item) return { error: 'not-found', status: 404 };
      if (action === 'approve-suggestion') {
        item.status = 'approved';
        item.checked = true;
        item.approvedAt = at;
        item.deleteAt = null;
      } else {
        item.status = 'open';
        item.checked = false;
        item.approvedAt = null;
        item.deleteAt = null;
        this.#refreshChecks();
      }
      item.updatedAt = at;
      await this.#queueSave();
      return { ok: true, suggestion: publicSuggestion(item) };
    }
    if (action === 'delete-suggestion') {
      const before = this.#data.suggestions.length;
      this.#data.suggestions = this.#data.suggestions.filter((entry) => entry.id !== id);
      if (this.#data.suggestions.length === before) return { error: 'not-found', status: 404 };
      await this.#queueSave();
      return { ok: true };
    }
    return { error: 'unknown-action', status: 400 };
  }

  getStats() {
    return {
      version: FEEDBACK_VERSION,
      suggestions: this.#data.suggestions.length,
      reports: this.#data.reports.length,
      openReports: this.#data.reports.filter((item) => item.status === 'open').length,
      approved: this.#data.suggestions.filter((item) => item.status === 'approved').length,
      cycleDays: this.cycleDays,
      graceDays: this.graceDays,
      maxChecked: this.maxChecked
    };
  }
}

export default {
  FeedbackStore,
  FEEDBACK_VERSION,
  DEFAULT_CYCLE_DAYS,
  DEFAULT_GRACE_DAYS,
  DEFAULT_MAX_CHECKED,
  cleanFeedbackText,
  cleanFeedbackTitle,
  cleanFeedbackDetails,
  cleanFeedbackCode,
  cleanFeedbackAuthor,
  cleanVoterId,
  isValidFeedbackId,
  feedbackId
};
