// The mark the page leaves in the folder you choose.
//
// The page can never learn where a folder is - the File System Access API
// does not expose a path - so the export tool has to go looking, and the
// first export on a new machine would stop and ask. Choosing the folder is
// the one moment the page has it in its hands, so that is when it writes a
// small file with a number in it and tells the helper to go and find it.
// Nobody is waiting then; by the time an export is pressed the answer is
// already known.
const fs = require('fs');
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

const raw = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = raw.match(/DCP_VERSION="([0-9.]+)"/)[1];

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

// A folder handle that records what gets written into it.
function fakeDir(name, existing) {
  const written = {};
  const files = Object.assign({}, existing || {});
  const dir = {
    kind: 'directory', name, written, files,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    async getDirectoryHandle(n, o) {
      if (!files[n] && !(o && o.create)) throw new Error('no');
      files[n] = files[n] || fakeDir(n);
      return files[n];
    },
    async getFileHandle(n, o) {
      if (!(n in files) && !(o && o.create)) throw new Error('no');
      if (!(n in files)) files[n] = '';
      return {
        getFile: async () => ({ text: async () => String(files[n]) }),
        createWritable: async () => ({
          write: async v => { files[n] = String(v); written[n] = String(v); },
          close: async () => {}
        })
      };
    },
    async *values() {}
  };
  return dir;
}

const run = existing => new Promise(res => {
  const sent = [];
  const dom = new JSDOM(raw.replace('__DCP_TOKEN__', 'a'.repeat(64)).replace('__DCP_SRVVER__', VER), {
    runScripts: 'dangerously', url: 'http://localhost:8777/',
    beforeParse(w) {
      w.fetch = u => { sent.push(String(u)); return Promise.resolve({ ok: true, status: 200,
        text: async () => 'looking', json: async () => ({}) }); };
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
      w.indexedDB = undefined;
    } });
  const w = dom.window; w.onerror = () => {};
  setTimeout(async () => {
    const dir = fakeDir('EVCam_Video', existing);
    w.__dir = dir;
    await w.eval('markFolder(window.__dir)');
    await new Promise(r => setTimeout(r, 120));
    const ex = dir.files['Dashcam and Sentry exports'];
    res({ sent, mark: ex ? ex.files['.dcp-folder'] : undefined,
          wrote: ex ? Object.keys(ex.written) : [],
          token: w.eval('folderToken') });
    dom.window.close();
  }, 500);
});

(async () => {
  const a = await run();
  if (!a.mark) fail('nothing was written into the chosen folder');
  else if (!/^[0-9a-f]{8,32}$/.test(a.mark)) fail('the mark is not a plain number: ' + JSON.stringify(a.mark));
  if (a.token !== a.mark) fail('the page kept a different number than it wrote');

  const call = a.sent.find(u => u.startsWith('/locate'));
  if (!call) fail('the helper was never told to go and look');
  else {
    if (!call.includes('token=' + a.mark)) fail('the number was not passed on: ' + call);
    if (!/[?&]root=EVCam_Video\b/.test(call)) fail('the folder name was not passed on: ' + call);
  }

  // Opening the same card again must not change the number: the helper has
  // already worked out where that folder is, and a new number would throw
  // that away and make it search all over again.
  const b = await run({ 'Dashcam and Sentry exports': (() => {
    const d = fakeDir('Dashcam and Sentry exports'); d.files['.dcp-folder'] = 'deadbeef1234'; return d;
  })() });
  if (b.mark !== 'deadbeef1234') fail('reopening the same folder rewrote the number: ' + b.mark);
  if (b.wrote.length) fail('the file was rewritten when it did not need to be');
  if (b.token !== 'deadbeef1234') fail('the existing number was not picked up: ' + b.token);

  // The number travels with the export, so the tool can confirm it has the
  // right folder rather than the right NAME.
  if (!/token=.*\+?.*&tool=|[?&]token=/.test(raw.match(/localFetch\("\/split\?[\s\S]{0,400}/)[0]))
    fail('the export request does not carry the number');

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('choosing a folder marks it and sets the helper looking, once');
  process.exit(0);
})();
