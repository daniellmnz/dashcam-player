// The keyboard shortcuts, pressed the way they are actually reached.
//
// They worked perfectly from a standing start and failed in use, because the
// handler ignored every key while focus sat on any INPUT or SELECT - and the
// timeline is an <input type=range>. Scrub to the moment you want, which is
// the ordinary way to get there, and i, o, c and the rest were dead until you
// happened to click somewhere else. The tick boxes, the Lens slider and the
// speed list did the same.
//
// So every shortcut here is pressed AFTER touching the control you would have
// touched first. A test that presses them with nothing focused passes against
// the broken version.
const http = require('http'), fs = require('fs'), path = require('path');
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

const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ping') { res.writeHead(200); return res.end(); }
  if (u === '/version') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(VER); }
  if (u === '/ffmpeg') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ffmpeg":true,"winget":true,"state":"done","detail":""}');
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fs.readFileSync(PAGE, 'utf8')
            .replace('__DCP_TOKEN__', 'x'.repeat(64))
            .replace('__DCP_SRVVER__', VER));
});

srv.listen(8812, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 600 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8812/'); await p.waitForTimeout(600);

  await p.evaluate(() => {
    document.getElementById('transport').hidden = false;
    document.getElementById('scrub').hidden = false;
    document.getElementById('stage').classList.remove('empty');
    document.getElementById('dropzone').style.display = 'none';
    const c = document.getElementById('canvas'); c.hidden = false; c.width = 1280; c.height = 300;
    let t = 0, d = 600;
    Object.defineProperty(video, 'duration', { get: () => d, configurable: true });
    Object.defineProperty(video, 'currentTime', { get: () => t, set: v => { t = v; }, configurable: true });
    window.__seek = v => { t = v; };
    const lanes = [1,2,3,4].map(n => ({ lane:n, displayOrder:n,
      x0:((n-1)%2)*1280, y0:(n>2?1280:0), x1:((n-1)%2)*1280+1280, y1:(n>2?2560:1280) }));
    segments.length = 0;
    segments.push({ name:'20261010_140247_surround.mp4', status:'ok', start:1, session:'s',
                    view:null, file:{ size:1000, relPath:'x.mp4' },
                    sidecar:{ laneLayout:{ lanes }, recordingSessionId:'s' } });
    current = 0; mode = { kind:'lane', i:0 };
    syncClip(); syncSplitButton();
  });
  await p.waitForTimeout(200);

  const mark = () => p.evaluate(() => JSON.parse(JSON.stringify({ in: clip.in, out: clip.out })));
  const reset = at => p.evaluate(s => { clearClip(); window.__seek(s); }, at);

  // --- after scrubbing, which is how you reach the moment you want ---------
  await reset(0);
  const sk = await (await p.$('#seek')).boundingBox();
  await p.mouse.click(sk.x + sk.width * 0.4, sk.y + sk.height / 2);
  await p.waitForTimeout(100);
  const at = await p.evaluate(() => video.currentTime);
  await p.keyboard.press('i');
  await p.waitForTimeout(80);
  let m = await mark();
  if (m.in === null) fail('i did nothing after scrubbing - the timeline had focus');
  else if (Math.abs(m.in - at) > 0.5) fail(`i marked ${m.in}, but the playhead was at ${at}`);

  // --- after the other controls you might have just touched ----------------
  for (const [id, label] of [['lensK', 'the Lens slider'], ['burnTime', 'a tick box'],
                             ['play', 'the Play button']]) {
    await p.evaluate(x => { clearClip(); document.getElementById(x).focus(); window.__seek(42); }, id);
    await p.keyboard.press('i');
    await p.waitForTimeout(80);
    if ((await mark()).in !== 42) fail(`i did nothing after ${label}`);
  }

  // --- the speed list hands focus back when it is picked with the mouse ----
  await reset(77);
  const rb = await (await p.$('#rate')).boundingBox();
  await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await p.mouse.down(); await p.mouse.up();
  await p.selectOption('#rate', '2');
  await p.waitForTimeout(150);
  await p.keyboard.press('i');
  await p.waitForTimeout(80);
  if ((await mark()).in !== 77) fail('i did nothing after picking a speed with the mouse');
  if (await p.evaluate(() => document.getElementById('rate').value) !== '2')
    fail('the speed did not change');

  // Reached with the keyboard it keeps focus, because you are still using it.
  await p.evaluate(() => { const r = document.getElementById('rate'); r.focus();
                           r.value = '4'; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(80);
  if (await p.evaluate(() => document.activeElement.id) !== 'rate')
    fail('the speed list lost focus when it was worked from the keyboard');

  // --- and a field you really do type in still swallows them ---------------
  await p.evaluate(() => { clearClip(); document.getElementById('trimTop').focus(); window.__seek(12); });
  await p.keyboard.press('i');
  await p.waitForTimeout(80);
  if ((await mark()).in !== null) fail('i fired while typing in the Trim box');

  // --- the rest of the shortcuts, from the timeline ------------------------
  await p.mouse.click(sk.x + sk.width * 0.6, sk.y + sk.height / 2);
  await p.keyboard.press('o');
  await p.waitForTimeout(80);
  if ((await mark()).out === null) fail('o did nothing after scrubbing');
  await p.keyboard.press('c');
  await p.waitForTimeout(80);
  m = await mark();
  if (m.in !== null || m.out !== null) fail('c did not clear the clip after scrubbing');
  await p.keyboard.press('g');
  await p.waitForTimeout(80);
  if (await p.evaluate(() => mode.kind) !== 'grid') fail('g did not switch to the grid after scrubbing');

  // --- and the clip keys work on a file that is already one camera --------
  // They did nothing there while the split was the only tool that could
  // write a range, and the split cannot work on such a file. The fisheye
  // tool can, and takes the same marks, so the keys have to reach it.
  await p.evaluate(() => {
    segments[0].view = 'Front';
    segments[0].name = '20261010_140247_surround_Front.mp4';
    clearClip(); syncClip(); syncSplitButton(); window.__seek(33);
  });
  await p.waitForTimeout(80);
  await p.keyboard.press('i');
  await p.waitForTimeout(60);
  let sv = await mark();
  if (sv.in === null) fail('i did not mark a clip on a single-camera file');
  await p.evaluate(() => window.__seek(55));
  await p.keyboard.press('o');
  await p.waitForTimeout(60);
  sv = await mark();
  if (sv.out === null) fail('o did not mark a clip on a single-camera file');
  if (await p.evaluate(() => document.getElementById('markIn').hidden))
    fail('In is hidden on a single-camera file, which the fisheye tool can clip');
  if (await p.evaluate(() => document.getElementById('splitThis').hidden))
    fail('the export button is missing, so nothing could use those marks');
  // And c still clears them.
  await p.keyboard.press('c');
  await p.waitForTimeout(60);
  sv = await mark();
  if (sv.in !== null || sv.out !== null) fail('c did not clear the clip on a single-camera file');

  if (errs.length) { bad++; console.log('  FAIL page errors: ' + errs.join('; ')); }
  await b.close(); srv.close();
  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('the shortcuts work after touching the controls you reach them through');
});
