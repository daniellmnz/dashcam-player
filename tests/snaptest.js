// The Snapshot button writes a file.
//
// It used to paint the frame into the page as an image and leave the saving
// to you. Now it opens a save dialog and writes a JPEG, and falls back to the
// browser's own download where there is no such dialog. Both paths are driven here in a
// real browser: canvas.toBlob, showSaveFilePicker and a download are all
// things jsdom does not have.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const SRC = process.env.DCP_SRC || path.resolve(__dirname, '..', 'src');
const { chromium } = require(process.env.NM + '/playwright-core');
// Where that browser is. A clone of this repository has no browser at
// the path this was developed against - playwright-core deliberately
// downloads none - so the runner passes one in and this falls back for
// anyone running the file directly.
const CHROMIUM = process.env.DCP_CHROMIUM || '/opt/pw-browsers/chromium';
const PAGE = process.env.DCP_PAGE || SRC + '/dashcam-player.html';
const VER = fs.readFileSync(PAGE, 'utf8').match(/DCP_VERSION="([0-9.]+)"/)[1];

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };
const eq = (what, got, want) => { if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };

const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ping') { res.writeHead(200); return res.end(); }
  if (u === '/version') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(VER); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fs.readFileSync(PAGE, 'utf8')
            .replace('__DCP_TOKEN__', 'x'.repeat(64))
            .replace('__DCP_SRVVER__', VER));
});

srv.listen(8800, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8800/'); await p.waitForTimeout(700);

  // The picture that used to be shown in the page is gone, and so is the
  // sound button: a control left in the markup but unwired is worse than
  // either having it or not.
  eq('the in-page snapshot image is gone', await p.evaluate(() => !!document.getElementById('shot')), false);
  eq('the sound button is gone', await p.evaluate(() => !!document.getElementById('mute')), false);

  // A recording on screen, with a frame drawn on the canvas.
  await p.evaluate(() => {
    document.getElementById('transport').hidden = false;
    document.getElementById('stage').classList.remove('empty');
    document.getElementById('dropzone').style.display = 'none';
    const c = document.getElementById('canvas'); c.hidden = false; c.width = 320; c.height = 180;
    const g = c.getContext('2d'); g.fillStyle = '#24405a'; g.fillRect(0, 0, 320, 180);
    segments.length = 0;
    segments.push({ name: '20261010_140247_surround.mp4', status: 'ok', start: 1, session: 's',
                    file: { size: 10, relPath: '20261010_140247_surround.mp4' } });
    current = 0;
    mode = { kind: 'grid' };
    let t = 153;
    Object.defineProperty(video, 'currentTime', { get: () => t, set: v => { t = v; }, configurable: true });
    Object.defineProperty(video, 'duration', { get: () => 600, configurable: true });
    window.draw = () => {};   // nothing to draw from: there is no real video
  });

  // --- the dialog opens in the exports folder ------------------------------
  // Snapshots belong with the split and rectified files, in the one folder at
  // the top of the card. Still a dialog - this only sets where it starts.
  await p.evaluate(() => {
    window.__made = [];
    const folder = name => ({
      __name: name,
      getDirectoryHandle: async (n, o) => {
        if (o && o.create) window.__made.push(name + '/' + n);
        else if (!window.__exists) throw new Error('not found');
        return folder(name + '/' + n);
      }
    });
    window.__exists = false;              // nothing created yet
    dirHandle = folder('root');
    dirHandle.queryPermission = async () => 'granted';
  });
  await p.evaluate(() => { window.__picked = null; window.__bytes = null;
    window.showSaveFilePicker = async opts => {
      window.__picked = opts;
      return { name: opts.suggestedName, createWritable: async () => ({
        write: async blob => { window.__bytes = new Uint8Array(await blob.arrayBuffer()); },
        close: async () => {} }) };
    }; });
  await p.click('#snap');
  await p.waitForTimeout(300);
  const made = await p.evaluate(() => window.__made);
  const startedIn = await p.evaluate(() => (window.__picked || {}).startIn
                                           && window.__picked.startIn.__name);
  if (!/Dashcam and Sentry exports/.test(made.join('|')))
    fail('the exports folder was not made: ' + JSON.stringify(made));
  if (!/snapshots/.test(made.join('|')))
    fail('the snapshots folder was not made: ' + JSON.stringify(made));
  if (!/snapshots$/.test(startedIn || ''))
    fail('the dialog does not open in the snapshots folder: ' + startedIn);

  // Refused permission is not a failure: the dialog still opens.
  await p.evaluate(() => { dirHandle.queryPermission = async () => 'denied';
                           dirHandle.requestPermission = async () => 'denied';
                           window.__picked = null; });
  await p.click('#snap');
  await p.waitForTimeout(300);
  if (await p.evaluate(() => !window.__picked))
    fail('refusing permission stopped the snapshot altogether');
  if (await p.evaluate(() => !!(window.__picked || {}).startIn))
    fail('a folder was used that could not be created');

  await p.evaluate(() => { dirHandle = null; });

  // --- the dialog, accepted ------------------------------------------------
  await p.evaluate(() => {
    window.__picked = null; window.__bytes = null;
    window.showSaveFilePicker = async opts => {
      window.__picked = opts;
      return { name: opts.suggestedName, createWritable: async () => ({
        write: async blob => { window.__bytes = new Uint8Array(await blob.arrayBuffer()); },
        close: async () => {} }) };
    };
  });
  await p.click('#snap');
  await p.waitForTimeout(300);

  const picked = await p.evaluate(() => window.__picked && window.__picked.suggestedName);
  const types = await p.evaluate(() => JSON.stringify((window.__picked || {}).types || []));
  if (!picked) fail('no save dialog was opened');
  // Named after the recording and the position, so two snapshots of one file
  // do not land on top of each other.
  else if (!/^20261010_140247_surround_2m33s\.jpg$/.test(picked))
    fail('the suggested name does not say which recording or when: ' + picked);
  if (!/image\/jpeg/.test(types)) fail('the dialog does not offer a JPEG: ' + types);

  // The first bytes of a JPEG: SOI, then the APP0 marker.
  const head = await p.evaluate(() => Array.from((window.__bytes || []).slice(0, 4)).join(','));
  eq('a JPEG was written', head, '255,216,255,224');
  const note = (await p.textContent('#snapNote')) || '';
  if (!/^Saved /.test(note)) fail('the page does not confirm the save: ' + JSON.stringify(note));

  // Single-camera view: the name says which camera.
  await p.evaluate(() => { mode = { kind: 'lane', i: 0 }; window.__picked = null; });
  await p.click('#snap'); await p.waitForTimeout(250);
  const laneName = await p.evaluate(() => window.__picked && window.__picked.suggestedName);
  if (!/_[A-Za-z]+_2m33s\.jpg$/.test(laneName || ''))
    fail('a single-camera snapshot is not named after the camera: ' + laneName);

  // --- the dialog, cancelled ----------------------------------------------
  await p.evaluate(() => {
    window.showSaveFilePicker = async () => {
      const e = new Error('cancelled'); e.name = 'AbortError'; throw e;
    };
  });
  const cancelled = [];
  p.on('download', d => cancelled.push(d));
  await p.click('#snap'); await p.waitForTimeout(400);
  eq('cancelling saves nothing', cancelled.length, 0);
  eq('cancelling leaves no message', await p.evaluate(() => document.getElementById('snapNote').hidden), true);

  // --- no dialog in this browser ------------------------------------------
  await p.evaluate(() => { delete window.showSaveFilePicker; });
  const dl = await Promise.all([
    p.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    p.click('#snap')
  ]).then(r => r[0]);
  if (!dl) fail('with no save dialog, nothing was downloaded either');
  else {
    if (!/\.jpg$/.test(dl.suggestedFilename())) fail('the download is not a .jpg: ' + dl.suggestedFilename());
    const to = path.join(os.tmpdir(), 'dcp-snap-' + process.pid + '.jpg');
    await dl.saveAs(to);
    const buf = fs.readFileSync(to);
    if (buf[0] !== 0xff || buf[1] !== 0xd8) fail('the downloaded file is not a JPEG');
    fs.unlinkSync(to);
  }

  if (errs.length) { bad++; console.log('  FAIL page errors: ' + errs.join('; ')); }
  await b.close(); srv.close();
  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('the snapshot is written as a JPEG to a file you choose, or downloaded where it cannot ask');
});
