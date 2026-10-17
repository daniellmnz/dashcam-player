// What the Settings panel offers, and what it admits it cannot do.
//
// On the whole frame there are no lanes: the picture is shown exactly as
// recorded, so trim crops nothing, the lens correction is skipped and there
// is no status strip to separate out. Those three controls moved and nothing
// happened, which reads as a fault in them rather than as a thing that does
// not apply. They are dimmed and disabled instead.
//
// The button must stay lit and must still open, because Folders, auto-play,
// the whole frame's own size and Reset settings sit in the same panel and
// apply whatever is on screen. Dimming the way in, or locking it, would be a
// worse bargain than the one it fixes, so both are checked too.
const fs = require('fs');
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

const PAGE = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = PAGE.match(/DCP_VERSION="([0-9.]+)"/)[1];
const dom = new JSDOM(PAGE.replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', VER), {
  runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    // A context that accepts everything: setMode resizes the canvas, and a
    // null context throws there before any of this can be looked at.
    w.HTMLCanvasElement.prototype.getContext = kind => kind === 'webgl' ? null : new Proxy({}, {
      get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined;
  } });
const w = dom.window; w.onerror = () => {};

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };
const id = x => w.document.getElementById(x);
const dim = x => { const el = id(x); return el ? el.classList.contains('spent') : null; };
const off = x => { const el = id(x); return el ? !!el.disabled : null; };

setTimeout(() => {
  if (!/>Settings</.test(PAGE)) fail('the button is not called Settings');
  if (/>Adjust image</.test(PAGE)) fail('the old Adjust image label is still on the page');

  w.eval(`
    Object.defineProperty(video,'videoWidth',{configurable:true,get:()=>2560});
    Object.defineProperty(video,'videoHeight',{configurable:true,get:()=>2660});
    segments.length=0;
    segments.push({name:'a.mp4',status:'ok',start:1,session:'s',view:null,missing:false,flat:false,
                   file:{size:10,relPath:'a.mp4',name:'a.mp4'},
                   sidecar:{laneLayout:{lanes:[0,1,2,3].map(n=>({lane:n,displayOrder:n,
                     x0:(n%2)*1280,y0:(n>1?1280:0),x1:(n%2)*1280+1280,y1:(n>1?2560:1280)}))}}});
    current=0;
  `);

  // One camera on screen: everything in there applies.
  w.eval(`setMode({kind:'lane',i:0})`);
  for (const [box, what] of [['trimBox', 'trim'], ['lensBox', 'lens']])
    if (dim(box)) fail(`${what} is dimmed while one camera is on screen`);
  for (const c of ['trimTop', 'trimBottom', 'lensK', 'lensZoom', 'statusBar'])
    if (off(c)) fail(`${c} is disabled while one camera is on screen`);
  if (dim2('adjust')) fail('the button is dimmed while everything in it applies');
  if (!id('adjustNote').hidden) fail('the panel says something does not apply when it all does');

  // The whole frame: trim, lens and the strip have nothing to act on.
  w.eval(`setMode({kind:'all'})`);
  for (const [box, what] of [['trimBox', 'trim'], ['lensBox', 'lens']])
    if (!dim(box)) fail(`${what} is not dimmed on the whole frame`);
  for (const c of ['trimTop', 'trimBottom', 'lensK', 'lensZoom', 'statusBar'])
    if (!off(c)) fail(`${c} can still be moved on the whole frame, and would do nothing`);
  // The button itself stays lit whatever is on screen. Most of what is
  // behind it - the folders, the tick boxes, the whole frame's own size,
  // Reset - applies in every view, so dimming the way in misreports the
  // panel as spent when it is still worth opening. Only the settings that
  // cannot act are dimmed.
  if (dim2('adjust'))
    fail('the button dims on the whole frame, where most of the panel still applies');
  if (id('adjustNote').hidden) fail('the panel does not say why those controls are dim');

  // ...but the settings that DO apply are still reachable. This is the part
  // worth guarding: dimming must not turn into locking away.
  const sum = id('adjust').querySelector('summary');
  if (sum.hasAttribute('disabled')) fail('the panel cannot be opened at all on the whole frame');
  w.eval(`document.getElementById('adjust').open=true`);
  for (const c of ['autoNext', 'burnTime', 'scanDirs', 'reset'])
    if (off(c)) fail(`${c} applies to the whole frame but was disabled with the rest`);

  // Back to one camera and it all comes back - a one-way dimming would be
  // worse than none.
  w.eval(`setMode({kind:'lane',i:0})`);
  for (const c of ['trimTop', 'lensK', 'statusBar'])
    if (off(c)) fail(`${c} stayed disabled after returning to one camera`);
  if (dim('trimBox') || dim('lensBox')) fail('the controls stayed dim after returning to one camera');

  // And a straightened recording still disables the lens on its own account,
  // which is a different reason for the same treatment.
  w.eval(`segments[0].flat=true; syncAdjust();`);
  if (!off('lensK')) fail('the lens is usable on an already straightened recording');
  if (off('trimTop')) fail('trim was disabled on a straightened recording, which it still applies to');

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('the settings dim when they cannot act, the button does not, and the rest stay reachable');
  dom.window.close(); process.exit(0);

  function dim2(x) {
    const el = id(x); if (!el) return null;
    const sum = el.querySelector('summary');
    return sum ? sum.classList.contains('spent') : null;
  }
}, 500);
