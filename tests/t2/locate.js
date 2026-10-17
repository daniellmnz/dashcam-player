// What happens when the helper cannot find the folder.
//
// The page can never tell the export tool where a folder is - the File
// System Access API does not expose a path - so the tool goes looking, and
// on at least one real machine it came up empty: a folder of recordings
// sitting straight in the home directory, which the search could not reach
// from anywhere. The export then stopped halfway and opened a file dialog
// nobody was expecting.
//
// The fix has two halves. The search covers more ground (tests/findfile.ps1
// holds that half). This half is the fallback: when the search says
// "missing", say so while the person is looking at the list, and offer to
// settle it in one dialog of their choosing - rather than letting it
// ambush the first export. The guarantee tested here is that the offer
// appears at all, that pressing it asks the helper, and that it goes away
// once the folder is known.
const fs = require('fs');
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

const PAGE = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = PAGE.match(/DCP_VERSION="([0-9.]+)"/)[1];

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

// What the helper is currently saying, and every path the page asked for.
let state = 'looking';
const asked = [];

const dom = new JSDOM(PAGE.replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', VER), {
  runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = (path, opts) => {
      asked.push({ path: String(path), headers: (opts || {}).headers || {} });
      if (/^\/locate-status/.test(path)) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve(
            state === 'missing'
              ? { state: 'missing', dir: '', lookedIn: ['C:\\'], asked: 'root=Dashcam dir=' }
              : state === 'found'
                ? { state: 'found', dir: 'C:\\Users\\micha\\Dashcam' }
                : { state: 'looking' }),
        });
      }
      if (/^\/pick-folder/.test(path)) {
        // The helper opens its dialog and, when answered, rewrites the
        // status file. Stand in for the person picking the folder.
        state = 'found';
        return Promise.resolve({ ok: true, headers: { get: () => 'text/plain' },
                                 text: () => Promise.resolve('ok') });
      }
      return Promise.reject(new Error('x'));
    };
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined;
  } });
const w = dom.window; w.onerror = () => {};

const btn = () => w.document.getElementById('tellWhere');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await sleep(300);

  if (typeof w.watchLocate !== 'function') {
    fail('the page does not watch for the helper\'s answer at all');
    console.log(`FAIL: ${bad} problem(s)`); w.close(); process.exit(1);
  }

  // While the helper is still searching, nothing is said. A button that
  // appears and then withdraws itself is worse than one that waits.
  w.eval('watchLocate()');
  await sleep(2200);
  if (btn()) fail('the offer appears while the helper is still searching');

  // It comes up empty.
  state = 'missing';
  await sleep(2200);
  const b = btn();
  if (!b) {
    fail('the helper found nothing and the page said nothing');
  } else {
    if (!/tell|where/i.test(b.textContent))
      fail('the offer does not say what it is for: ' + b.textContent);
    if (!(b.title || '').trim())
      fail('the offer does not explain itself');
    // It must sit with the folder controls, not somewhere else on the page.
    const hint = w.document.getElementById('pickHint');
    if (!hint || b.previousElementSibling !== hint)
      fail('the offer is not beside the folder hint');
    // And the hint must still say which folder is open - the offer adds to
    // that, it does not wipe it.
    if (!(hint.textContent || '').trim())
      fail('putting the offer up emptied the folder hint');

    // Pressing it asks the helper, with the token: /pick-folder starts a
    // process, so an untokened request must never be what the page sends.
    const before = asked.length;
    b.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(200);
    const pick = asked.slice(before).find(a => /^\/pick-folder/.test(a.path));
    if (!pick) fail('pressing the offer does not ask the helper to open a dialog');
    else if (!pick.headers['X-Dashcam-Token'])
      fail('the page asks the helper to open a dialog without the token');

    // Once the folder is known the offer has no reason to exist.
    await sleep(2500);
    if (btn()) fail('the offer stays up after the folder has been found');
  }

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); w.close(); process.exit(1); }
  console.log('a folder the helper cannot find is settled before an export meets it');
  w.close(); process.exit(0);
})();
