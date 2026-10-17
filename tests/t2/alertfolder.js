// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
// Deleting a sentry alert takes its whole folder: the clip, the still and
// info_inner.txt. This is the destructive path, so the cases that must be
// REFUSED matter more than the one that works.
const fs = require('fs');
const { JSDOM } = require(process.env.NM + '/jsdom');
const PAGE = SRC + '/dashcam-player.html';
const dom = new JSDOM(fs.readFileSync(PAGE, 'utf8'), {
  runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined; w.confirm = () => true;
  } });
const w = dom.window; w.onerror = () => {};

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

setTimeout(async () => {
  // A stand-in for the File System Access API: a folder tree that records
  // every removal, so what was deleted can be checked rather than assumed.
  w.eval(`
    window.__log = [];
    function mkdir(name, entries) {
      const self = {
        kind: 'directory', name, entries,
        values() {
          const list = Object.keys(self.entries).map(n => {
            const v = self.entries[n];
            return (v && v.kind === 'directory') ? v : { kind: 'file', name: n };
          });
          let i = 0;
          return { [Symbol.asyncIterator]() { return this; },
                   next() { return Promise.resolve(i < list.length
                              ? { value: list[i++], done: false }
                              : { value: undefined, done: true }); } };
        },
        async removeEntry(n, opts) {
          const v = self.entries[n];
          if (v === undefined) throw new Error('not found: ' + n);
          if (v && v.kind === 'directory' && !(opts && opts.recursive)
              && Object.keys(v.entries).length) throw new Error('not empty: ' + n);
          delete self.entries[n];
          window.__log.push(name + '/' + n);
        }
      };
      return self;
    }
    window.__mkdir = mkdir;
  `);

  const run = async (label, build, expect) => {
    const got = await w.eval(`(async function(){
      window.__log = [];
      ${build}
      await removeAlertFolder(dirHandles['${expect.dir}'], '${expect.dir}');
      return window.__log.slice();
    })()`);
    const g = JSON.stringify([...got].sort());
    const want = JSON.stringify([...expect.removed].sort());
    if (g !== want) fail(`${label}: removed ${g}, expected ${want}`);
  };

  const ALERT = "2026-10-10_10_56_19_alert_360";
  const base = (inner) => `
    const alert = __mkdir('${ALERT}', ${inner});
    const sentry = __mkdir('Sentry', { '${ALERT}': alert });
    dirHandles = { '': __mkdir('root', { 'Sentry': sentry }),
                   'Sentry/': sentry,
                   'Sentry/${ALERT}/': alert };
  `;

  // The real shape, with the clip already removed by the caller.
  await run('an emptied alert folder',
    base(`{ '${ALERT}.jpg': 1, 'info_inner.txt': 1 }`),
    { dir: `Sentry/${ALERT}/`,
      removed: [`${ALERT}/${ALERT}.jpg`, `${ALERT}/info_inner.txt`, `Sentry/${ALERT}`] });

  // Another recording still in there: touch nothing at all.
  await run('another clip present',
    base(`{ '${ALERT}.jpg': 1, 'info_inner.txt': 1, 'other.mp4': 1 }`),
    { dir: `Sentry/${ALERT}/`, removed: [] });

  // A subfolder: not the shape we think it is, so leave it alone.
  await run('a subfolder present',
    base(`{ 'info_inner.txt': 1, 'sub': __mkdir('sub', { 'x.txt': 1 }) }`),
    { dir: `Sentry/${ALERT}/`, removed: [] });

  // Already empty: just the folder goes.
  await run('already empty', base(`{}`),
    { dir: `Sentry/${ALERT}/`, removed: [`Sentry/${ALERT}`] });

  // No parent handle: the files go, the folder stays rather than guessing.
  const got = await w.eval(`(async function(){
    window.__log = [];
    const alert = __mkdir('${ALERT}', { 'info_inner.txt': 1 });
    dirHandles = { 'Sentry/${ALERT}/': alert };
    await removeAlertFolder(alert, 'Sentry/${ALERT}/');
    return window.__log.slice();
  })()`);
  if (JSON.stringify(got) !== JSON.stringify([`${ALERT}/info_inner.txt`]))
    fail('no parent handle: removed ' + JSON.stringify(got));

  // Called with nothing: must not throw.
  await w.eval(`removeAlertFolder(null,'x/')`);
  await w.eval(`removeAlertFolder({},'')`);

  // And the whole way through deleteSelected, which is what actually runs.
  // Testing the helper alone would not notice if nothing ever called it.
  const end = await w.eval(`(async function(){
    window.__log = [];
    const ALERT = '${ALERT}';
    const alert = __mkdir(ALERT, { [ALERT+'.mp4']:1, [ALERT+'.jpg']:1, 'info_inner.txt':1 });
    const sentry = __mkdir('Sentry', { [ALERT]: alert });
    const root = __mkdir('root', { 'Sentry': sentry });
    root.queryPermission = async () => 'granted';
    root.requestPermission = async () => 'granted';
    dirHandle = root;
    dirHandles = { '': root, 'Sentry/': sentry, ['Sentry/'+ALERT+'/']: alert };
    segments.length = 0;
    segments.push({ name: ALERT+'.mp4', sentry: true, status:'ok', start: 1,
                    session: 's', file: { size: 1000, relPath: 'Sentry/'+ALERT+'/'+ALERT+'.mp4' } });
    picked.clear(); picked.add(segKey(segments[0]));
    // The re-read at the end would walk a stub tree; it is not what is
    // under test here.
    openHandle = async () => {};
    await deleteSelected();
    return window.__log.slice();
  })()`);
  const wantEnd = [ `${ALERT}/${ALERT}.mp4`, `${ALERT}/${ALERT}.jpg`,
                    `${ALERT}/info_inner.txt`, `Sentry/${ALERT}` ];
  if (JSON.stringify([...end].sort()) !== JSON.stringify([...wantEnd].sort()))
    fail('deleteSelected on an alert removed ' + JSON.stringify(end));

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('an alert folder goes only once it holds nothing else');
  dom.window.close(); process.exit(0);
}, 500);
