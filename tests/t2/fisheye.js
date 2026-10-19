// Keeping the fisheye.
//
// The lens correction is a way of LOOKING at a recording, not a property of
// it, and straightening pushes what the camera saw at the very edges out of
// frame. So there has to be a way back to the picture as the lens made it -
// one tick, in the row you are already looking at, not a slider in a panel
// that then has to be dragged back to where it was.
//
// What this holds:
//   1. the box is in the view row, and carries a tooltip like every other
//      control (tooltips.js enforces that separately, in aggregate);
//   2. ticking it really does turn the correction off - checked through
//      lensOn(), which is the single gate the draw path consults, rather
//      than through anything this test invents;
//   3. the choice is remembered, because a view setting that resets itself
//      every time a file is opened is worse than no setting;
//   4. the Lens slider is disabled while it is ticked. The panel already
//      dims trim/lens/strip in whole-frame mode precisely so that a control
//      which cannot act does not sit there looking as if it should, and a
//      slider that moves and changes nothing would reintroduce that fault;
//   5. a straightened clip gets no box at all - there is no fisheye left in
//      it to keep, and flat.js separately requires that row to be empty.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
const fs = require('fs');
const { JSDOM } = require(process.env.NM + '/jsdom');
const raw = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const V = (raw.match(/DCP_VERSION="([0-9.]+)"/) || [])[1];
const html = raw.replace('__DCP_TOKEN__', 'a'.repeat(64)).replace('__DCP_SRVVER__', V);
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub';
    w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined;
    w.requestAnimationFrame = cb => setTimeout(cb, 0);
  } });
const w = dom.window;
w.onerror = () => {};

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };
const ok = m => console.log('  ok   ' + m);

const FOUR_LANES = `
  segments.length=0;
  const lanes=[{lane:1,x0:0,y0:0,x1:1280,y1:1280,displayOrder:1},
               {lane:2,x0:1280,y0:0,x1:2560,y1:1280,displayOrder:2},
               {lane:3,x0:0,y0:1280,x1:1280,y1:2560,displayOrder:3},
               {lane:4,x0:1280,y0:1280,x1:2560,y1:2560,displayOrder:4}];
  segments.push({name:'x.mp4',file:{name:'x.mp4',relPath:'x.mp4',size:10},session:'s',
    start:1,status:'ok',view:null,missing:false,meta:null,manifest:null,asset:null,
    sidecar:{laneLayout:{lanes},actualTrack:{durationMs:1000},recordingSessionId:'s'}});
  current=0;
`;

setTimeout(() => {
  // 1. It exists, in the view row, with a tooltip.
  const built = w.eval(`(function(){
    ${FOUR_LANES}
    lens=freshLens();                 // the shipped default, k=0.36
    prefs.keepFisheye=false;
    buildLaneButtons(segments[0]);
    const cb=document.querySelector('#viewToggles input#keepFisheye');
    return { there:!!cb,
             tip:cb?(cb.getAttribute('title')||
                     (cb.parentElement&&cb.parentElement.getAttribute('title'))||''):'',
             text:cb&&cb.parentElement?cb.parentElement.textContent.trim():'',
             checked:cb?cb.checked:null,
             lensOnByDefault:lensOn() };
  })()`);

  if (!built.there) fail('there is no fisheye box in the view row');
  else if (!built.tip) fail('the fisheye box has no tooltip');
  else if (!/fisheye/i.test(built.text)) fail(`the box is not labelled for what it does ("${built.text}")`);
  else ok(`the view row has a "${built.text}" box, with a tooltip`);

  if (built.checked !== false) fail('the box does not start unticked - straightening is the default');
  else if (!built.lensOnByDefault) fail('the correction is off before anything is ticked');
  else ok('it starts unticked, with the correction on as before');

  // Without the box there is nothing left to exercise; say so plainly rather
  // than throwing on a null and burying the reason in a stack trace.
  if (!built.there) {
    console.log(`\n${bad} FAIL`);
    process.exit(1);
  }

  // 2 and 3. Ticking turns the correction off, and is remembered.
  const ticked = w.eval(`(function(){
    const cb=document.querySelector('#viewToggles input#keepFisheye');
    cb.checked=true; cb.onchange();
    let stored=null;
    try{ stored=JSON.parse(localStorage.getItem('lanePlayerSettings')||'null'); }catch{}
    return { strength:lensKNow(), pref:prefs.keepFisheye,
             stored:stored?stored.keepFisheye:undefined,
             kDisabled:!!document.getElementById('lensK').disabled,
             zoomDisabled:!!document.getElementById('lensZoom').disabled,
             boxDimmed:document.getElementById('lensBox').classList.contains('spent'),
             // Zoom must still reach the draw path, which consults lensOn().
             onWithZoom:(function(){ const was=lens.zoom; lens.zoom=1.4;
               const r=lensOn(); lens.zoom=was; return r; })(),
             onWithoutZoom:(function(){ const was=lens.zoom; lens.zoom=1;
               const r=lensOn(); lens.zoom=was; return r; })() };
  })()`);

  if (ticked.strength > 0.001)
    fail(`ticking the box leaves straightening in force (k=${ticked.strength})`);
  else ok('ticking it turns the straightening off');

  if (ticked.pref !== true || ticked.stored !== true)
    fail(`the choice is not remembered (prefs=${ticked.pref}, stored=${ticked.stored})`);
  else ok('the choice is remembered across sessions');

  // 4. Zoom is a separate thing from straightening and must survive.
  if (!ticked.onWithZoom)
    fail('zoom no longer reaches the picture while the fisheye is kept');
  else if (ticked.onWithoutZoom)
    fail('the correction path still runs with nothing to do - straightening off '
       + 'and zoom at 1 should leave the frame untouched');
  else ok('zoom still applies while the fisheye is kept');

  // 5. The strength slider cannot act, so it must not look as though it can -
  //    but the zoom beside it can, so the group must NOT be dimmed wholesale.
  if (!ticked.kDisabled)
    fail('the strength slider is still live while the fisheye is kept, so it '
       + 'moves and nothing happens');
  else if (ticked.zoomDisabled || ticked.boxDimmed)
    fail('the whole lens group is dimmed, which says zoom has stopped working '
       + `too (zoomDisabled=${ticked.zoomDisabled}, boxDimmed=${ticked.boxDimmed})`);
  else ok('the strength slider is disabled, the zoom beside it left alone');

  // And unticking puts everything back.
  const back = w.eval(`(function(){
    const cb=document.querySelector('#viewToggles input#keepFisheye');
    cb.checked=false; cb.onchange();
    return { strength:lensKNow(), kDisabled:!!document.getElementById('lensK').disabled };
  })()`);
  if (!(back.strength > 0.001) || back.kDisabled)
    fail('unticking does not restore the straightening and its slider');
  else ok('unticking restores the straightening, at the strength it had');

  // 5. Nothing to keep in a clip that is already straight.
  const flat = w.eval(`(function(){
    segments.length=0;
    // flat is a property ingest sets, not something derived from the name
    // here - a fixture named _rectified but left unflagged is simply an
    // ordinary recording, and would prove nothing.
    segments.push({name:'x_rectified.mp4',flat:true,
      file:{name:'x_rectified.mp4',relPath:'x_rectified.mp4',size:10},
      session:'s',start:1,status:'ok',view:null,missing:false,meta:null,
      manifest:null,asset:null,sidecar:null});
    current=0;
    buildLaneButtons(segments[0]);
    return document.querySelectorAll('#viewToggles input').length;
  })()`);
  if (flat !== 0) fail('a straightened clip is offered a fisheye box it cannot use');
  else ok('a straightened clip is offered no fisheye box');

  console.log(bad ? `\n${bad} FAIL` : '\nthe fisheye can be kept, and the slider says so');
  process.exit(bad ? 1 : 0);
}, 600);
