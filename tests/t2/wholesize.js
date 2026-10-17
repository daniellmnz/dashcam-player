// How large the whole frame is drawn.
//
// The whole frame is the tallest thing the player shows - all four cameras
// and the status strip stacked, 2560x2660 - and on some windows it took more
// room than there was. Two things are checked here.
//
// First, that the setting works: picking a smaller percentage draws a smaller
// picture, and in proportion.
//
// Second, and less obvious, that it costs nothing. It is a way of looking, in
// the same family as trim and zoom, which the player has always kept out of
// the file. So the canvas BUFFER must not shrink with it: shrink that and a
// snapshot taken at 50% comes out at half resolution, and the setting has
// quietly become a quality control. The buffer is asserted identical at both
// ends of the range.
//
// And it must apply to the whole frame alone, since that is the only view
// with the problem - a lane view must not move when it changes.
const fs = require('fs');
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

const PAGE = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = PAGE.match(/DCP_VERSION="([0-9.]+)"/)[1];

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

const dom = new JSDOM(PAGE.replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', VER), {
  runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext = () => ({
      canvas: { width: 1280, height: 960 },
      fillText() {}, measureText: () => ({ width: 10 }), drawImage() {},
      fillRect() {}, clearRect() {}, save() {}, restore() {}, translate() {},
      rotate() {}, scale() {}, beginPath() {}, closePath() {}, moveTo() {},
      lineTo() {}, stroke() {}, fill() {}, setTransform() {},
      set font(v) {}, set fillStyle(v) {}, set textBaseline(v) {},
      set imageSmoothingQuality(v) {}, set imageSmoothingEnabled(v) {} });
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined;
  } });
const w = dom.window; w.onerror = () => {};

const START = Date.UTC(2026, 9, 10, 1, 52, 46);
function mp4(name) {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(32, 0); buf.write('moov', 4);
  return { name, relPath: 'Movies/' + name, size: 4 * 1024 * 1024,
    slice: (a, b) => ({ arrayBuffer: async () => new Uint8Array(buf.subarray(a, b)).buffer }),
    text: async () => '' };
}

// Size the canvas for one view at one setting, and report both the size on
// screen and the size of the buffer behind it.
const sizedAt = (pct, kind) => JSON.parse(w.eval(`(function(){
  prefs.wholeScale=${pct};
  mode=${kind === 'all' ? "{kind:'all'}" : "{kind:'lane',i:0}"};
  current=segments.findIndex(s=>s.name==='20261010_135246_surround.mp4');
  sizeCanvas();
  return JSON.stringify({ css:canvas.style.width, cssH:canvas.style.height,
                          bufW:canvas.width, bufH:canvas.height });
})()`));
const px = v => parseFloat(String(v).replace('px', ''));

setTimeout(async () => {
  w.__files = [
    mp4('20261010_135246_surround.mp4'),
    { name: '20261010_135246_surround.json', relPath: 'Movies/20261010_135246_surround.json',
      size: 400, text: async () => JSON.stringify({ recordingSessionId: 'abc', segmentNumber: 1,
        startedAtEpochMs: START,
        actualTrack: { width: 2560, height: 2660, durationMs: 60000 } }) }
  ];
  await w.eval(`ingestInner(window.__files)`);
  w.eval(`
    Object.defineProperty(video,'videoWidth',{configurable:true,get:()=>2560});
    Object.defineProperty(video,'videoHeight',{configurable:true,get:()=>2660});
    Object.defineProperty(video,'readyState',{configurable:true,get:()=>4});
  `);

  // --- the menu offers what was asked for ---------------------------------
  const opts = [...w.document.querySelectorAll('#wholeScale option')].map(o => o.value);
  const want = ['100', '90', '80', '70', '60', '50'];
  if (String(opts) !== String(want))
    fail('the size menu is not 100% to 50% in tens: ' + JSON.stringify(opts));

  // --- the whole frame gets smaller, in proportion ------------------------
  const full = sizedAt(100, 'all');
  const half = sizedAt(50, 'all');
  if (!px(full.css)) {
    fail('the whole frame has no size on screen at all: ' + JSON.stringify(full));
  } else {
    const r = px(half.css) / px(full.css);
    if (Math.abs(r - 0.5) > 0.03)
      fail(`50% draws the picture at ${(r * 100).toFixed(0)}% of full size`);
    // Both dimensions, or the picture is squashed rather than scaled.
    const shape = n => px(n.cssH) / px(n.css);
    if (Math.abs(shape(half) - shape(full)) > 0.02)
      fail('the picture changes shape as it is scaled: ' + shape(full) + ' then ' + shape(half));
    // A step in between, so the setting is not simply on or off.
    const seventy = sizedAt(70, 'all');
    const r70 = px(seventy.css) / px(full.css);
    if (Math.abs(r70 - 0.7) > 0.03)
      fail(`70% draws the picture at ${(r70 * 100).toFixed(0)}% of full size`);
  }

  // --- and it costs nothing -----------------------------------------------
  if (full.bufW !== half.bufW || full.bufH !== half.bufH)
    fail(`the drawing buffer shrinks with the setting (${full.bufW}x${full.bufH} then `
       + `${half.bufW}x${half.bufH}), so a snapshot taken at 50% loses detail`);

  // --- a lane view is not its business ------------------------------------
  const laneFull = sizedAt(100, 'lane');
  const laneHalf = sizedAt(50, 'lane');
  if (laneFull.css !== laneHalf.css)
    fail(`the whole-frame setting resizes a lane view too: ${laneFull.css} then ${laneHalf.css}`);

  // --- a stored value the menu has no option for does not break it --------
  const silly = sizedAt(0, 'all');
  if (!px(silly.css)) fail('a stored size of 0 makes the picture vanish');
  if (px(silly.css) < px(half.css) - 0.5)
    fail('a stored size below the range is not held at the bottom of it: ' + silly.css);

  // --- the control is live in the whole frame and dim outside it ----------
  w.eval(`mode={kind:'all'};syncAdjust();`);
  if (w.document.getElementById('wholeScale').disabled)
    fail('the size control is disabled in the one view it applies to');
  if (/\bspent\b/.test(w.document.getElementById('wholeBox').className))
    fail('the size control is dimmed in the one view it applies to');
  w.eval(`mode={kind:'lane',i:0};syncAdjust();`);
  if (!w.document.getElementById('wholeScale').disabled)
    fail('the size control still takes a value in a lane view, where it does nothing');

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('the whole frame scales on screen, in proportion, without costing the buffer a pixel');
  dom.window.close(); process.exit(0);
}, 500);
