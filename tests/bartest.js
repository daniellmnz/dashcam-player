// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', 'src');
// Changing the crop must not move the control bar.
//
// It used to sit below the video, and the stage grows to whatever the canvas
// needs, so every change to the trim slid the bar up or down - and with a tall
// grid it went off the bottom of the window altogether. Measured in a real
// browser, because only a layout engine can answer a layout question.
const http = require('http'), fs = require('fs');
const { chromium } = require(process.env.NM + '/playwright-core');
// Where that browser is. A clone of this repository has no browser at
// the path this was developed against - playwright-core deliberately
// downloads none - so the runner passes one in and this falls back for
// anyone running the file directly.
const CHROMIUM = process.env.DCP_CHROMIUM || '/opt/pw-browsers/chromium';
// Screenshots go to the system temp folder, not into the checkout.
const SHOT = require('path').join(require('os').tmpdir(), 'dcp-bartest.png');
const PAGE = SRC + '/dashcam-player.html';
const VER = fs.readFileSync(PAGE, 'utf8').match(/DCP_VERSION="([0-9.]+)"/)[1];
const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ping') { res.writeHead(200); return res.end(); }
  if (u === '/version') { res.writeHead(200, {'Content-Type':'text/plain'}); return res.end(VER); }
  res.writeHead(200, {'Content-Type':'text/html'});
  res.end(fs.readFileSync(PAGE, 'utf8')
    .replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', VER));
});
let bad = 0; const fail = m => { bad++; console.log('  FAIL ' + m); };

srv.listen(8794, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8794/');
  await p.waitForTimeout(700);

  // A 2x2 grid frame, which is the tall case that pushed the bar off-screen.
  await p.evaluate(() => {
    document.getElementById('transport').hidden = false;
    document.getElementById('scrub').hidden = false;
    document.getElementById('stage').classList.remove('empty');
    document.getElementById('dropzone').style.display = 'none';
    const c = document.getElementById('canvas');
    c.hidden = false; c.width = 1280; c.height = 1330;
  });
  await p.waitForTimeout(200);

  const where = () => p.evaluate(() => {
    const r = id => document.getElementById(id).getBoundingClientRect();
    const t = r('transport'), c = r('canvas'), s = r('scrub');
    return { barTop: Math.round(t.top), barBottom: Math.round(t.bottom),
             canvasH: Math.round(c.height),
             // No blank space between the bar and the picture.
             gapAbove: Math.round(c.top - t.bottom),
             // The scrub bar rides with the video rather than drifting away.
             gapBelow: Math.round(s.top - c.bottom),
             // And is the width of the picture, not of the window.
             widthDiff: Math.round(s.width - c.width) };
  });

  const seen = [];
  for (const h of [1330, 900, 1600, 700, 1330]) {
    await p.evaluate(hh => { document.getElementById('canvas').height = hh; }, h);
    await p.waitForTimeout(120);
    seen.push(await where());
  }

  const tops = [...new Set(seen.map(s => s.barTop))];
  const bots = [...new Set(seen.map(s => s.barBottom))];
  if (tops.length !== 1) fail('the bar moved: tops were ' + JSON.stringify(tops));
  if (bots.length !== 1) fail('the bar changed height: bottoms were ' + JSON.stringify(bots));
  // It also has to be ON the screen, not merely consistent.
  if (seen[0].barTop < 0 || seen[0].barBottom > 720)
    fail(`the bar is off-screen: ${seen[0].barTop}..${seen[0].barBottom}`);
  // No gap above the picture, and the scrub bar glued to its bottom edge,
  // at every canvas height.
  for (const k of ['gapAbove','gapBelow','widthDiff']) {
    const vals = [...new Set(seen.map(s => s[k]))];
    if (vals.length !== 1) fail(`${k} varied: ${JSON.stringify(vals)}`);
  }
  if (seen[0].gapAbove !== 0) fail(`blank space above the video: ${seen[0].gapAbove}px`);
  if (seen[0].gapBelow < 0 || seen[0].gapBelow > 12)
    fail(`the scrub bar is not against the video: ${seen[0].gapBelow}px`);
  if (seen[0].widthDiff !== 0)
    fail(`the scrub bar is not the width of the video: ${seen[0].widthDiff}px`);

  // And above the video, which is what was asked for.
  const order = await p.evaluate(() => {
    const t = document.getElementById('transport').getBoundingClientRect();
    const s = document.getElementById('stage').getBoundingClientRect();
    return { barBottom: Math.round(t.bottom), stageTop: Math.round(s.top) };
  });
  if (order.barBottom > order.stageTop + 1) fail('the bar is not above the video');

  // A stage taller than its contents is where the gap really came from: the
  // picture used to be centred in it, leaving blank space under the bar. A
  // short video in a tall frame must still start at the top.
  await p.evaluate(() => {
    document.getElementById('canvas').height = 300;
    document.getElementById('stage').style.minHeight = '640px';
  });
  await p.waitForTimeout(150);
  const tall = await where();
  if (tall.gapAbove !== 0)
    fail(`a short video in a tall frame floats: ${tall.gapAbove}px above it`);
  if (tall.barTop !== seen[0].barTop)
    fail('the bar moved when the stage grew');
  await p.evaluate(() => { document.getElementById('stage').style.minHeight = ''; });

  // The canvas really was changing size, or none of the above proves anything.
  if (new Set(seen.map(s => s.canvasH)).size < 2)
    fail('the canvas never changed height, so nothing was tested');

  console.log('  bar at ' + seen[0].barTop + '..' + seen[0].barBottom
    + ', gap above video ' + seen[0].gapAbove + 'px, scrub ' + seen[0].gapBelow
    + 'px below it, across canvas heights ' + JSON.stringify(seen.map(s => s.canvasH)));
  console.log('errors:', errs.length ? errs : 'none');
  if (errs.length) bad++;
  await b.close(); srv.close();
  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('the bar holds still, the video sits under it, the scrubber under that');
});
