// The sentry alert's still: which camera it shows, and nothing that lies.
//
// Two things are checked. The still is labelled with its camera, the way the
// grid view labels each pane - but ONLY when something actually says which
// camera it is. The recorder names the alert folder and everything in it
// after the recording ("..._alert_360"), which says the clip holds all four
// cameras and says nothing about the one the still was taken from. What does
// say is the "az" field in info_inner.txt - the recorder's own camera
// numbering, which is NOT the order the grid uses - and, on files the export
// tools wrote, a camera word on the end of the name. A label naming the wrong
// camera is worse than no label, so anything that says nothing gets nothing,
// and that is asserted rather than left to chance.
//
// And the panel no longer carries a "Click to enlarge" caption. It was
// reported as doing nothing; a caption that invites a click and does not pay
// out is the part that had to go whatever the cause.
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
    // A 2D context that does nothing but exists. Pressing the jump button
    // now switches the view, which sizes and draws the canvas - with a null
    // context that throws inside the page rather than failing the assertion,
    // which looks like the feature is broken when it is the stub that is.
    w.HTMLCanvasElement.prototype.getContext = () => ({
      canvas: { width: 1280, height: 960 },
      fillText() {}, measureText: () => ({ width: 10 }), drawImage() {},
      fillRect() {}, clearRect() {}, save() {}, restore() {}, translate() {},
      rotate() {}, scale() {}, beginPath() {}, closePath() {}, moveTo() {},
      lineTo() {}, stroke() {}, fill() {}, setTransform() {},
      set font(v) {}, set fillStyle(v) {}, set textBaseline(v) {},
      set strokeStyle(v) {}, set lineWidth(v) {},
      set imageSmoothingQuality(v) {}, set imageSmoothingEnabled(v) {} });
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    // jsdom's play() returns undefined; every browser this runs in returns a
    // promise, which the page attaches a catch to. Stubbed rather than
    // defended against in the page, because the page is right.
    w.HTMLMediaElement.prototype.play = () => Promise.resolve();
    w.HTMLMediaElement.prototype.load = () => {};
    w.indexedDB = undefined;
  } });
const w = dom.window; w.onerror = () => {};

// Build the alert card for a sentry segment and report what it shows.
const show = (stillName, meta) => JSON.parse(w.eval(`(function(){
  segments.length=0;
  segments.push({ name:'a_alert_360.mp4', status:'ok', start:Date.now(), session:'Sentry alerts',
    view:null, missing:false, flat:false, sidecar:null, seconds:60, sentry:true,
    meta:${JSON.stringify(meta || { t: '2026-10-10_10_56_19', d: [63432] })},
    still:${stillName ? `{name:${JSON.stringify(stillName)},size:10}` : 'null'},
    stillUrl:null,
    file:{ size:10, relPath:'Sentry/a_alert_360/a_alert_360.mp4', name:'a_alert_360.mp4' } });
  current=0;
  renderFacts(segments[0]);
  const box=document.getElementById('facts');
  const tag=box.querySelector('.shotlabel');
  const img=box.querySelector('.alertshot img');
  return JSON.stringify({
    label: tag ? tag.textContent.trim() : null,
    alt: img ? (img.alt||'') : null,
    hasImg: !!img,
    text: box.textContent
  });
})()`));

setTimeout(() => {
  // --- the caption is gone ----------------------------------------------
  if (/click to enlarge/i.test(PAGE))
    fail('the "Click to enlarge" caption is still in the page');
  const plain = show('a_alert_360.jpg');
  if (!plain.hasImg) fail('the alert card no longer shows the still at all');
  if (/click to enlarge/i.test(plain.text))
    fail('the alert card still invites a click that does nothing: ' + plain.text);

  // --- a still that does not say which camera gets no label -------------
  // "_360" is the RECORDING's name, not a camera. Inventing one from it is
  // the failure this guards.
  if (plain.label !== null)
    fail(`a still that names no camera was labelled "${plain.label}" anyway`);

  // --- a still that does say, is labelled --------------------------------
  for (const [name, want] of [['a_alert_360_Front.jpg', 'Front'],
                              ['a_alert_360_rear.jpg', 'Rear'],
                              ['x_LEFT.jpeg', 'Left'],
                              ['a_alert_Right.jpg', 'Right']]) {
    const got = show(name);
    if (got.label !== want)
      fail(`${name} should be labelled ${want}, got ${JSON.stringify(got.label)}`);
    // The same word reaches anyone who cannot see the picture.
    if (!new RegExp(want, 'i').test(got.alt || ''))
      fail(`${name}: the camera is not in the image's alt text: ${JSON.stringify(got.alt)}`);
  }

  // A camera word must be a WORD, not a fragment of another one.
  const frag = show('a_alert_360_frontier.jpg');
  if (frag.label !== null)
    fail(`"frontier" was read as a camera name: ${JSON.stringify(frag.label)}`);

  // --- or when the alert's own details say ------------------------------
  if (show('a_alert_360.jpg', { t: 'x', camera: 'rear' }).label !== 'Rear')
    fail('a camera named in the alert details is ignored');
  if (show('a_alert_360.jpg', { t: 'x', view: 4 }).label !== 'Right')
    fail('a camera numbered in the alert details is ignored');
  // Out of range is not a camera.
  if (show('a_alert_360.jpg', { t: 'x', view: 9 }).label !== null)
    fail('a camera number outside 1-4 was turned into a label');
  // --- and the recorder's own "az", which is the usual case --------------
  // az is the camera the alert fired on. It is NOT the grid's numbering, and
  // the whole point of the table in the page is that the two differ - read
  // one as the other and every alert is labelled confidently and wrongly.
  //
  // All four observed on real alerts. 2 and 4 were briefly the other way
  // round, inferred from the pairing that looked natural - back/front, then
  // right/left - and that inference was simply wrong. The real order is
  // Rear, Left, Right, Front, which follows no pattern, so none of these
  // four is reasoned from the others and every one is pinned here.
  for (const [az, want, how] of [[1, 'Rear', 'observed'], [2, 'Left', 'observed'],
                                 [3, 'Right', 'observed'], [4, 'Front', 'observed']]) {
    const got = show('a_alert_360.jpg', { t: '2026-10-10_10_56_19', r: 3,
                                          l: '-41.288700,174.777200', d: [63432], az });
    if (got.label !== want)
      fail(`az:${az} should be ${want} (${how}), got ${JSON.stringify(got.label)}`);
  }
  // Nor the pairing that was tried and found wrong: back/front then
  // right/left, which would make 2 Front and 4 Left.
  if (show('a_alert_360.jpg', { t: 'x', az: 2 }).label === 'Front'
      || show('a_alert_360.jpg', { t: 'x', az: 4 }).label === 'Left')
    fail('the az table has drifted back to the pairing that was observed to be wrong');
  // It must not be read as the GRID's order, which is the mistake that looks
  // right: there, 3 would be Left rather than Right.
  if (show('a_alert_360.jpg', { t: 'x', az: 3 }).label === 'Left')
    fail('az is being read through the grid\'s numbering, so the camera is wrong');

  // "r" sits beside az in every alert and nobody here knows what it is. It
  // must not become a camera on its own.
  if (show('a_alert_360.jpg', { t: 'x', r: 2 }).label !== null)
    fail('"r" was read as a camera, and nothing says it is one');
  // Nor an az outside the four it knows.
  for (const az of [0, 5, 99]) {
    if (show('a_alert_360.jpg', { t: 'x', az }).label !== null)
      fail(`az:${az} is not a camera, but it was labelled`);
  }

  // --- Jump to the alert shows the camera it fired on --------------------
  // Arriving at the right second on the wrong camera is most of a wasted
  // jump. The lanes are ordered by the sidecar's displayOrder, so this is
  // deliberately tested against a layout whose order is NOT Front, Rear,
  // Left, Right: a lane index taken from the az table would land on the
  // wrong camera and look entirely plausible doing it.
  const jump = (az, lanes) => JSON.parse(w.eval(`(function(){
    Object.defineProperty(video,'videoWidth',{configurable:true,get:()=>2560});
    Object.defineProperty(video,'videoHeight',{configurable:true,get:()=>2660});
    Object.defineProperty(video,'duration',{configurable:true,get:()=>600});
    segments.length=0;
    segments.push({ name:'a_alert_360.mp4', status:'ok', start:Date.now(),
      session:'Sentry alerts', view:null, missing:false, flat:false, seconds:600,
      sentry:true, meta:{ t:'2026-10-10_10_56_19', d:[63432], az:${az} },
      still:{name:'a_alert_360.jpg',size:10}, stillUrl:null,
      sidecar:{ laneLayout:{ lanes:${JSON.stringify(lanes)} } },
      file:{ size:10, relPath:'Sentry/a/a_alert_360.mp4', name:'a_alert_360.mp4' } });
    current=0; mode={kind:'grid'};
    renderFacts(segments[0]);
    const btn=[...document.querySelectorAll('#facts button')]
      .find(b=>/jump to the alert/i.test(b.textContent));
    if(!btn) return JSON.stringify({err:'there is no Jump to the alert button'});
    btn.onclick();
    const ls=lanesOf(segments[0]);
    return JSON.stringify({
      kind: mode.kind,
      showing: mode.kind==='lane' ? String((ls[mode.i]||{}).label||'') : null,
      tip: btn.title
    });
  })()`));

  // A layout in an order of its own - right, front, rear, left - so nothing
  // can pass by coincidence of position.
  const ODD = [
    { lane: 4, displayOrder: 0, x0: 0,    y0: 0,    x1: 1280, y1: 1280 },
    { lane: 1, displayOrder: 1, x0: 1280, y0: 0,    x1: 2560, y1: 1280 },
    { lane: 2, displayOrder: 2, x0: 0,    y0: 1280, x1: 1280, y1: 2560 },
    { lane: 3, displayOrder: 3, x0: 1280, y0: 1280, x1: 2560, y1: 2560 }
  ];
  for (const [az, want] of [[1, 'Rear'], [2, 'Left'], [3, 'Right'], [4, 'Front']]) {
    const got = jump(az, ODD);
    if (got.err) { fail(got.err); break; }
    if (got.kind !== 'lane')
      fail(`az:${az}: the jump left the player in ${got.kind} rather than on one camera`);
    else if (got.showing !== want)
      fail(`az:${az}: the jump showed ${JSON.stringify(got.showing)}, wanted ${want}`);
    if (!new RegExp(want, 'i').test(got.tip || ''))
      fail(`az:${az}: the button does not say which camera it will show: ${JSON.stringify(got.tip)}`);
  }

  // An alert that does not say which camera must leave the view alone rather
  // than jumping to an arbitrary one.
  const quiet = JSON.parse(w.eval(`(function(){
    segments[0].meta={ t:'2026-10-10_10_56_19', d:[63432] };
    mode={kind:'grid'};
    renderFacts(segments[0]);
    const btn=[...document.querySelectorAll('#facts button')]
      .find(b=>/jump to the alert/i.test(b.textContent));
    btn.onclick();
    return JSON.stringify({ kind:mode.kind, tip:btn.title });
  })()`));
  if (quiet.kind !== 'grid')
    fail('an alert that names no camera still changed the view to ' + quiet.kind);
  if (/camera it fired on/i.test(quiet.tip || ''))
    fail('the button promises a camera the alert never named: ' + quiet.tip);

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('the sentry still names its camera, and the jump goes to that camera, never a guessed one');
  dom.window.close(); process.exit(0);
}, 500);
