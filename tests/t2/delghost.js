// Deleting a recording must take its data file with it.
//
// The bug this exists for: delete the recording you are watching, the message
// says it is deleted, and the row stays in the list. Open it again and the
// player says there is no video - which is true, because the .mp4 really did
// go. What stayed was the .json beside it, and an orphaned sidecar is listed
// as a "missing" segment by design: a card where the data file was copied and
// the recording was not is a real thing worth showing.
//
// So the row was right, the deletion was right, and the two together were
// nonsense. The sidecar's removal was one silent try/catch - it could fail,
// or never be attempted because the pairing was never made, and either way
// the message said the file had been deleted and said nothing else.
//
// Three things are checked here: the ordinary delete takes both files; a
// recording whose sidecar never paired still has it removed, by name; and a
// sidecar that genuinely cannot be removed is REPORTED, so the row it leaves
// behind explains itself instead of looking like a delete that did not work.
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', '..', 'src');
const fs = require('fs');
const { JSDOM } = require(process.env.NM + '/jsdom');
const html = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

// A card we can really delete from. `lock` makes one name refuse, the way a
// file held open by something else does.
function makeCard(files, lock) {
  const tree = { ...files };
  function dirFor(prefix) {
    return {
      name: prefix.replace(/\/$/, '').split('/').pop() || 'card',
      kind: 'directory',
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      async removeEntry(n) {
        const key = prefix + n;
        if (!(key in tree)) { const e = new Error('A requested file could not be found'); e.name = 'NotFoundError'; throw e; }
        if (lock && lock.test(n)) throw new Error('NoModificationAllowedError: the file is in use');
        delete tree[key];
      },
      async getDirectoryHandle(n) { return dirFor(prefix + n + '/'); },
      values() {
        const here = new Set(), subs = new Set();
        for (const k of Object.keys(tree)) {
          if (k.startsWith('__') || !k.startsWith(prefix)) continue;
          const rest = k.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash < 0) here.add(rest); else subs.add(rest.slice(0, slash));
        }
        const out = [];
        for (const n of subs) out.push(dirFor(prefix + n + '/'));
        for (const n of here) out.push({ name: n, kind: 'file',
          async getFile() {
            return { name: n, size: tree[prefix + n],
                     text: async () => tree['__text__' + prefix + n] || '',
                     slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
          } });
        return { [Symbol.asyncIterator]() { let i = 0;
          return { next: async () => i < out.length ? { value: out[i++], done: false } : { done: true } }; } };
      } };
  }
  return { tree, root: dirFor('') };
}

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined; w.confirm = () => true;
  } });
const w = dom.window; w.onerror = () => {};

const SIDE = JSON.stringify({ recordingSessionId: 'abc', segmentNumber: 1,
  startedAtEpochMs: Date.UTC(2026, 9, 10, 1, 0, 0),
  actualTrack: { width: 2560, height: 2660, durationMs: 60000 } });

// Open a card, delete the recording named by `pick`, report what is left.
async function runDelete({ lock, clearName }) {
  const card = makeCard({
    'Movies/20261010_010000_surround.mp4': 1000,
    'Movies/20261010_010000_surround.json': 400,
    'Movies/20261010_020000_surround.mp4': 1000,
    'Movies/20261010_020000_surround.json': 400,
  }, lock);
  card.tree['__text__Movies/20261010_010000_surround.json'] = SIDE;
  card.tree['__text__Movies/20261010_020000_surround.json'] = SIDE;
  w.__card = card;
  return JSON.parse(await w.eval(`(async function(){
    dirHandle = window.__card.root;
    await openHandle(dirHandle);
    current = segments.findIndex(s=>/010000/.test(s.name));
    ${clearName ? '// as if the sidecar never paired with the recording\n    segments[current].scName = null;' : ''}
    picked.clear(); picked.add(segKey(segments[current]));
    await deleteSelected();
    return JSON.stringify({
      hint: document.getElementById('pickHint').textContent,
      names: segments.map(s=>s.name),
      ghosts: segments.filter(s=>s.missing).map(s=>s.name),
      left: Object.keys(window.__card.tree).filter(k=>!k.startsWith('__'))
    });
  })()`));
}

setTimeout(async () => {
  // --- the ordinary case ------------------------------------------------
  const plain = await runDelete({});
  if (plain.left.some(f => /010000/.test(f)))
    fail('the ordinary delete left something behind: ' + plain.left.join(', '));
  if (plain.names.some(n => /010000/.test(n)))
    fail('the deleted recording is still in the list: ' + plain.names.join(', '));
  if (plain.ghosts.length) fail('a ghost row was left: ' + plain.ghosts.join(', '));
  if (!/1 file deleted\./.test(plain.hint)) fail('the ordinary delete does not report cleanly: ' + plain.hint);

  // --- the sidecar never paired ------------------------------------------
  // The name it would have is derivable from the recording's, so not having
  // recorded it is no reason to leave the file on the card.
  const unpaired = await runDelete({ clearName: true });
  if (unpaired.left.some(f => /010000.*\.json$/.test(f)))
    fail('a sidecar that never paired is left on the card: ' + unpaired.left.join(', '));
  if (unpaired.ghosts.length)
    fail('an unpaired sidecar still leaves a ghost row: ' + unpaired.ghosts.join(', '));

  // --- the sidecar cannot be removed -------------------------------------
  // It happens; what must not happen is being told the file was deleted and
  // left to work out for yourself why its row is still there.
  const stuck = await runDelete({ lock: /\.json$/i });
  if (!stuck.ghosts.length)
    fail('the test did not reproduce the ghost row, so it proves nothing');
  else {
    if (/^1 file deleted\.$/.test(stuck.hint))
      fail('the sidecar was left behind and the message still claims a clean delete: ' + stuck.hint);
    if (!/left behind|still listed/i.test(stuck.hint))
      fail('nothing explains the row that is still in the list: ' + stuck.hint);
  }

  // --- and a recording with no sidecar at all -----------------------------
  // One of the two recorders writes none. Deleting one of those must not
  // report a phantom failure for a file that was never there.
  const bare = makeCard({ 'Movies/20261010_050000_surround.mp4': 1000 });
  w.__card = bare;
  const none = JSON.parse(await w.eval(`(async function(){
    dirHandle = window.__card.root;
    await openHandle(dirHandle);
    picked.clear(); picked.add(segKey(segments[0]));
    await deleteSelected();
    return JSON.stringify({ hint: document.getElementById('pickHint').textContent,
                            left: Object.keys(window.__card.tree).filter(k=>!k.startsWith('__')) });
  })()`));
  if (none.left.length) fail('a recording with no sidecar was not removed: ' + none.left.join(', '));
  if (/left behind|could not be removed/i.test(none.hint))
    fail('deleting a recording with no sidecar reports a failure for a file that never existed: ' + none.hint);

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('a deleted recording takes its data file with it, and anything left behind is said out loud');
  dom.window.close(); process.exit(0);
}, 600);
