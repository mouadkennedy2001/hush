import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHushServer } from '../src/app.js';
import {
  FeedbackStore,
  cleanFeedbackText,
  cleanFeedbackTitle,
  cleanFeedbackDetails,
  cleanVoterId,
  isValidFeedbackId
} from '../src/feedback.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DAY = 24 * 60 * 60 * 1000;
const VOTER_A = 'device-aaaa-1111';
const VOTER_B = 'device-bbbb-2222';
const VOTER_C = 'device-cccc-3333';

async function tempDir(label) {
  return mkdtemp(path.join(os.tmpdir(), `hush-${label}-`));
}

async function makeStore({ now = () => Date.now(), adminToken = '', cycleDays = 30, graceDays = 2 } = {}) {
  const dir = await tempDir('fb');
  const store = new FeedbackStore({
    dataDir: path.join(dir, 'data'),
    now,
    adminToken,
    cycleDays,
    graceDays,
    log: { warn() {}, error() {} }
  });
  await store.init();
  return { store, dir };
}

function suggestionBody(title, voterId, extra = {}) {
  return {
    title,
    details: 'A detailed explanation that is longer than ten characters.',
    author: 'Tester',
    voterId,
    ...extra
  };
}

test('feedback sanitizers strip control/bidi characters and cap length', () => {
  assert.equal(cleanFeedbackTitle('  hello\u202Eworld\u200B  '), 'helloworld');
  assert.equal(cleanFeedbackTitle('a'.repeat(400)).length, 140);
  assert.equal(cleanFeedbackText('line 1\r\nline 2', 100, { multiline: true }), 'line 1\nline 2');
  assert.equal(cleanFeedbackText('one\n\n\n\ntwo', 100, { multiline: true }), 'one\n\ntwo');
  assert.equal(cleanFeedbackDetails('x'.repeat(9000)).length, 4000);
  assert.equal(cleanVoterId('short'), '');
  assert.equal(cleanVoterId('bad id with spaces'), '');
  assert.equal(cleanVoterId(VOTER_A), VOTER_A);
  assert.equal(isValidFeedbackId('fb_0123456789ab'), true);
  assert.equal(isValidFeedbackId('fb_../../etc'), false);
});

test('feedback voting is unique per device and the top suggestion gets the check', async () => {
  let clock = 1_700_000_000_000;
  const { store, dir } = await makeStore({ now: () => clock });
  try {
    const first = await store.createSuggestion(suggestionBody('First idea', VOTER_A));
    assert.ok(first.suggestion.id);
    assert.equal(first.suggestion.voteCount, 1);
    assert.equal(first.suggestion.checked, true, 'the only voted suggestion is checked');

    clock += 1000;
    const second = await store.createSuggestion(suggestionBody('Second idea', VOTER_B));
    assert.equal(second.suggestion.checked, false, 'tie breaks by oldest, so the newer one is not checked');

    const vote = await store.vote({ id: second.suggestion.id, voterId: VOTER_C });
    assert.equal(vote.voted, true);
    assert.equal(vote.suggestion.voteCount, 2);
    assert.equal(vote.suggestion.checked, true, 'most-voted suggestion now carries the check');

    const unvote = await store.vote({ id: second.suggestion.id, voterId: VOTER_C });
    assert.equal(unvote.voted, false);
    assert.equal(unvote.suggestion.voteCount, 1);

    // Same device cannot be counted twice even if it votes repeatedly.
    await store.vote({ id: first.suggestion.id, voterId: VOTER_C });
    const toggled = await store.vote({ id: first.suggestion.id, voterId: VOTER_C });
    assert.equal(toggled.voted, false);
    assert.equal(toggled.suggestion.voteCount, 1);

    const listed = store.list({ voterId: VOTER_A });
    const item = listed.suggestions.find((entry) => entry.id === first.suggestion.id);
    assert.equal(item.voted, true);
    assert.equal('votes' in item, false, 'raw voter ids never leave the server');
    assert.equal('authorVoterId' in item, false, 'author device ids never leave the server');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('feedback lifecycle approves the checked suggestion and deletes the rest after grace', async () => {
  let clock = 1_700_000_000_000;
  const { store, dir } = await makeStore({ now: () => clock });
  try {
    const keeper = await store.createSuggestion(suggestionBody('Keep this feature', VOTER_A));
    clock += 1000;
    const loser = await store.createSuggestion(suggestionBody('Drop this feature', VOTER_B));
    // Give the keeper more votes so it owns the ✓ at review time.
    await store.vote({ id: keeper.suggestion.id, voterId: VOTER_B });
    await store.vote({ id: keeper.suggestion.id, voterId: VOTER_C });

    clock += 30 * DAY;
    assert.equal(await store.maintain(), true);
    let board = store.list();
    const kept = board.suggestions.find((entry) => entry.id === keeper.suggestion.id);
    const dropped = board.suggestions.find((entry) => entry.id === loser.suggestion.id);
    assert.equal(kept.status, 'approved');
    assert.equal(kept.checked, true);
    assert.equal(dropped.status, 'pending-delete');
    assert.ok(dropped.deleteAt > clock, 'grace period starts at review');

    // Still inside the 2-day grace period: nothing deleted yet.
    clock += DAY;
    await store.maintain();
    board = store.list();
    assert.ok(board.suggestions.some((entry) => entry.id === loser.suggestion.id));

    // After the grace period the unchecked suggestion is gone.
    clock += DAY;
    await store.maintain();
    board = store.list();
    assert.equal(board.suggestions.some((entry) => entry.id === loser.suggestion.id), false);
    assert.equal(board.suggestions.some((entry) => entry.id === keeper.suggestion.id), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('feedback admin can fix reports, approve suggestions and is token-protected', async () => {
  let clock = 1_700_000_000_000;
  const { store, dir } = await makeStore({ now: () => clock, adminToken: 'top-secret' });
  try {
    const report = await store.createReport({
      title: 'Mic crashes on join',
      details: 'Opening the mic settings closes the tab every time.',
      voterId: VOTER_A
    });
    assert.equal(report.report.status, 'open');

    const denied = await store.admin({ action: 'fix-report', id: report.report.id, token: 'wrong' });
    assert.equal(denied.error, 'forbidden');

    const fixed = await store.admin({ action: 'fix-report', id: report.report.id, token: 'top-secret' });
    assert.equal(fixed.report.status, 'fixed');
    assert.ok(fixed.report.fixedAt);

    const reopened = await store.admin({ action: 'reopen-report', id: report.report.id, token: 'top-secret' });
    assert.equal(reopened.report.status, 'open');

    const idea = await store.createSuggestion(suggestionBody('Dark mode for the board', VOTER_B));
    const approved = await store.admin({ action: 'approve-suggestion', id: idea.suggestion.id, token: 'top-secret' });
    assert.equal(approved.suggestion.status, 'approved');
    assert.equal(approved.suggestion.checked, true);

    const removed = await store.admin({ action: 'delete-suggestion', id: idea.suggestion.id, token: 'top-secret' });
    assert.equal(removed.ok, true);
    assert.equal(store.list().suggestions.length, 0);

    const disabled = new FeedbackStore({
      dataDir: path.join(dir, 'disabled'),
      adminToken: '',
      log: { warn() {}, error() {} }
    });
    await disabled.init();
    const off = await disabled.admin({ action: 'run-maintenance' });
    assert.equal(off.error, 'admin-disabled');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('feedback HTTP API posts, votes and reports with server-backed state', async () => {
  const dir = await tempDir('fb-http');
  const store = new FeedbackStore({
    dataDir: path.join(dir, 'data'),
    adminToken: 'http-secret',
    log: { warn() {}, error() {} }
  });
  const hush = await createHushServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: path.join(dir, 'data'),
    uploadsDir: path.join(dir, 'uploads'),
    feedbackStore: store
  });
  let url = '';
  try {
    const address = await hush.start();
    url = `http://127.0.0.1:${address.port}`;

    const empty = await fetch(`${url}/api/feedback?voterId=${VOTER_A}`);
    assert.equal(empty.status, 200);
    const board = await empty.json();
    assert.equal(board.ok, true);
    assert.deepEqual(board.suggestions, []);
    assert.deepEqual(board.reports, []);
    assert.equal(board.cycle.days, 30);
    assert.equal(board.cycle.graceDays, 2);

    const createRes = await fetch(`${url}/api/feedback/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(suggestionBody('A brand new feature', VOTER_A))
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    const id = created.suggestion.id;
    assert.equal(created.suggestion.checked, true);

    const duplicate = await fetch(`${url}/api/feedback/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(suggestionBody('A brand new feature', VOTER_A))
    });
    assert.equal(duplicate.status, 409);

    const voteRes = await fetch(`${url}/api/feedback/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, voterId: VOTER_B })
    });
    assert.equal(voteRes.status, 200);
    const voted = await voteRes.json();
    assert.equal(voted.voted, true);
    assert.equal(voted.suggestion.voteCount, 2);

    const badVote = await fetch(`${url}/api/feedback/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'fb_missing0000', voterId: VOTER_B })
    });
    assert.equal(badVote.status, 404);

    const reportRes = await fetch(`${url}/api/feedback/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Screen share is black',
        details: 'Sharing a window shows a black rectangle for everyone else.',
        code: 'TypeError: cannot read properties of undefined',
        voterId: VOTER_C
      })
    });
    assert.equal(reportRes.status, 201);
    const report = await reportRes.json();
    assert.match(report.report.code, /TypeError/);

    const noToken = await fetch(`${url}/api/feedback/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fix-report', id: report.report.id })
    });
    assert.equal(noToken.status, 403);

    const fixed = await fetch(`${url}/api/feedback/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Feedback-Token': 'http-secret' },
      body: JSON.stringify({ action: 'fix-report', id: report.report.id })
    });
    assert.equal(fixed.status, 200);
    assert.equal((await fixed.json()).report.status, 'fixed');

    const final = await (await fetch(`${url}/api/feedback?voterId=${VOTER_B}`)).json();
    assert.equal(final.suggestions.length, 1);
    assert.equal(final.suggestions[0].voted, true);
    assert.equal(final.reports[0].status, 'fixed');
  } finally {
    await hush.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('feedback UI has two separate buttons, safe rendering and bilingual strings', async () => {
  for (const page of ['index.html', 'room.html', 'server.html']) {
    const html = await readFile(path.join(PUBLIC, page), 'utf8');
    assert.match(html, /data-open-bug-report/, `${page} has the bug button`);
    assert.match(html, /data-open-feature-suggest/, `${page} has the feature button`);
    assert.match(html, /\/css\/feedback\.css/, `${page} loads feedback styles`);
  }

  for (const module of ['landing.js', 'room.js', 'server.js']) {
    const source = await readFile(path.join(PUBLIC, 'js', module), 'utf8');
    assert.match(source, /initFeedback\(\)/, `${module} initializes the feedback board`);
  }

  const source = await readFile(path.join(PUBLIC, 'js', 'feedback.js'), 'utf8');
  assert.match(source, /textContent/, 'user text is rendered with textContent');
  assert.doesNotMatch(source, /innerHTML\s*=\s*`?[^;]*(item\.|data\.)/, 'no user text goes through innerHTML');
  assert.match(source, /\/api\/feedback\/vote/, 'the UI calls the vote endpoint');
  assert.match(source, /\/api\/feedback\/suggestions/, 'the UI calls the suggestion endpoint');
  assert.match(source, /\/api\/feedback\/reports/, 'the UI calls the report endpoint');

  const ui = await readFile(path.join(PUBLIC, 'js', 'i18n', 'ui.js'), 'utf8');
  assert.match(ui, /'feedback\.openBug'/, 'English/Arabic dictionary has the bug label');
  assert.match(ui, /'feedback\.cycleNote'/, 'the 30-day lifecycle is explained in the UI');

  const changelog = JSON.parse(await readFile(path.join(PUBLIC, 'changelog.json'), 'utf8'));
  assert.equal(changelog.version, '15.0.0');
  const top = changelog.entries[0];
  assert.equal(top.kind, 'feature');
  assert.match(top.titleEn, /v15/);
  assert.match(top.titleEn, /feedback/i);
  assert.ok(top.pointsEn.length >= 3 && top.pointsAr.length >= 3, 'bilingual feature points');

  const readme = await readFile(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /HUSH_FEEDBACK_ADMIN_TOKEN/, 'admin token documented');
  assert.match(readme, /HUSH_FEEDBACK_CYCLE_DAYS/, 'cycle length documented');
});
