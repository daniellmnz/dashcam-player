// In and out points: marking part of a recording and writing only that.
//
// Driven through the SHIPPED page - the marks are set the way the buttons set
// them, and the request is read back from a stubbed fetch, so this checks what
// the tool would actually be told rather than a copy of the arithmetic.
const fs = require('fs');
// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

// The helper substitutes these as it serves the page. Left as placeholders
// the page decides its helper is too old to talk to and refuses to split.
const PAGE = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = PAGE.match(/DCP_VERSION="([0-9.]+)"/)[1];
const dom = new JSDOM(PAGE.replace('__DCP_TOKEN__', 'x'.repeat(64))
                          .replace('__DCP_SRVVER__', VER), {
  runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined; w.confirm = () => true;
  } });
const w = dom.window; w.onerror = () => {};

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };
const eq = (what, got, want) => { if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };

setTimeout(() => {
  // A 600-second recording with a settable playhead.
  w.eval(`
    let _t = 0, _d = 600;
    Object.defineProperty(video,'duration',{get:()=>_d,configurable:true});
    Object.defineProperty(video,'currentTime',
      {get:()=>_t,set:v=>{_t=v;},configurable:true});
    window.__seek = s => { _t = s; };
    // Through a setter, not by assigning _d from another eval: "let" inside
    // eval is scoped to that eval, so a later "_d = 600" would make a new
    // global and leave the real one at zero.
    window.__duration = d => { _d = d; };
    window.__noDuration = () => { _d = 0; };
    // A four-camera recording open, which is what makes a clip possible at
    // all: In and Out are hidden for a file that is already one camera,
    // because nothing could write that clip.
    const lanes = [1,2,3,4].map(n => ({ lane:n, displayOrder:n,
      x0:((n-1)%2)*1280, y0:(n>2?1280:0), x1:((n-1)%2)*1280+1280, y1:(n>2?2560:1280) }));
    window.__open = view => {
      segments.length = 0;
      segments.push({ name:'20261010_140247_surround.mp4', status:'ok', start:1, session:'s',
                      view: view || null,
                      file:{ size:1000, relPath:'DCIM/EVCam_Video/20261010_140247_surround.mp4' },
                      sidecar:{ laneLayout:{ lanes }, recordingSessionId:'s' } });
      current = 0; mode = { kind:'lane', i:0 }; dirHandle = { name:'EVCam_Video' };
      syncClip();
    };
    __open();
  `);

  const st = () => w.eval('JSON.stringify({inp:clip.in,out:clip.out,len:clipLen()})');
  const J = () => JSON.parse(st());

  // Nothing marked to begin with.
  eq('starts unmarked', J().len, 0);
  eq('the box is hidden', w.document.getElementById('clipBox').hidden, true);

  // One mark on its own must show. Pressing In and seeing nothing happen
  // looks like the button is broken.
  w.eval('__seek(30); setIn();');
  const el = id => w.document.getElementById(id);
  eq('in pointer shows', el('pinIn').hidden, false);
  eq('in pointer position', el('pinIn').style.left, (30 / 600 * 100) + '%');
  eq('out pointer stays hidden', el('pinOut').hidden, true);
  eq('no span with one mark', el('seekmark').hidden, true);
  eq('the box says what is missing', /set an out point/.test(el('clipText').textContent), true);
  // The label is "clip" whether or not a range is marked - what varies is
  // the tooltip, which has to say which, since nothing else does now.
  eq('button reads the same with nothing marked', el('splitThis').textContent, 'Export clip');
  eq('and says it will write the whole recording',
     /whole recording/i.test(el('splitThis').title), true);
  w.eval('clearClip();');
  eq('in pointer gone', el('pinIn').hidden, true);

  // In at 12, out at 90.
  w.eval('__seek(12); setIn(); __seek(90); setOut();');
  eq('in point', J().inp, 12);
  eq('out point', J().out, 90);
  eq('length', J().len, 78);
  eq('the box shows', w.document.getElementById('clipBox').hidden, false);
  if (!/0:12.*1:30.*78\.0s/.test(w.document.getElementById('clipText').textContent))
    fail('the readout does not name the range: ' + w.document.getElementById('clipText').textContent);

  // Both pointers, and the span between them, as fractions of the recording.
  eq('both pointers show', el('pinIn').hidden || el('pinOut').hidden, false);
  eq('out pointer position', el('pinOut').style.left, (90 / 600 * 100) + '%');
  const mark = w.document.getElementById('seekmark');
  eq('the strip shows', mark.hidden, false);
  eq('strip starts at 2%', mark.style.left, (12 / 600 * 100) + '%');
  eq('strip is 13% wide', mark.style.width, (78 / 600 * 100) + '%');

  // The button says which it will do.
  const b = w.document.getElementById('splitThis');
  eq('button still reads the same', b.textContent, 'Export clip');
  eq('and now names the marked stretch', /0:12\.5|0:12/.test(b.title), true);

  // An out point before the in point is not a clip. Setting out earlier
  // drops the in point rather than producing a negative length.
  w.eval('__seek(5); setOut();');
  if (J().len <= 0) fail('an earlier out point left a clip of ' + J().len);
  eq('in point moved to the start', J().inp, 0);
  eq('out point', J().out, 5);

  // And setting in after the out drops the out.
  w.eval('__seek(200); setIn();');
  eq('out cleared', J().out, null);
  eq('nothing to write yet', J().len, 0);
  eq('button unchanged after clearing', b.textContent, 'Export clip');
  eq('and back to the whole recording', /whole recording/i.test(b.title), true);

  // Clearing.
  w.eval('__seek(10); setIn(); __seek(20); setOut(); clearClip();');
  eq('cleared', J().len, 0);
  eq('the box is hidden again', w.document.getElementById('clipBox').hidden, true);
  eq('the strip is hidden again', w.document.getElementById('seekmark').hidden, true);
  eq('both pointers hidden again', el('pinIn').hidden && el('pinOut').hidden, true);

  // With no duration there is nothing to mark.
  w.eval('__noDuration(); __seek(5); setIn(); setOut();');
  eq('no duration, no marks', J().len, 0);

  // What the tool is actually told. The request is captured rather than sent.
  const sent = w.eval(`(async function(){
    let url = '';
    localFetch = async (u) => { url = u; return { ok:true, status:200, text:async()=>'started' }; };
    __open();
    __duration(600);
    __seek(12.5); setIn(); __seek(90.25); setOut();
    document.getElementById('splitThis').click();
    // The button shows one frame and waits for an answer before it sends
    // anything, so the question has to be answered or no request is made.
    for (let i = 0; i < 60 && !document.getElementById('xpok'); i++)
      await new Promise(r => setTimeout(r, 25));
    const ok = document.getElementById('xpok'); if (ok) ok.click();
    return new Promise(r => setTimeout(() => r(url), 120));
  })()`);

  Promise.resolve(sent).then(url => {
    if (!/[?&]start=12\.50(&|$)/.test(url)) fail('start not sent as seconds: ' + url);
    if (!/[?&]dur=77\.75(&|$)/.test(url)) fail('length not sent as seconds: ' + url);
    // Marks belong to the recording on screen. Opening another must drop them,
    // or the next split would cut the wrong part of the wrong file.
    w.eval(`segments.push({ name:'other.mp4', status:'ok', start:2, session:'s',
                            file:{ size:1000, relPath:'other.mp4' } });
            select(1);`);
    eq('marks cleared when another recording is opened', JSON.parse(st()).len, 0);

    // A file that is already one camera cannot be split again - but the
    // fisheye tool does work on one, and takes the same marks, so the marks
    // are offered there too. They were hidden while the split was the only
    // thing that could use them; that reason has gone.
    w.eval('__open(); __duration(600); __seek(10); setIn(); __seek(60); setOut();');
    eq('a four-camera recording can be marked', JSON.parse(st()).len, 50);
    eq('In is offered', w.document.getElementById('markIn').hidden, false);
    w.eval("__open('Front');");
    eq('In is still offered on a single-camera file', w.document.getElementById('markIn').hidden, false);
    eq('Out is still offered on a single-camera file', w.document.getElementById('markOut').hidden, false);
    w.eval('__duration(600); __seek(5); setIn(); __seek(30); setOut();');
    eq('and can be set on it', JSON.parse(st()).len, 25);
    // Marks belong to one recording whichever kind it is. Through the real
    // select(), not the fixture's shortcut: the clearing lives there, and
    // hiding the controls is no longer what does it.
    w.eval(`segments.push({ name:'later_Front.mp4', status:'ok', start:3, session:'s', view:'Front',
                            file:{ size:1000, relPath:'later_Front.mp4' } });
            select(1);`);
    eq('marks dropped when one single-camera file follows another', JSON.parse(st()).len, 0);
    // The export button is still offered on such a file - it can only
    // straighten it - so the marks have a taker. The button carries one
    // label now, so the tooltip is where that is said.
    eq('the export button is there to use them', w.document.getElementById('splitThis').hidden, false);
    eq('and it says it will straighten it',
       /straighten/i.test(w.document.getElementById('splitThis').title), true);

    if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
    console.log('in and out points mark a clip, and only that clip is asked for');
    dom.window.close(); process.exit(0);
  });
}, 500);
