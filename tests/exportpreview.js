// The frame shown before an export runs.
//
// An export takes minutes, and what comes out is decided by three things
// spread across the bar - which camera is on screen, whether In and Out are
// marked, and the Rectify tick box. So one frame of the result is shown
// first, with OK and Cancel.
//
// The preview has one job and it is easy to get wrong: show what the TOOL
// will write, not what the player is drawing. Trim, the lens slider and zoom
// are ways of looking at a recording and none of them reach the file, and the
// batch works out the camera cell by its own rule rather than from the
// sidecar's lane rectangles. A preview drawn from the player's own canvas
// would be a confident lie, so this drives a real video through the real
// code and reads the pixels back.
const { chromium } = require(process.env.NM + '/playwright-core');
// Where that browser is. A clone of this repository has no browser at
// the path this was developed against - playwright-core deliberately
// downloads none - so the runner passes one in and this falls back for
// anyone running the file directly.
const CHROMIUM = process.env.DCP_CHROMIUM || '/opt/pw-browsers/chromium';
const http = require('http');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SRC = process.env.DCP_SRC || path.resolve(__dirname, '..', 'src');

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

// A frame whose quadrants are plainly different, with a status strip under
// them: Front red, Rear green, Left blue, Right yellow, in the order the
// tools lay them out. VP8, because this browser has no H.264.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcp-pv-'));
const movie = path.join(tmp, 'grid.webm');
try {
  execFileSync('ffmpeg', ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=640x640:d=2:r=5',
    '-f', 'lavfi', '-i', 'color=c=green:s=640x640:d=2:r=5',
    '-f', 'lavfi', '-i', 'color=c=blue:s=640x640:d=2:r=5',
    '-f', 'lavfi', '-i', 'color=c=yellow:s=640x640:d=2:r=5',
    '-f', 'lavfi', '-i', 'color=c=gray:s=1280x60:d=2:r=5',
    '-filter_complex', '[0][1]hstack[t];[2][3]hstack[b];[t][b]vstack[g];[g][4]vstack',
    '-c:v', 'libvpx', '-b:v', '1M', '-frames:v', '10', movie], { stdio: 'pipe' });
} catch (e) {
  console.log('ffmpeg is not available, so the fixture cannot be built');
  process.exit(2);
}

// And a second fixture whose cameras are genuinely fisheye, so that the
// straightening has something to straighten - plus what ffmpeg itself makes
// of one of those cameras, which is the only honest thing to measure the
// page's approximation against.
const fish = path.join(tmp, 'fish.webm');
const cellPng = path.join(tmp, 'cell.png');
const flatPng = path.join(tmp, 'flat.png');
const trimPng = path.join(tmp, 'trim.png');
const V360 = 'v360=fisheye:flat:ih_fov=180:iv_fov=180:d_fov=120:w=512:h=384:interp=lanczos';
// 15% off the top and 30% off the bottom of a 384-tall straightened frame,
// worked out exactly as rectify-fisheye.bat does it: whole percentages, both
// the offset and the height floored to even because yuv420p will not take an
// odd one. 384*15/100 = 57 -> 56; 384*30/100 = 115; 384-56-115 = 213 -> 212.
const TRIM_V360 = V360 + ',crop=512:212:0:56';
try {
  // One square camera: a grid pushed through a fisheye.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x640:rate=5:d=2',
    '-vf', 'drawgrid=w=64:h=64:t=3:c=white@0.9,v360=flat:fisheye:h_fov=120:v_fov=120:ih_fov=120:iv_fov=120:w=640:h=640',
    '-c:v', 'libvpx', '-b:v', '1M', '-frames:v', '10', path.join(tmp, 'cell.webm')], { stdio: 'pipe' });
  // Four of them in a grid, with a status strip.
  const c = path.join(tmp, 'cell.webm');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', c, '-i', c, '-i', c, '-i', c,
    '-f', 'lavfi', '-i', 'color=c=gray:s=1280x60:d=2:r=5',
    '-filter_complex', '[0:v][1:v]hstack[t];[2:v][3:v]hstack[b];[t][b]vstack[g];[g][4:v]vstack',
    '-c:v', 'libvpx', '-b:v', '1M', '-frames:v', '10', fish], { stdio: 'pipe' });
  // That camera as a still, and ffmpeg's own straightening of it.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', c, '-frames:v', '1', cellPng], { stdio: 'pipe' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', cellPng, '-vf', V360, '-frames:v', '1', flatPng], { stdio: 'pipe' });
  // And the same thing with the trim the player would carry into it.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', cellPng, '-vf', TRIM_V360, '-frames:v', '1', trimPng], { stdio: 'pipe' });
} catch (e) {
  console.log('the fisheye fixtures could not be built');
  process.exit(2);
}

// The export button is only wired when the page believes a helper served it,
// so it is served - from localhost, with the version the page expects.
const PAGE = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = PAGE.match(/DCP_VERSION="([0-9.]+)"/)[1];
const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ping') { res.writeHead(200); return res.end(); }
  if (u === '/ffmpeg') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ffmpeg":true,"winget":true,"state":"done","detail":""}');
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(PAGE.replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', VER));
});

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));
  await page.goto('http://localhost:' + port + '/');

  // Every request the page makes, so "did it actually start?" is answered by
  // what went down the wire rather than by what the panel says.
  await page.evaluate(() => {
    window.__sent = [];
    window.fetch = u => { window.__sent.push(String(u)); return Promise.resolve({
      ok: true, status: 200, text: async () => 'started',
      json: async () => ({ state: 'starting' }) }); };
  });

  const b64 = fs.readFileSync(movie).toString('base64');
  const loaded = await page.evaluate(async d => {
    const v = document.querySelector('video');
    // blob:, not data:: the page's own policy allows one and not the other.
    const bin = Uint8Array.from(atob(d), c => c.charCodeAt(0));
    v.src = URL.createObjectURL(new Blob([bin], { type: 'video/webm' }));
    await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 5000); });
    v.currentTime = 0.2;
    await new Promise(r => { v.onseeked = r; setTimeout(r, 2000); });
    return { w: v.videoWidth, h: v.videoHeight };
  }, b64);
  if (loaded.w !== 1280) { console.log('the fixture did not decode: ' + JSON.stringify(loaded)); process.exit(2); }

  const setup = (lane, extra) => page.evaluate(([lane, extra]) => {
    segments.length = 0;
    segments.push({ name: 'a_surround.mp4', status: 'ok', start: Date.now(), session: 's',
      view: null, missing: false, flat: false, sidecar: null, seconds: 60,
      file: { size: 10, relPath: 'Movies/a_surround.mp4', name: 'a_surround.mp4' } });
    current = 0; mode = { kind: 'lane', i: lane };
    clip.in = null; clip.out = null;
    dirHandle = { name: 'Movies' };
    Object.assign(window, {});
    if (extra && extra.trim) { trim.top = 40; trim.bottom = 40; }
    if (extra && extra.lens) { lens.k = 0.9; lens.zoom = 1.6; }
    if (extra && extra.clip) { clip.in = extra.clip[0]; clip.out = extra.clip[1]; }
    window.__sent.length = 0;
    // An export started earlier in this run leaves a poll behind that keeps
    // rewriting the message panel - straight over the next question. Nothing
    // here is watching a real run, so stop it with the rest of the reset.
    try { clearInterval(splitPoll); splitPoll = null; } catch (e) {}
    syncSplitButton();
  }, [lane, extra || null]);

  // Ask for the preview and read back the pixels it drew.
  const preview = () => page.evaluate(() => {
    const img = document.querySelector('#msg .xpv');
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const at = (x, y) => {
      const p = c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return [p[0], p[1], p[2]];
    };
    return { w: c.width, h: c.height, middle: at(c.width / 2, c.width / 2),
             strip: c.height > c.width ? at(c.width / 2, c.width + (c.height - c.width) / 2) : null,
             text: document.getElementById('msg').textContent };
  });

  const near = (got, want) => got && got.every((v, i) => Math.abs(v - want[i]) < 70);

  // --- the right camera ------------------------------------------------
  // Lane by lane, because an off-by-one here exports the wrong camera and
  // nothing downstream would notice: the file plays perfectly.
  const WANT = [['Front', [255, 0, 0]], ['Rear', [0, 128, 0]],
                ['Left', [0, 0, 255]], ['Right', [255, 255, 0]]];
  for (let i = 0; i < 4; i++) {
    await setup(i);
    await page.evaluate(i => { confirmExport(segments[0], i, 'split', 'x'); }, i);
    await page.waitForTimeout(250);
    const pv = await preview();
    if (!pv) { fail(`${WANT[i][0]}: no preview was drawn at all`); continue; }
    if (!near(pv.middle, WANT[i][1]))
      fail(`${WANT[i][0]} previewed the wrong camera: got rgb(${pv.middle}) wanted rgb(${WANT[i][1]})`);
    if (pv.w !== 640) fail(`${WANT[i][0]} previewed a ${pv.w}px cell, wanted 640`);
    // The status strip travels with the view, as the tools stack it.
    if (!pv.strip) fail(`${WANT[i][0]}: the status strip is missing from the preview`);
    else if (!near(pv.strip, [128, 128, 128])) fail(`${WANT[i][0]}: the strip is not the strip: rgb(${pv.strip})`);
    await page.evaluate(() => exportAsk && exportAsk(false));
    await page.waitForTimeout(80);
  }

  // --- the viewing settings must not appear in it ------------------------
  // Trim crops the picture on screen by 40% top and bottom and the lens
  // slider bends it; neither reaches the file, so neither may reach this.
  await setup(2, { trim: true, lens: true });
  await page.evaluate(() => { confirmExport(segments[0], 2, 'split', 'x'); });
  await page.waitForTimeout(250);
  const adjusted = await preview();
  if (!adjusted) fail('no preview with trim and lens turned up');
  else {
    if (adjusted.w !== 640 || adjusted.h <= 640)
      fail(`trim changed the previewed frame: ${adjusted.w}x${adjusted.h}, wanted 640 plus a strip`);
    if (!near(adjusted.middle, [0, 0, 255]))
      fail('trim or the lens altered what the preview shows: rgb(' + adjusted.middle + ')');
  }

  // --- Cancel really cancels --------------------------------------------
  const cancelled = await page.evaluate(async () => {
    const p = confirmExport(segments[0], 2, 'split', 'x');
    await new Promise(r => setTimeout(r, 120));
    document.getElementById('xpno').click();
    return { answer: await p, sent: window.__sent.length };
  });
  if (cancelled.answer !== null) fail('Cancel did not answer no, it answered ' + JSON.stringify(cancelled.answer));
  if (cancelled.sent !== 0) fail('Cancel still sent a request to the helper');

  // --- OK goes ahead, through the real button ---------------------------
  await setup(1);
  const pressed = page.evaluate(() => document.getElementById('splitThis').onclick());
  await page.waitForTimeout(300);
  if (!(await page.evaluate(() => !!document.querySelector('#msg .xpv'))))
    fail('the export button started without asking');
  if ((await page.evaluate(() => window.__sent.length)) !== 0)
    fail('the request went out before the question was answered');
  await page.evaluate(() => document.getElementById('xpok').click());
  await pressed.catch(() => {});
  await page.waitForTimeout(250);
  const sent = await page.evaluate(() => window.__sent.filter(u => u.startsWith('/split?')));
  if (!sent.length) fail('OK did not start the export');
  else if (!/[?&]views=2\b/.test(sent[0])) fail('the export asked for a different camera than the preview: ' + sent[0]);

  // --- and the keyboard answers it too -----------------------------------
  await setup(0);
  const viaKeys = page.evaluate(() => confirmExport(segments[0], 0, 'split', 'x'));
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  if ((await viaKeys) !== null) fail('Escape did not cancel the question');
  const viaEnter = page.evaluate(() => confirmExport(segments[0], 0, 'split', 'x'));
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  const entered = await viaEnter;
  if (!entered || entered.tool !== 'split')
    fail('Enter did not confirm the question with the tool it was asked about: ' + JSON.stringify(entered));

  // --- the straightened preview ----------------------------------------
  // Measured against ffmpeg doing the same job, because "it looks about
  // right" is how a preview ends up showing a shape the file never has.
  const cellB64 = fs.readFileSync(cellPng).toString('base64');
  const flatB64 = fs.readFileSync(flatPng).toString('base64');
  const cmp = await page.evaluate(async ([cellD, flatD]) => {
    const load = d => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + d; });
    const [cell, flat] = await Promise.all([load(cellD), load(flatD)]);
    const src = document.createElement('canvas');
    src.width = cell.naturalWidth; src.height = cell.naturalHeight;
    src.getContext('2d').drawImage(cell, 0, 0);
    const mine = rectifyPreview(src, flat.naturalWidth, flat.naturalHeight);
    if (!mine) return { err: 'rectifyPreview returned nothing' };
    const want = document.createElement('canvas');
    want.width = flat.naturalWidth; want.height = flat.naturalHeight;
    want.getContext('2d').drawImage(flat, 0, 0);
    const a = mine.getContext('2d').getImageData(0, 0, mine.width, mine.height).data;
    const b = want.getContext('2d').getImageData(0, 0, want.width, want.height).data;
    let diff = 0, n = 0, same = 0;
    const raw = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
    for (let i = 0; i < a.length; i += 4) {
      diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
    // And it is not simply handing back what it was given.
    const m = mine.width / 2 | 0;
    for (let y = 0; y < mine.height; y += 17) {
      const j = (y * mine.width + m) * 4, k = ((y % src.height) * src.width + m) * 4;
      if (a[j] === raw[k] && a[j + 1] === raw[k + 1] && a[j + 2] === raw[k + 2]) same++;
    }
    return { mean: diff / n, w: mine.width, h: mine.height, same };
  }, [cellB64, flatB64]);

  if (cmp.err) fail(cmp.err);
  else {
    if (!(cmp.mean < 14))
      fail(`the straightened preview differs from ffmpeg's by ${cmp.mean.toFixed(1)} per channel, which is not an approximation of it`);
    if (Math.abs(cmp.w / cmp.h - 4 / 3) > 0.02)
      fail(`the straightened preview is ${cmp.w}x${cmp.h}, which is not the 4:3 the tool writes`);
  }

  // And the panel shows it, at the size the file will be, saying it is
  // approximate rather than passing it off as the real output.
  await setup(2);
  await page.evaluate(() => { confirmExport(segments[0], 2, 'rectify', 'x'); });
  await page.waitForTimeout(600);
  const rectPv = await preview();
  if (!rectPv) fail('no preview at all when exporting straightened');
  else {
    if (Math.abs(rectPv.w / rectPv.h - 4 / 3) > 0.25)
      fail(`the straightened preview panel is ${rectPv.w}x${rectPv.h}, nothing like 4:3 plus a strip`);
    if (!/1280/.test(rectPv.text)) fail('the panel does not say what size the file will be: ' + rectPv.text);
    if (!/approximation/i.test(rectPv.text)) fail('the panel passes the approximation off as the real thing');
  }
  await page.evaluate(() => exportAsk && exportAsk(false));

  // --- the straightening can be changed WITH THE QUESTION UP -------------
  // The preview exists so a last look can catch a wrong setting, and "that
  // is still bent" is the likeliest thing that last look catches. Ticking
  // the box must move the frame AND the file together: a box that redraws
  // the preview but exports the other kind, or exports the other kind
  // without redrawing, is worse than one that does nothing at all, because
  // it looks as though it worked.
  await setup(2);
  const turnedOn = await page.evaluate(async () => {
    window.__sent.length = 0;
    const p = confirmExport(segments[0], 2, 'split', 'x', true);
    await new Promise(r => setTimeout(r, 400));
    const box = document.getElementById('xprect');
    if (!box) return { err: 'the question offers no way to straighten it' };
    const before = (document.querySelector('#msg .xpv') || {}).src || '';
    const saidBefore = document.getElementById('msg').textContent;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    const after = (document.querySelector('#msg .xpv') || {}).src || '';
    const saidAfter = document.getElementById('msg').textContent;
    document.getElementById('xpok').click();
    return { answer: await p, changed: before !== after && !!before && !!after,
             saidBefore, saidAfter,
             // The bar box is gone; the remembered setting is what the next
             // export will offer, so that is what must have moved.
             remembered: !!prefs.rectify,
             tip: document.getElementById('splitThis').title };
  });
  if (turnedOn.err) fail(turnedOn.err);
  else {
    if (!turnedOn.answer || turnedOn.answer.tool !== 'rectify')
      fail('ticking the box in the question did not change what gets exported: ' + JSON.stringify(turnedOn.answer));
    if (!turnedOn.changed)
      fail('ticking the box did not redraw the previewed frame, so it showed the wrong picture');
    if (!/approximation/i.test(turnedOn.saidAfter))
      fail('the redrawn panel does not say the straightened frame is approximate');
    if (/approximation/i.test(turnedOn.saidBefore))
      fail('the panel called the plain preview an approximation before anything was ticked');
    if (!turnedOn.remembered)
      fail('the answer was not remembered, so the next export offers the opposite');
    // The button carries one label now, so what must have moved is the
    // remembered answer and the tooltip, not the words on the button.
    if (!/straighten/i.test(turnedOn.tip))
      fail('the button behind the dialog still describes the opposite: ' + turnedOn.tip);
  }

  // ...and back off again, so it is a choice and not a one-way door.
  await setup(2);
  const turnedOff = await page.evaluate(async () => {
    const p = confirmExport(segments[0], 2, 'rectify', 'x', true);
    await new Promise(r => setTimeout(r, 400));
    const box = document.getElementById('xprect');
    if (!box) return { err: 'the question offers no box when opened straightened' };
    if (!box.checked) return { err: 'the question did not open with the box already ticked' };
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    const said = document.getElementById('msg').textContent;
    document.getElementById('xpok').click();
    return { answer: await p, said };
  });
  if (turnedOff.err) fail(turnedOff.err);
  else {
    if (!turnedOff.answer || turnedOff.answer.tool !== 'split')
      fail('unticking the box did not go back to a plain export: ' + JSON.stringify(turnedOff.answer));
    if (/approximation/i.test(turnedOff.said))
      fail('the panel still calls the frame approximate after the straightening was turned off');
  }

  // The vehicle status strip is the other thing the question decides, and
  // it changes the FRAME, not just a label - so the preview has to be redrawn
  // when it is unticked, or it shows a band of data the file will not have.
  await setup(2);
  const noStrip = await page.evaluate(async () => {
    prefs.exportStrip = true;
    const p = confirmExport(segments[0], 2, 'split', 'x', true);
    await new Promise(r => setTimeout(r, 400));
    const box = document.getElementById('xpstrip');
    if (!box) return { err: 'the question never offers to leave the status strip off' };
    if (!box.checked) return { err: 'the strip box did not open ticked, though the setting says include it' };
    const beforeImg = (document.querySelector('#msg .xpv') || {}).src || '';
    const beforeTxt = document.getElementById('msg').textContent;
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    const afterImg = (document.querySelector('#msg .xpv') || {}).src || '';
    const afterTxt = document.getElementById('msg').textContent;
    document.getElementById('xpok').click();
    return { answer: await p, changed: beforeImg !== afterImg && !!beforeImg && !!afterImg,
             beforeTxt, afterTxt, remembered: prefs.exportStrip };
  });
  if (noStrip.err) fail(noStrip.err);
  else {
    if (noStrip.answer === null || noStrip.answer.strip !== false)
      fail('unticking the strip did not reach the export: ' + JSON.stringify(noStrip.answer));
    if (!noStrip.changed)
      fail('unticking the strip did not redraw the frame, so the preview still showed it');
    if (!/plus the status strip/i.test(noStrip.beforeTxt))
      fail('the panel did not say the strip was included to begin with');
    if (/plus the status strip/i.test(noStrip.afterTxt))
      fail('the panel still claims the strip is included after it was unticked');
    if (noStrip.remembered !== false)
      fail('the answer was not remembered for the next export');
  }

  // And the request the helper gets carries it.
  await setup(2);
  const sentStrip = await page.evaluate(async () => {
    window.__sent.length = 0;
    prefs.exportStrip = false;
    document.getElementById('splitThis').onclick();
    for (let i = 0; i < 60 && !document.getElementById('xpok'); i++)
      await new Promise(r => setTimeout(r, 25));
    document.getElementById('xpok').click();
    await new Promise(r => setTimeout(r, 300));
    return window.__sent.slice();
  });
  if (!sentStrip.length) fail('the export did not start at all with the strip left off');
  else if (!/[?&]strip=0\b/.test(sentStrip[0]))
    fail('the request does not tell the tool to leave the strip off: ' + sentStrip[0]);

  // --- the trim carried into a straightened export ----------------------
  // The one place a way of LOOKING at a recording is allowed to reach the
  // file, so it has to land exactly where ffmpeg puts it. Measured against
  // ffmpeg doing the same crop on the same straightened frame - the rounding
  // is the part that goes wrong quietly, and a preview a few rows out from
  // the file is the kind of small lie this preview exists to avoid.
  const trimB64 = fs.readFileSync(trimPng).toString('base64');
  const trimCmp = await page.evaluate(async ([cellD, trimD]) => {
    const load = d => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + d; });
    const cell = await load(cellD), want = await load(trimD);
    // The page's own straightening of the same camera, then its trim.
    const src = document.createElement('canvas');
    src.width = cell.width; src.height = cell.height;
    src.getContext('2d').drawImage(cell, 0, 0);
    trim.top = 15; trim.bottom = 30;
    const flat = rectifyPreview(src, 512, 384);
    if (!flat) return { err: 'the page could not straighten the test camera' };
    const rows = trimRows(384);
    const got = trimmed(flat);
    if (!got) return { err: 'the page did not apply the trim at all' };
    if (got.width !== want.width || got.height !== want.height)
      return { err: `the page trims to ${got.width}x${got.height}, ffmpeg to ${want.width}x${want.height}`,
               rows };
    // Same size: now the same pixels.
    const a = document.createElement('canvas'); a.width = got.width; a.height = got.height;
    a.getContext('2d').drawImage(got, 0, 0);
    const b = document.createElement('canvas'); b.width = want.width; b.height = want.height;
    b.getContext('2d').drawImage(want, 0, 0);
    const pa = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
    const pb = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
    let sum = 0, n = 0;
    for (let i = 0; i < pa.length; i += 4) {
      sum += Math.abs(pa[i] - pb[i]) + Math.abs(pa[i+1] - pb[i+1]) + Math.abs(pa[i+2] - pb[i+2]);
      n += 3;
    }
    // And with NO trim set it must leave the frame alone rather than
    // cropping a nominal nothing off it.
    trim.top = 0; trim.bottom = 0;
    const none = trimmed(flat);
    return { mean: sum / n, w: got.width, h: got.height, rows, noneIsNull: none === null };
  }, [cellB64, trimB64]);

  if (trimCmp.err) fail(trimCmp.err + (trimCmp.rows ? ' (rows ' + JSON.stringify(trimCmp.rows) + ')' : ''));
  else {
    if (!(trimCmp.mean < 14))
      fail(`the trimmed preview differs from ffmpeg's by ${trimCmp.mean.toFixed(1)} per channel - `
         + 'the crop is landing somewhere else');
    if (trimCmp.h !== 212 || trimCmp.rows.y !== 56)
      fail(`the trim rounds to y=${trimCmp.rows.y} h=${trimCmp.h}, not the even y=56 h=212 the encoder needs`);
    if (!trimCmp.noneIsNull)
      fail('with no trim set the preview still crops the frame');
  }

  // ...and the figures reach the helper, but only with a straightened export.
  await setup(2);
  const sentTrim = await page.evaluate(async () => {
    window.__sent.length = 0;
    trim.top = 15; trim.bottom = 30;
    prefs.rectify = true; prefs.exportTrim = true;
    document.getElementById('splitThis').onclick();
    for (let i = 0; i < 60 && !document.getElementById('xpok'); i++)
      await new Promise(r => setTimeout(r, 25));
    const offered = !!document.getElementById('xptrim');
    document.getElementById('xpok').click();
    await new Promise(r => setTimeout(r, 300));
    const withRect = window.__sent.slice();
    return { offered, withRect };
  });
  if (!sentTrim.offered) fail('the question never offers to carry the trim into a straightened export');
  if (!sentTrim.withRect.length) fail('the straightened export did not start');
  else {
    if (!/[?&]trimtop=15\b/.test(sentTrim.withRect[0]) || !/[?&]trimbot=30\b/.test(sentTrim.withRect[0]))
      fail('the trim did not reach the helper: ' + sentTrim.withRect[0]);
  }

  // A plain split carries none of it: only the fisheye tool knows where to
  // apply a trim, and sending it to the other one would be meaningless.
  await setup(2);
  const plainTrim = await page.evaluate(async () => {
    window.__sent.length = 0;
    trim.top = 15; trim.bottom = 30;
    prefs.rectify = false; prefs.exportTrim = true;
    document.getElementById('splitThis').onclick();
    for (let i = 0; i < 60 && !document.getElementById('xpok'); i++)
      await new Promise(r => setTimeout(r, 25));
    const offered = !!document.getElementById('xptrim');
    document.getElementById('xpok').click();
    await new Promise(r => setTimeout(r, 300));
    return { offered, sent: window.__sent.slice() };
  });
  if (plainTrim.offered) fail('the trim is offered on a plain split, which cannot apply it');
  if (plainTrim.sent.length && /[?&]trimtop=/.test(plainTrim.sent[0]))
    fail('a plain split was sent a trim it cannot apply: ' + plainTrim.sent[0]);

  // --- the straightened, trimmed, stripped frame has no black band ------
  // The composed panel was sized to the UNTRIMMED height, so with a trim on
  // there was a band of black between the picture and the status strip -
  // black the file will not have, in the one panel whose whole job is to
  // show what the file will look like. Counted in pixels, because "it looks
  // right" is how it got there.
  await setup(2);
  const band = await page.evaluate(async () => {
    trim.top = 15; trim.bottom = 30;
    prefs.exportStrip = true; prefs.exportTrim = true;
    const p = confirmExport(segments[0], 2, 'rectify', 'x', true);
    await new Promise(r => setTimeout(r, 700));
    const img = document.querySelector('#msg .xpv');
    if (!img) { exportAsk && exportAsk(false); await p; return { err: 'no preview was drawn' }; }
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    // The longest run of rows that are black right the way across.
    let run = 0, worst = 0, at = -1;
    for (let y = 0; y < c.height; y++) {
      let dark = true;
      for (let x = 0; x < c.width && dark; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] > 10 || d[i+1] > 10 || d[i+2] > 10) dark = false;
      }
      if (dark) { run++; if (run > worst) { worst = run; at = y - run + 1; } }
      else run = 0;
    }
    exportAsk && exportAsk(false); await p;
    return { w: c.width, h: c.height, worst, at };
  });
  if (band.err) fail(band.err);
  else {
    // Measured, not guessed: the correct composition leaves 0 such rows and
    // the broken one left 171 of 408, so 24 is a threshold with room on both
    // sides - a few genuinely dark rows from the straightening would not trip
    // it, and a band could not slip under it.
    if (band.worst > 24)
      fail(`the preview has a ${band.worst}-row black band at y=${band.at} of ${band.h} - `
         + 'the picture and the status strip are not meeting');
  }

  // --- the time of day, drawn into the file -----------------------------
  // The player's clock is painted over the picture as it plays and never
  // leaves the player, so an exported clip opened anywhere else carried no
  // time at all. The tools burn it in; this question is where it is turned
  // on, and the preview has to SHOW it - a tick box that promises a stamp
  // and a frame without one is the kind of small lie this panel exists to
  // avoid. Counted in bright pixels rather than eyeballed, in the bottom
  // right quarter of the picture where both the tools and the preview put
  // it, on the blue camera so that white text has nothing to hide in.
  const stampPixels = () => page.evaluate(() => {
    const img = document.querySelector('#msg .xpv');
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0, lowest = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = (c.width / 2) | 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { n++; if (y > lowest) lowest = y; }
      }
    }
    return { n, lowest, w: c.width, h: c.height };
  });

  await setup(2);
  const clockOn = await page.evaluate(async () => {
    prefs.exportClock = true; prefs.exportStrip = true;
    const p = confirmExport(segments[0], 2, 'split', 'x', true);
    await new Promise(r => setTimeout(r, 400));
    const box = document.getElementById('xpclock');
    return { offered: !!box, ticked: !!(box && box.checked), pending: !!p };
  });
  if (!clockOn.offered) fail('the question never offers to draw the time onto the picture');
  if (!clockOn.ticked) fail('the clock box did not open ticked, though the setting says draw it');
  const withClock = await stampPixels();
  if (!withClock) fail('no preview to look for the stamp in');
  else if (withClock.n < 20)
    fail(`the preview shows no stamp with the clock on: ${withClock.n} bright pixels`);
  else if (withClock.lowest >= withClock.w)
    fail(`the stamp is at y=${withClock.lowest} of a ${withClock.w}px picture - it is on the `
       + 'status strip rather than above it');

  // Off again: the frame must change, and the request must say so.
  const clockOff = await page.evaluate(async () => {
    const box = document.getElementById('xpclock');
    if (!box) return { err: 'the clock box went away between redraws' };
    const before = (document.querySelector('#msg .xpv') || {}).src || '';
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    const after = (document.querySelector('#msg .xpv') || {}).src || '';
    return { changed: before !== after && !!before && !!after, remembered: prefs.exportClock };
  });
  if (clockOff.err) fail(clockOff.err);
  else {
    if (!clockOff.changed) fail('unticking the clock did not redraw the frame, so it still showed a stamp');
    if (clockOff.remembered !== false) fail('the clock answer was not remembered for the next export');
  }
  const without = await stampPixels();
  if (without && withClock && without.n >= withClock.n)
    fail(`unticking the clock left the stamp on the frame: ${without.n} bright pixels, was ${withClock.n}`);
  await page.evaluate(() => exportAsk && exportAsk(false));
  await page.waitForTimeout(100);

  // It survives the straightening, and lands after it: text put through the
  // lens correction would bend along with the picture, so the tools draw it
  // once the straightening is done and the preview has to do the same.
  await setup(2);
  await page.evaluate(async () => {
    prefs.exportClock = true; prefs.exportStrip = true;
    trim.top = 0; trim.bottom = 0;
    confirmExport(segments[0], 2, 'rectify', 'x', true);
    await new Promise(r => setTimeout(r, 900));
  });
  const rectToggle = await page.evaluate(async () => {
    const box = document.getElementById('xpclock');
    if (!box) return { err: 'the straightened question offers no clock box' };
    const before = (document.querySelector('#msg .xpv') || {}).src || '';
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    const after = (document.querySelector('#msg .xpv') || {}).src || '';
    exportAsk && exportAsk(false);
    return { changed: before !== after && !!before && !!after };
  });
  if (rectToggle.err) fail(rectToggle.err);
  else if (!rectToggle.changed)
    fail('the clock box changes nothing on a straightened preview, so it shows a frame the file will not have');

  // And the stamp itself, measured on a canvas rather than on the panel's
  // JPEG: the straightened preview is drawn 512 across to stand for a 1280
  // file, which leaves the stamp a few pixels tall and smeared by the
  // encoding - too faint to count honestly there, and perfectly clear here.
  const drawn = await page.evaluate(() => {
    const cv = document.createElement('canvas');
    cv.width = 1280; cv.height = 960;
    const c = cv.getContext('2d');
    c.fillStyle = '#808080'; c.fillRect(0, 0, cv.width, cv.height);
    stampClock(cv, 960, Date.UTC(2026, 9, 14, 1, 3, 8));
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    const xs = [], ys = [];
    for (let y = 0; y < cv.height; y++)
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) { xs.push(x); ys.push(y); }
      }
    return { n: xs.length, xmax: Math.max(...xs, -1), ymax: Math.max(...ys, -1),
             ymin: Math.min(...ys, 1e9), w: cv.width, h: cv.height };
  });
  if (drawn.n < 40) fail(`the stamp draws almost nothing: ${drawn.n} bright pixels`);
  else if (drawn.xmax < drawn.w * 0.9 || drawn.ymax < drawn.h * 0.9 || drawn.ymin < drawn.h * 0.8)
    fail(`the stamp is at x<=${drawn.xmax} y=${drawn.ymin}-${drawn.ymax} of ${drawn.w}x${drawn.h}, `
       + 'not tucked into the bottom right the way the tools draw it');
  await page.waitForTimeout(100);

  // The instant that reaches the helper is the start of what it will write,
  // in whole seconds - and with a clip marked, the start of the CLIP. Getting
  // that wrong does not fail anything: it writes a clip stamped with a time
  // it was not recorded at, which is worse than no stamp at all.
  await setup(2);
  const sentClock = await page.evaluate(async () => {
    window.__sent.length = 0;
    prefs.exportClock = true; prefs.rectify = false;
    segments[0].start = Date.UTC(2026, 9, 14, 1, 3, 8);
    clip.in = 25; clip.out = 40;
    document.getElementById('splitThis').onclick();
    for (let i = 0; i < 60 && !document.getElementById('xpok'); i++)
      await new Promise(r => setTimeout(r, 25));
    document.getElementById('xpok').click();
    await new Promise(r => setTimeout(r, 300));
    return window.__sent.slice();
  });
  if (!sentClock.length) fail('the export did not start with the clock on');
  else {
    const m = /[?&]clock=(\d+)\b/.exec(sentClock[0]);
    if (!m) fail('the request carries no time for the tool to stamp: ' + sentClock[0]);
    else {
      const want = Math.floor((Date.UTC(2026, 9, 14, 1, 3, 8) + 25000) / 1000);
      if (Math.abs(+m[1] - want) > 1)
        fail(`the clip would be stamped ${new Date(+m[1] * 1000).toISOString()}, `
           + `not ${new Date(want * 1000).toISOString()} when it was recorded`);
    }
  }

  // With it off, nothing is sent - the tools take the absence as "no clock",
  // so sending a time and meaning not to draw it would draw it anyway.
  await setup(2);
  const noClock = await page.evaluate(async () => {
    window.__sent.length = 0;
    prefs.exportClock = false;
    document.getElementById('splitThis').onclick();
    for (let i = 0; i < 60 && !document.getElementById('xpok'); i++)
      await new Promise(r => setTimeout(r, 25));
    document.getElementById('xpok').click();
    await new Promise(r => setTimeout(r, 300));
    return window.__sent.slice();
  });
  if (noClock.length && /[?&]clock=/.test(noClock[0]))
    fail('the time was sent even with the box unticked: ' + noClock[0]);

  // A time lapse gets no clock at all. ffmpeg adds each frame's own timestamp
  // to the instant it is given, which runs at the video's rate - so on a
  // recording whose wall clock advances faster than it plays the stamp would
  // drift further from the truth every second. There is no way to tell ffmpeg
  // otherwise, and a stamp that is quietly wrong is worse than none.
  await setup(2);
  const lapse = await page.evaluate(async () => {
    window.__sent.length = 0;
    prefs.exportClock = true;
    segments[0].sidecar = { timeLapseMultiplier: 30 };
    const p = confirmExport(segments[0], 2, 'split', 'x', true);
    await new Promise(r => setTimeout(r, 400));
    const offered = !!document.getElementById('xpclock');
    document.getElementById('xpok').click();
    const answer = await p;
    return { offered, clock: answer && answer.clock };
  });
  if (lapse.offered) fail('a time lapse is offered a clock that would drift away from the truth');
  if (lapse.clock) fail('a time lapse would be stamped anyway: ' + lapse.clock);

  if (errs.length) fail('page errors: ' + errs.join('; '));
  await browser.close(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('the export is previewed as the tool will write it, and nothing runs until you say so');
  process.exit(0);
})();
