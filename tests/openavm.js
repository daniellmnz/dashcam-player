// The recorder that encodes a tall frame as columns.
//
// OpenAVM 5.1 stacks its four cameras in one 1280-wide strip, 5140 tall, and
// then - presumably because no encoder will take a picture that tall - cuts
// the strip into three 1728-row chunks and lays them side by side. What is in
// the file is 3840x1728. What the sidecar describes is still the tall picture,
// which is the right way round: that is what was recorded.
//
// The consequence is that a camera is no longer a rectangle in the file. Only
// the first survives whole, in the top of the first column; the second is 440
// rows at the bottom of column one and 840 at the top of column two, and so on
// down. The player used to crop each lane straight out of the frame, so three
// of the four pointed off the bottom of the picture and drew nothing at all.
//
// The numbers here are the ones out of a real recording's sidecar, not a tidy
// invention: the awkward part is that 3 x 1728 is 5184 and the picture is
// 5140, so the last column is 44 rows of padding that must not be copied back.
//
// A layout question about real pixels, so it is measured in a real browser
// against a file rastered the way the recorder rasters one.
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', 'src');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require(process.env.NM + '/playwright-core');

// Where that browser is. A clone of this repository has no browser at
// the path this was developed against - playwright-core deliberately
// downloads none - so the runner passes one in and this falls back for
// anyone running the file directly.
const CHROMIUM = process.env.DCP_CHROMIUM || '/opt/pw-browsers/chromium';
let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

// Straight from the sidecar of OpenAVM_1792103702641_..._S002.
const IW = 1280, IH = 5140, STRIP = 1728, EW = 3840, EH = 1728;
const LANES = [
  { lane: 1, x0: 0, x1: 1280, y0: 4,    y1: 1284, label: 'View 1', rotationDegrees: 0, displayOrder: 1 },
  { lane: 2, x0: 0, x1: 1280, y0: 1288, y1: 2568, label: 'View 2', rotationDegrees: 0, displayOrder: 2 },
  { lane: 3, x0: 0, x1: 1280, y0: 2572, y1: 3852, label: 'View 3', rotationDegrees: 0, displayOrder: 3 },
  { lane: 4, x0: 0, x1: 1280, y0: 3856, y1: 5136, label: 'View 4', rotationDegrees: 0, displayOrder: 4 }
];
// One colour per camera, and two bars at known heights inside each so that a
// lane landing a few rows out is caught as well as one landing in the wrong
// place entirely.
const COLS = [['red', [255, 0, 0]], ['green', [0, 128, 0]],
              ['blue', [0, 0, 255]], ['yellow', [255, 255, 0]]];
const BAR_WHITE = 200, BAR_BLACK = 1060, BAR_H = 20;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcp-avm-'));
const movie = path.join(tmp, 'rastered.webm');
try {
  // The tall picture, then the same picture cut into columns exactly as the
  // recorder cuts it - including the padding on the last one, which is the
  // part that is easy to get wrong in both directions.
  const inputs = ['-f', 'lavfi', '-i', `color=c=black:s=${IW}x${IH}:d=2:r=5`];
  COLS.forEach(([c], i) => {
    inputs.push('-f', 'lavfi', '-i',
      `color=c=${c}:s=${IW}x${LANES[i].y1 - LANES[i].y0}:d=2:r=5,`
      + `drawbox=0:${BAR_WHITE}:${IW}:${BAR_H}:white:t=fill,`
      + `drawbox=0:${BAR_BLACK}:${IW}:${BAR_H}:black:t=fill`);
  });
  const g = [];
  let last = '[0:v]';
  COLS.forEach((_, i) => {
    const out = (i === COLS.length - 1) ? '[tall]' : `[o${i}]`;
    g.push(`${last}[${i + 1}:v]overlay=0:${LANES[i].y0}${out}`);
    last = `[o${i}]`;
  });
  const cols = Math.ceil(IH / STRIP);
  g.push('[tall]split=' + cols + Array.from({ length: cols }, (_, i) => `[t${i}]`).join(''));
  for (let i = 0; i < cols; i++) {
    const y = i * STRIP, h = Math.min(STRIP, IH - y);
    g.push(`[t${i}]crop=${IW}:${h}:0:${y}`
      + (h < STRIP ? `,pad=${IW}:${STRIP}:0:0:black` : '') + `[c${i}]`);
  }
  g.push(Array.from({ length: cols }, (_, i) => `[c${i}]`).join('') + `hstack=inputs=${cols}[enc]`);
  execFileSync('ffmpeg', ['-v', 'error', '-y'].concat(inputs).concat([
    '-filter_complex', g.join(';'), '-map', '[enc]',
    '-c:v', 'libvpx', '-b:v', '8M', '-frames:v', '10', movie]), { stdio: 'pipe' });
} catch (e) {
  console.log('the rastered fixture could not be built: ' + (e.message || e).slice(0, 300));
  process.exit(2);
}

const PAGE = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = PAGE.match(/DCP_VERSION="([0-9.]+)"/)[1];
const BODY = PAGE.replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', VER);
const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ping') { res.writeHead(200); return res.end(); }
  if (u === '/version') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(VER); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(BODY);
}).listen(8916);

const near = (got, want) => got && got.every((v, i) => Math.abs(v - want[i]) < 70);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM,
                                          args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));
  await page.goto('http://localhost:8916/');
  await page.waitForTimeout(350);

  const b64 = fs.readFileSync(movie).toString('base64');
  const loaded = await page.evaluate(async ([d, lanes, raster]) => {
    const v = document.querySelector('video');
    const bin = Uint8Array.from(atob(d), c => c.charCodeAt(0));
    v.src = URL.createObjectURL(new Blob([bin], { type: 'video/webm' }));
    await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 6000); });
    v.currentTime = 0.4;
    await new Promise(r => { v.onseeked = r; setTimeout(r, 2500); });
    segments.length = 0;
    segments.push({ name: 'OpenAVM_1792103702641_abc_S002.mp4', status: 'ok',
      start: 1792103702506, session: 's', view: null, missing: false, flat: false,
      seconds: 2, sidecar: { recordingSessionId: 'x', startedAtEpochMs: 1792103702506,
        actualTrack: { width: raster.encodedWidth, height: raster.encodedHeight, durationMs: 2000 },
        laneLayout: { originalWidth: raster.inputWidth, originalHeight: raster.inputHeight,
                      layoutType: 'VERTICAL_1X4', lanes },
        rasterLayout: raster },
      file: { size: 1e6, relPath: 'Download/OpenAVM/x.mp4', name: 'x.mp4' } });
    current = 0;
    window.__lanes = lanes;
    // The canvas is only shown when a recording is opened through the list,
    // and draw() paints nothing while it is hidden - so a test that drove
    // draw() directly would read a blank canvas and blame the geometry.
    document.getElementById('canvas').hidden = false;
    // Trim, the lens correction, the status strip and the clock are all ways
    // of LOOKING at a recording, and every one of them moves or marks what is
    // drawn - the lens bends a straight line into a curve, which is exactly
    // the sort of thing that would be read here as a lane landing crooked.
    // What is under test is where the picture comes from in the FILE, so they
    // are turned off and left to the tests that are about them.
    prefs.statusBar = false;
    trim.top = 0; trim.bottom = 0;
    lens.k = 0; lens.zoom = 1;
    document.getElementById('burnTime').checked = false;
    return { w: v.videoWidth, h: v.videoHeight };
  }, [b64, LANES, { version: 1, layout: 'OPENAVM_VERTICAL_STRIPS_TO_COLUMNS',
                    coordinateOrigin: 'TOP_LEFT', inputWidth: IW, inputHeight: IH,
                    stripHeight: STRIP, encodedWidth: EW, encodedHeight: EH }]);
  if (loaded.w !== EW || loaded.h !== EH) {
    console.log(`the fixture did not decode as ${EW}x${EH}: ${JSON.stringify(loaded)}`);
    process.exit(2);
  }

  // What the player draws for one camera, read back as pixels.
  const laneShot = i => page.evaluate(i => {
    mode = { kind: 'lane', i };
    sizeCanvas(); draw();
    const c = document.getElementById('canvas');
    const g = c.getContext('2d');
    const at = (fx, fy) => {
      const p = g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data;
      return [p[0], p[1], p[2]];
    };
    return { w: c.width, h: c.height,
             mid: at(0.5, 0.5), topish: at(0.5, 0.08), lowish: at(0.5, 0.92),
             // The two bars, at the heights they were drawn at inside the lane.
             white: at(0.5, (200 + 10) / 1280), black: at(0.5, (1060 + 10) / 1280) };
  }, i);

  for (let i = 0; i < 4; i++) {
    const got = await laneShot(i);
    const [name, rgb] = COLS[i];
    if (!near(got.mid, rgb))
      fail(`camera ${i + 1} should be ${name}, the middle of it is rgb(${got.mid}) - `
         + 'the lane was taken from the wrong place in the frame');
    // Square, because every camera is 1280x1280 in the tall picture.
    if (Math.abs(got.w / got.h - 1) > 0.02)
      fail(`camera ${i + 1} is drawn ${got.w}x${got.h}, which is not the square it is`);
    // Both ends of the lane are the lane, so none of a neighbour has come with
    // it and none of the lane has been left behind.
    if (!near(got.topish, rgb)) fail(`camera ${i + 1} has rgb(${got.topish}) near its top, not ${name}`);
    if (!near(got.lowish, rgb)) fail(`camera ${i + 1} has rgb(${got.lowish}) near its bottom, not ${name}`);
    // And the bars land where they were drawn, which pins the alignment to
    // within a few rows - the seam between two columns falls inside three of
    // these four cameras, and a join a few rows out would pass every test
    // above while shifting the picture.
    if (!near(got.white, [255, 255, 255]))
      fail(`camera ${i + 1}: the marker 200 rows down is rgb(${got.white}), not white - `
         + 'the lane is drawn out of alignment');
    if (!near(got.black, [0, 0, 0]))
      fail(`camera ${i + 1}: the marker 1060 rows down is rgb(${got.black}), not black`);
  }

  // The whole frame is the TALL picture, not the three columns it travels as -
  // and it is FOLDED, because a 1280x5140 ribbon down the middle of the stage
  // wastes the width of the window and leaves every camera too small to see.
  // Four equal bands, laid out the way the grid lays out cameras.
  const whole = await page.evaluate(() => {
    mode = { kind: 'all' };
    sizeCanvas(); draw();
    const c = document.getElementById('canvas');
    const g = c.getContext('2d');
    const at = (fx, fy) => {
      const p = g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data;
      return [p[0], p[1], p[2]];
    };
    return { w: c.width, h: c.height, lanes: activeLanes(segments[0]).length,
             tl: at(0.25, 0.25), tr: at(0.75, 0.25),
             bl: at(0.25, 0.75), br: at(0.75, 0.75) };
  });
  if (Math.abs(whole.w / whole.h - 1) > 0.1)
    fail(`the whole frame is drawn ${whole.w}x${whole.h}, which is not the square it folds to`);
  if (whole.lanes !== 4)
    fail(`the whole frame is ${whole.lanes} piece(s), not the four bands it folds into`);
  // In the order the grid uses, so the same camera is not in one place under
  // one button and somewhere else under the next.
  [['top left', whole.tl, 0], ['top right', whole.tr, 1],
   ['bottom left', whole.bl, 2], ['bottom right', whole.br, 3]].forEach(([where, got, i]) => {
    if (!near(got, COLS[i][1]))
      fail(`the folded whole frame has rgb(${got}) at its ${where}, not the `
         + `${COLS[i][0]} of camera ${i + 1}`);
  });

  // Folded without losing a row of it: that is what tells this view apart
  // from the grid, which shows the cameras and not the gaps between them.
  const bands = await page.evaluate(() => wholeBands(1280, 5140, 4));
  if (bands[0].y0 !== 0) fail('the fold starts below the top of the picture');
  if (bands[bands.length - 1].y1 !== 5140)
    fail(`the fold ends at ${bands[bands.length - 1].y1}, not the bottom of the picture`);
  for (let i = 1; i < bands.length; i++)
    if (bands[i].y0 !== bands[i - 1].y1)
      fail(`the fold leaves a gap or an overlap at band ${i}: `
         + `${bands[i - 1].y1} then ${bands[i].y0}`);

  // A frame that is already about as wide as it is tall is left alone. The
  // other recorder's 2560x2660 is a 2x2 grid with a status strip under it, and
  // folding that would be rearranging a picture that is already square.
  const square = await page.evaluate(() => wholeBands(2560, 2660, 4).length);
  if (square !== 1) fail(`a frame that is already square was folded into ${square} pieces`);

  // The geometry everything else hangs off reports the TALL picture. The
  // lanes come straight out of the sidecar, so this one is asked directly:
  // it is what the status strip and the clock are placed against, and those
  // would be put somewhere else entirely if it answered with the columns.
  const dims = await page.evaluate(() => frameDims(segments[0]));
  if (!dims || dims.w !== IW || dims.h !== IH)
    fail(`the frame is reported as ${dims && dims.w}x${dims && dims.h}, not the `
       + `${IW}x${IH} picture that was recorded - the strip and the clock would `
       + 'be placed against the columns');

  // A sidecar that describes a layout the file does not have must not be
  // believed: taking a picture apart on the strength of a claim that does not
  // match it would wreck a perfectly good frame.
  const mismatch = await page.evaluate(() => {
    segments[0].sidecar.rasterLayout = { version: 1,
      layout: 'OPENAVM_VERTICAL_STRIPS_TO_COLUMNS', inputWidth: 640, inputHeight: 2560,
      stripHeight: 1280, encodedWidth: 1280, encodedHeight: 1280 };
    mode = { kind: 'all' };
    sizeCanvas(); draw();
    // Asked of the geometry rather than of the canvas: the canvas is folded
    // to fit the stage now, so its shape no longer says which picture it is
    // showing - it comes out roughly square either way.
    return frameDims(segments[0]);
  });
  // It falls back to the file as it stands.
  if (!mismatch || mismatch.w !== EW || mismatch.h !== EH)
    fail(`a raster layout that does not match the file was applied anyway: the frame `
       + `is reported as ${mismatch && mismatch.w}x${mismatch && mismatch.h}, not the `
       + `${EW}x${EH} the file actually is`);

  // A layout that does not describe itself is refused as well. This one's
  // encoded width matches the file, so the file cannot catch it: three
  // columns of 1000 do not make 3840, and following it would slice the
  // picture at the wrong places and leave the result looking plausible.
  const incoherent = await page.evaluate(() => {
    segments[0].sidecar.rasterLayout = { version: 1,
      layout: 'OPENAVM_VERTICAL_STRIPS_TO_COLUMNS', inputWidth: 1000, inputHeight: 5140,
      stripHeight: 1728, encodedWidth: 3840, encodedHeight: 1728 };
    return frameDims(segments[0]);
  });
  if (!incoherent || incoherent.w !== EW || incoherent.h !== EH)
    fail('a raster layout whose own figures do not add up was followed anyway: the frame '
       + `is reported as ${incoherent && incoherent.w}x${incoherent && incoherent.h}`);

  // And a recording with no raster layout at all is untouched - every other
  // recorder, and every file this player has written itself.
  const plain = await page.evaluate(() => {
    delete segments[0].sidecar.rasterLayout;
    segments[0].sidecar.laneLayout = { originalWidth: 3840, originalHeight: 1728,
      lanes: [{ lane: 1, x0: 0, x1: 1280, y0: 0, y1: 1280, label: 'One', displayOrder: 1 }] };
    segments[0].sidecar.actualTrack = { width: 3840, height: 1728, durationMs: 2000 };
    mode = { kind: 'lane', i: 0 };
    sizeCanvas(); draw();
    const c = document.getElementById('canvas');
    const p = c.getContext('2d').getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.5), 1, 1).data;
    return [p[0], p[1], p[2]];
  });
  // That rectangle is the top-left of the ENCODED frame, which is camera one.
  if (!near(plain, COLS[0][1]))
    fail(`without a raster layout the frame is still being rearranged: rgb(${plain})`);

  // --- what the export tools are sent ----------------------------------
  // The tools cannot read a sidecar and there is nothing in this frame's
  // shape to work a camera out from, so the rectangles go with the request.
  // Each camera as ffmpeg's crop takes it - w:h:x:y - with the pieces of one
  // camera joined by commas. The two that straddle a column join have two.
  await page.evaluate(() => {
    delete segments[0].sidecar.rasterLayout;
    segments[0].sidecar.rasterLayout = { version: 1,
      layout: 'OPENAVM_VERTICAL_STRIPS_TO_COLUMNS', inputWidth: 1280,
      inputHeight: 5140, stripHeight: 1728, encodedWidth: 3840, encodedHeight: 1728 };
    segments[0].sidecar.laneLayout = { originalWidth: 1280, originalHeight: 5140,
      layoutType: 'VERTICAL_1X4', lanes: window.__lanes };
  });
  const wire = await page.evaluate(() => {
    const g = exportGeom(segments[0]);
    return g ? { lanes: lanesStr(g), strip: g.strip ? pieceStr(g.strip) : null,
                 count: g.lanes.length } : null;
  });
  if (!wire) fail('nothing is sent to the tools for a recording they cannot work out');
  else {
    const want = '1280:1280:0:4;1280:440:0:1288,1280:840:1280:0;'
               + '1280:884:1280:844,1280:396:2560:0;1280:1280:2560:400';
    if (wire.lanes !== want)
      fail('the cameras are not where the file actually holds them:\n     got  '
         + wire.lanes + '\n     want ' + want);
    if (wire.count !== 4) fail(`${wire.count} cameras are described, not four`);
    // This recorder leaves no room for a status strip - the cameras fill the
    // picture bar four rows - so claiming one would stack a sliver of nothing
    // under every export.
    if (wire.strip) fail('a status strip was described for a recording with none: ' + wire.strip);
  }

  // Whatever the sidecar says, what is sent is even. The tools write yuv420p,
  // which has half-resolution colour and will not take an odd width or height
  // - and an odd OFFSET would shift the colour against the picture. A
  // recorder that described its cameras on odd pixels would otherwise have
  // every export refused by the encoder, after the work was done.
  const odd = await page.evaluate(() => {
    const l = window.__lanes.map(x => Object.assign({}, x));
    l[0] = Object.assign({}, l[0], { x0: 1, y0: 5, x1: 1279, y1: 1283 });
    segments[0].sidecar.laneLayout = Object.assign({}, segments[0].sidecar.laneLayout, { lanes: l });
    const g = exportGeom(segments[0]);
    segments[0].sidecar.laneLayout = Object.assign({}, segments[0].sidecar.laneLayout,
                                                   { lanes: window.__lanes });
    return g ? lanesStr(g) : null;
  });
  if (!odd) fail('a camera on odd pixels is not described at all');
  else {
    const nums = odd.split(';')[0].split(',')[0].split(':').map(Number);
    if (nums.some(n => n % 2))
      fail('a camera on odd pixels is sent as it stands, which the encoder will refuse: '
         + odd.split(';')[0]);
  }

  // And the preview is drawn from the same rectangles, not from the frame's
  // shape: the tools and the picture shown before they run have to agree.
  const pv = await page.evaluate(() => {
    const cv = document.createElement('canvas');
    const cut = drawExportPreview(cv, segments[0], 1, false);
    if (!cut) return { err: 'no preview was drawn' };
    const g = cv.getContext('2d');
    const p = g.getImageData(Math.round(cv.width / 2), Math.round(cv.height / 2), 1, 1).data;
    return { w: cv.width, h: cv.height, mid: [p[0], p[1], p[2]] };
  });
  if (pv.err) fail(pv.err);
  else {
    if (pv.w !== 1280 || pv.h !== 1280)
      fail(`the export preview is ${pv.w}x${pv.h}, not the 1280x1280 camera the tool will write`);
    if (!near(pv.mid, COLS[1][1]))
      fail(`the export preview shows rgb(${pv.mid}), not the ${COLS[1][0]} of camera 2`);
  }

  if (errs.length) fail('page errors: ' + errs.join('; '));
  await browser.close(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('a frame encoded as columns is put back together, and one that is not is left alone');
  process.exit(0);
})();
