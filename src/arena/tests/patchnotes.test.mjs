// Patch notes: what a pilot is shown the first time they sign in after an update.
// The list has to stay well formed, and every commit that changes what ships has to add to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATCH_NOTES, latestNoteId, notesSince } from '../shared/patchnotes.js';
import { ProfileStore } from '../server/profiles.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const NOTES = 'src/arena/shared/patchnotes.js';
// What a browser or the server actually runs. Tests and docs can change without a note.
const SHIPS = (file) => file.startsWith('src/arena/') && !file.startsWith('src/arena/tests/') && !file.endsWith('.md');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

test('the notes are in order, numbered once each, and written the way the game talks', () => {
  assert.ok(PATCH_NOTES.length > 0);
  const ids = PATCH_NOTES.map((note) => note.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'newest first');
  assert.equal(new Set(ids).size, ids.length, 'an id was used twice');
  for (const note of PATCH_NOTES) {
    assert.ok(Number.isInteger(note.id) && note.id > 0);
    assert.match(note.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(note.title && note.title.length <= 40, `title too long: ${note.title}`);
    assert.ok(['Update', 'Fix', 'Event'].includes(note.tag), `unknown tag on ${note.id}`);
    assert.ok(note.notes.length >= 1 && note.notes.length <= 10, `note ${note.id} should have one to ten lines`);
    for (const line of note.notes) {
      assert.ok(line.length <= 140, `too long for a note: ${line}`);
      assert.ok(!line.includes(String.fromCharCode(8212)), `em dash in a note: ${line}`);
    }
  }
  for (let i = 1; i < PATCH_NOTES.length; i += 1) assert.ok(PATCH_NOTES[i - 1].date >= PATCH_NOTES[i].date, 'dates go backwards down the list');
});

test('a pilot is shown what is newer than the last note they closed, and nothing twice', () => {
  const latest = latestNoteId();
  assert.equal(notesSince(latest).length, 0);
  assert.equal(notesSince(0).length, PATCH_NOTES.length);
  assert.deepEqual(notesSince(latest - 1).map((note) => note.id), [latest]);
  assert.equal(notesSince(undefined).length, PATCH_NOTES.length, 'never read anything: everything is new');
});

test('the last note read is kept on the account, only goes up, and cannot be set past what has shipped', async () => {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-notes-')), 'profiles.json'));
  await profiles.load();
  const token = ProfileStore.newToken();
  profiles.get(token);
  assert.equal(profiles.view(token).notesSeen, 0);
  profiles.savePrefs(token, { notesSeen: 1 });
  assert.equal(profiles.view(token).notesSeen, 1);
  profiles.savePrefs(token, { notesSeen: 999999 });
  assert.equal(profiles.view(token).notesSeen, latestNoteId(), 'a page cannot mark notes read that do not exist yet');
  profiles.savePrefs(token, { notesSeen: 1 });
  assert.equal(profiles.view(token).notesSeen, latestNoteId(), 'it never goes back down');
  for (const junk of [-3, 1.5, '2', null, NaN]) { profiles.savePrefs(token, { notesSeen: junk }); assert.equal(profiles.view(token).notesSeen, latestNoteId()); }
});

// The rule: a commit that changes anything a player loads or the server runs adds a patch note in the
// same commit. Checked two ways, so it holds before a commit (the working tree) and after one (the
// last commit to touch the game). Skipped where there is no git history to ask, such as the live machine.
test('every change to the game comes with a patch note', (t) => {
  let changed, last;
  try {
    changed = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).map((line) => line.slice(3).replace(/^"|"$/g, ''));
    last = git('log', '-1', '--format=%H', '--', 'src/arena');
  } catch { t.skip('no git here'); return; }
  const touched = changed.filter(SHIPS);
  if (touched.length) {
    assert.ok(touched.includes(NOTES), `These files changed with no new entry in ${NOTES}:\n  ${touched.slice(0, 12).join('\n  ')}\nAdd one at the top of PATCH_NOTES (a new id, today's date, what a player will notice).`);
    return;
  }
  if (!last) { t.skip('no commits touch the game yet'); return; }
  // Nothing uncommitted: the newest commit that touched the game must have touched the notes too.
  let files = [];
  for (const hash of git('log', '-8', '--format=%H', '--', 'src/arena').split('\n').filter(Boolean)) {
    files = git('show', '--name-only', '--format=', hash).split('\n').filter(Boolean);
    if (files.some(SHIPS)) { last = hash; break; }
  }
  if (!files.some(SHIPS)) return;
  // History from before the notes existed is not held to the rule.
  let hadNotes = true;
  try { git('cat-file', '-e', `${last}:${NOTES}`); } catch { hadNotes = false; }
  if (!hadNotes) return;
  assert.ok(files.includes(NOTES), `Commit ${last.slice(0, 8)} changed the game without adding a patch note (${NOTES}).`);
});
