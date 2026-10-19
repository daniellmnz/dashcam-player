// Deleting the recording that is currently on screen.
//
// The bug this exists for: the row survived the delete, still ticked, while
// the file really had gone from the card. Clicking again then said "0 files
// deleted, 1 could not be removed".
//
// The mechanism is Windows, not the page. Chromium opens the file with
// share-delete, so removeEntry SUCCEEDS - but Windows keeps the directory
// entry alive until the last handle on the file closes, and the video element
// still holds one through its blob URL. So the rescan that runs immediately
// afterwards still sees the file and puts the row straight back, ticked. The
// entry disappears later, when the handle is dropped, and the next attempt
// meets a file that is no longer there: NotFoundError.
//
// Hence three separate things to hold:
//   1. the video is released BEFORE removeEntry, so the handle is gone and
//      the delete takes effect at once rather than pending;
//   2. NotFoundError counts as deleted, because the file not being there is
//      the outcome that was asked for - otherwise every retry after a
//      half-success reports failure for ever;
//   3. the row leaves the list from the page's own records, so a rescan that
//      is stale or fails cannot resurrect a file that has been deleted.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
const fs = require('fs');
const { JSDOM } = require(process.env.NM + '/jsdom');
const html = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub';
    w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined;
    w.confirm = () => true;
  } });
const w = dom.window;
w.onerror = () => {};

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };
const ok = m => console.log('  ok   ' + m);

// A DOMException the way the File System Access API raises it when the entry
// has already gone. The message is Windows' own wording, copied from the
// console of the machine this was found on.
const NOT_FOUND = `(function(){
  const e = new Error('A requested file or directory could not be found at '
    + 'the time an operation was processed.');
  e.name = 'NotFoundError';
  return e;
})()`;

// One segment, on screen, ticked for deletion. removeEntry records the state
// of the video element at the moment it is called - that ordering is the
// whole point, and it cannot be checked after the fact.
const SETUP = `
  const NAME = '20261019_114527_surround.mp4';
  const file = { name: NAME, relPath: 'DCIM/EVCam_Video/' + NAME, size: 708 };
  segments.length = 0;
  segments.push({ name: NAME, file, relPath: file.relPath, session: 's',
                  start: 1, status: 'ok', sidecar: null });
  picked.clear();
  picked.add(segKey(segments[0]));

  // On screen, as it was when this went wrong.
  current = 0;
  objUrl = 'blob:stub';
  video.src = 'blob:stub';

  window.__seen = [];
  dirHandle = { queryPermission: async () => 'granted',
                requestPermission: async () => 'granted' };
  dirHandles = {};
  dirHandles['DCIM/EVCam_Video/'] = {
    removeEntry: async (n) => {
      window.__seen.push({ name: n, videoSrc: video.getAttribute('src') || '',
                           objUrl: objUrl || '' });
      __REMOVE_BEHAVIOUR__
    },
    values: async function*(){}
  };
`;

const run = (behaviour) => w.eval(`(async function(){
  ${SETUP.replace('__REMOVE_BEHAVIOUR__', behaviour)}
  await deleteSelected();
  return { seen: window.__seen,
           hint: document.getElementById('pickHint').textContent,
           left: segments.map(s => s.name) };
})()`);

(async () => {
  // 1. The handle must be released before the delete, not after.
  let r = await run('return;');
  const first = r.seen[0];
  if (!first) {
    fail('removeEntry was never called for the recording');
  } else if (first.videoSrc || first.objUrl) {
    fail('the video still held the file when removeEntry ran '
       + `(src="${first.videoSrc}", objUrl="${first.objUrl}") - on Windows the `
       + 'directory entry then lingers and the rescan puts the row back');
  } else {
    ok('the video is released before the file is deleted');
  }

  // 2. A file that has already gone is the outcome that was wanted.
  r = await run(`throw ${NOT_FOUND};`);
  if (/could not be removed/.test(r.hint))
    fail('a file that was already gone is reported as a failure - '
       + `every retry then fails for ever ("${r.hint}")`);
  else if (!/1 file deleted/.test(r.hint))
    fail(`a file that was already gone is not counted as deleted ("${r.hint}")`);
  else ok('a file that had already gone counts as deleted');

  // 3. The list must not depend on the rescan, which here fails outright -
  //    exactly as it does when the folder cannot be re-read.
  r = await run('return;');
  if (r.left.length)
    fail('the deleted recording is still listed after a rescan that returned '
       + 'nothing - the row survives and stays ticked');
  else ok('the deleted recording leaves the list even when the rescan does not help');

  console.log(bad ? `\n${bad} FAIL` : '\ndeleting the recording on screen leaves no ghost');
  process.exit(bad ? 1 : 0);
})();
