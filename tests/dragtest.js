// Dragging the in and out pointers.
//
// A real browser with a real mouse: pointer capture, hit areas and drag are
// exactly the things that look right in the source and do nothing on screen.
// This also holds the drag to the pointer. Moving a mark rewrites the clip
// readout beside the timeline, and a longer reading squeezed the timeline
// itself, so a rail measured afresh on every move was a ruler that changed
// length while it was being used - and the mark landed four seconds from
// where it was dropped. The rail is now measured once, as the mark is taken
// hold of.
// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
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
const near = (what, got, want, tol) => {
  if (Math.abs(got - want) > tol) fail(`${what}: ${got}, wanted about ${want}`);
};

const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ping') { res.writeHead(200); return res.end(); }
  if (u === '/version') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(VER); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fs.readFileSync(PAGE, 'utf8')
            .replace('__DCP_TOKEN__', 'x'.repeat(64))
            .replace('__DCP_SRVVER__', VER));
});

srv.listen(8798, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 420 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8798/'); await p.waitForTimeout(800);

  // A ten-minute recording on screen, with a settable playhead.
  await p.evaluate(() => {
    document.getElementById('transport').hidden = false;
    document.getElementById('scrub').hidden = false;
    document.getElementById('stage').classList.remove('empty');
    document.getElementById('dropzone').style.display = 'none';
    const c = document.getElementById('canvas'); c.hidden = false; c.width = 1280; c.height = 300;
    let t = 0, d = 600;
    Object.defineProperty(video, 'duration', { get: () => d, configurable: true });
    Object.defineProperty(video, 'currentTime', { get: () => t, set: v => { t = v; }, configurable: true });
    window.__t = () => t; window.__seek = v => { t = v; };
    // A four-camera recording open: In and Out are only offered where a clip
    // could actually be written, so without one there is nothing to drag.
    const lanes = [1,2,3,4].map(n => ({ lane:n, displayOrder:n,
      x0:((n-1)%2)*1280, y0:(n>2?1280:0), x1:((n-1)%2)*1280+1280, y1:(n>2?2560:1280) }));
    segments.length = 0;
    segments.push({ name:'20261010_140247_surround.mp4', status:'ok', start:1, session:'s',
                    view:null, file:{ size:1000, relPath:'20261010_140247_surround.mp4' },
                    sidecar:{ laneLayout:{ lanes }, recordingSessionId:'s' } });
    current = 0; mode = { kind:'lane', i:0 };
    __seek(120); setIn(); __seek(360); setOut();
    // The clock beside the timeline carries the recording's own wall time
    // once a file is open. Drawn here, as it would be on screen, so the
    // row is at its settled width before anything is measured.
    updateTime();
  });
  await p.waitForTimeout(200);

  const st = async () => JSON.parse(await p.evaluate('JSON.stringify({i:clip.in,o:clip.out,t:__t()})'));
  const rail = await (await p.$('.seekrail')).boundingBox();
  const timeAtX = x => (x - rail.x) / rail.width * 600;

  const before = await st();
  near('in point to begin with', before.i, 120, 0.01);

  // Drag the in pointer to about a quarter of the way along. Three seconds of
  // tolerance on a ten-minute recording: enough for a pixel either way, not
  // enough to hide a rail that changed width mid-drag.
  const pin = await (await p.$('#pinIn')).boundingBox();
  const targetX = rail.x + rail.width * 0.25;
  await p.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2);
  await p.mouse.down();
  await p.mouse.move(targetX, pin.y + pin.height / 2, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(120);
  const after = await st();
  near('in point after dragging', after.i, timeAtX(targetX), 3);
  near('the picture followed the mark', after.t, after.i, 0.01);
  if (after.o !== before.o) fail('dragging the in pointer moved the out pointer');

  // The pointer is left where the mark is, not where the maths went.
  const nowPin = await (await p.$('#pinIn')).boundingBox();
  near('pointer sits at the mark', nowPin.x + nowPin.width / 2, targetX, 4);

  // They must not cross: drag in well past out.
  await p.mouse.move(nowPin.x + nowPin.width / 2, nowPin.y + nowPin.height / 2);
  await p.mouse.down();
  await p.mouse.move(rail.x + rail.width * 0.95, nowPin.y + nowPin.height / 2, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(120);
  const crossed = await st();
  if (crossed.i >= crossed.o) fail(`the marks crossed: in ${crossed.i}, out ${crossed.o}`);
  near('in stopped just short of out', crossed.i, crossed.o - 0.1, 0.02);

  // And the keyboard moves them too, for anyone not using a mouse. The marks
  // are put back well apart first: the test above deliberately left them
  // touching, where the gap is rightly what stops the next nudge rather than
  // a broken key handler.
  await p.evaluate(() => { clearClip(); __seek(120); setIn(); __seek(360); setOut(); });
  await p.focus('#pinOut');
  const k0 = await st();
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowLeft');
  const k1 = await st();
  near('two taps moved the out point', k1.o, k0.o - 0.2, 0.01);
  await p.keyboard.down('Shift'); await p.keyboard.press('ArrowRight'); await p.keyboard.up('Shift');
  const k2 = await st();
  near('shift moves a second', k2.o, k1.o + 1, 0.01);

  if (errs.length) { bad++; console.log('  FAIL page errors: ' + errs.join('; ')); }
  await b.close(); srv.close();
  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('the pointers drag, carry the picture with them, and cannot cross');
});
