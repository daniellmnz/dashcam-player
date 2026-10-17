// A recording the fisheye tool has already straightened.
//
// Opened in the player it was straightened again: the lens setting that took
// the curve out of the original put a curve back into a picture that was
// already flat. The file says so in its name, so the player can know - and
// having known, it also stops listing a straightened file among the plain
// split ones, which are a different thing.
//
// The mark in the name changed from "_dewarped" to "_rectified" in v1.43.4.
// An upgrade does not rename the files already on the card, so BOTH marks
// are checked here, and a file carrying the old one must behave in every
// respect like a file carrying the new one. Drop that and an older export
// silently rejoins the split files and gets bent a second time on playback.
const fs = require('fs');
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

const PAGE = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = PAGE.match(/DCP_VERSION="([0-9.]+)"/)[1];

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

// Every call the page makes to WebGL is recorded, so "was it corrected?" is
// answered by what the page did, not by reading the source and hoping.
const used = [];
const dom = new JSDOM(PAGE.replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', VER), {
  runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext = function (kind) {
      if (kind === 'webgl' || kind === 'experimental-webgl') { used.push(kind); return null; }
      return { canvas: { width: 1280, height: 960 },
        fillText() {}, measureText: () => ({ width: 10 }),
        drawImage: () => used.push('2d:drawImage'),
        fillRect() {}, clearRect() {}, save() {}, restore() {}, translate() {},
        rotate() {}, scale() {}, beginPath() {}, closePath() {}, moveTo() {},
        lineTo() {}, stroke() {}, fill() {}, setTransform() {},
        set font(v) {}, set fillStyle(v) {}, set textBaseline(v) {},
        set imageSmoothingQuality(v) {}, set imageSmoothingEnabled(v) {} };
    };
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined;
  } });
const w = dom.window; w.onerror = () => {};

const START = Date.UTC(2026, 9, 10, 1, 52, 46);
function mp4(name) {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(32, 0); buf.write('moov', 4);
  return { name, relPath: 'Dashcam and Sentry exports/rectified/' + name, size: 4 * 1024 * 1024,
    slice: (a, b) => ({ arrayBuffer: async () => new Uint8Array(buf.subarray(a, b)).buffer }),
    text: async () => '' };
}
// The same file, but in the folder an older version wrote into.
function mp4in(dir, name) {
  const f = mp4(name);
  f.relPath = 'Dashcam and Sentry exports/' + dir + '/' + name;
  return f;
}
function json(name, data) {
  return { name, relPath: 'Movies/' + name, size: 400, text: async () => JSON.stringify(data) };
}

setTimeout(async () => {
  // The name the fisheye tool writes, in all three shapes it can take.
  w.__files = [
    mp4('20261010_135246_surround.mp4'),
    json('20261010_135246_surround.json', { recordingSessionId: 'abc', segmentNumber: 1,
      startedAtEpochMs: START, actualTrack: { width: 2560, height: 2660, durationMs: 60000 } }),
    mp4('20261010_135246_surround_Left.mp4'),             // plain split
    mp4('20261010_135246_surround_Left_rectified.mp4'),    // straightened
    mp4('20261010_135246_surround_Rear_clip8_rectified.mp4'),  // a straightened clip
    // Written by an older version, into the folder that version used.
    mp4in('dewarped', '20261010_135246_surround_Front_dewarped.mp4')
  ];
  await w.eval(`ingestInner(window.__files)`);

  const seg = n => JSON.parse(w.eval(`JSON.stringify(segments.find(s=>s.name===${JSON.stringify(n)})||null)`));
  const split = seg('20261010_135246_surround_Left.mp4');
  const flat = seg('20261010_135246_surround_Left_rectified.mp4');
  const flatClip = seg('20261010_135246_surround_Rear_clip8_rectified.mp4');
  const old = seg('20261010_135246_surround_Front_dewarped.mp4');

  for (const [s, n] of [[split, 'the split file'], [flat, 'the straightened file'],
                        [flatClip, 'the straightened clip'],
                        [old, 'a file straightened by an older version']]) {
    if (!s) { fail(n + ' is not in the list at all'); continue; }
    // Every one of them must still be read as ONE camera. A name with two
    // trailing words used to fall through to the grid rule, and a single
    // view read as a grid gets carved into four quarters of itself.
    if (!s.view) fail(n + ' is not recognised as a single camera: ' + s.name);
  }

  if (split && split.flat) fail('a plain split file is marked as straightened');
  if (flat && !flat.flat) fail('the straightened file is not marked as such');
  if (flatClip && !flatClip.flat) fail('a straightened clip is not marked as such');
  if (old && !old.flat) fail('a file carrying the older _dewarped mark is no longer recognised');

  // Its own part of the list, the way the split files have theirs.
  if (flat && !/rectified/i.test(String(flat.session)))
    fail('the straightened file is not in its own section: ' + flat.session);
  if (split && /rectified/i.test(String(split.session)))
    fail('a plain split file was put in the straightened section: ' + split.session);
  // The older file goes under the SAME heading as the new ones - one section,
  // not two, or the list grows a second pile every time a name changes.
  if (old && flat && String(old.session) !== String(flat.session))
    fail('an older straightened file gets a heading of its own: ' + old.session);
  if (flat && split && String(flat.session) === String(split.session))
    fail('straightened and split files share one heading: ' + flat.session);
  // And the heading still carries the date, inherited from the recording.
  if (flat && !/\d/.test(String(flat.session)))
    fail('the straightened section has no date: ' + flat.session);
  if (flat && !flat.start) fail('the straightened file has no time');
  if (flatClip && flat && flatClip.start !== flat.start + 8000 - 0 && !flatClip.start)
    fail('the straightened clip has no time');

  // Now the point of all of it: with the lens correction turned well up, a
  // straightened file must not go through it.
  const drawOne = name => {
    used.length = 0;
    w.eval(`
      lens.k=0.6; lens.zoom=1.2;
      Object.defineProperty(video,'videoWidth',{configurable:true,get:()=>1280});
      Object.defineProperty(video,'videoHeight',{configurable:true,get:()=>960});
      Object.defineProperty(video,'readyState',{configurable:true,get:()=>4});
      current=segments.findIndex(s=>s.name===${JSON.stringify(name)});
      mode={kind:'lane',i:0};
      try{ draw(); }catch(e){}
    `);
    return w.eval(`(function(){try{return !!(lensOn()&&!isFlat(segments[current]));}catch(e){return null;}})()`);
  };

  if (drawOne('20261010_135246_surround_Left.mp4') !== true)
    fail('the lens correction no longer applies to an ordinary split file');
  if (drawOne('20261010_135246_surround_Left_rectified.mp4') !== false)
    fail('a straightened file is corrected a second time');
  if (drawOne('20261010_135246_surround_Rear_clip8_rectified.mp4') !== false)
    fail('a straightened clip is corrected a second time');
  if (drawOne('20261010_135246_surround_Front_dewarped.mp4') !== false)
    fail('a file straightened by an older version is corrected a second time');

  // And the control says why it is doing nothing, rather than looking broken.
  // Through syncAdjust, which is the one place that works out what can act on
  // what is on screen - the label alone no longer decides it.
  w.eval(`current=segments.findIndex(s=>s.name==='20261010_135246_surround_Left_rectified.mp4');syncAdjust();`);
  const said = w.document.getElementById('lensKVal').textContent;
  if (!/straighten/i.test(said)) fail('the lens control does not say why it cannot apply: ' + said);
  if (!w.document.getElementById('lensK').disabled) fail('the lens slider is still draggable on a flat file');
  w.eval(`current=segments.findIndex(s=>s.name==='20261010_135246_surround_Left.mp4');syncAdjust();`);
  if (w.document.getElementById('lensK').disabled) fail('the lens slider stayed disabled on an ordinary file');

  // --- the status strip under a straightened file -----------------------
  // The split tool writes a SQUARE camera with the strip under it; the
  // fisheye tool writes 4:3, because straightening maps the circle onto a
  // flat plane of its own proportions. The geometry assumed square for both,
  // so on a rectified file "height minus width" came out negative, the strip
  // test failed, and the strip was read as part of the picture.
  //
  // What that looked like: the burnt-in clock sits just above the strip, and
  // with no strip known it sat at the very bottom of the frame - on top of
  // the vehicle data. So the clock is where this is measured from.
  const geomOf = name => JSON.parse(w.eval(`(function(){
    const s=segments.find(x=>x.name===${'${JSON.stringify(name)}'});
    Object.defineProperty(video,'videoWidth',{configurable:true,get:()=>1280});
    Object.defineProperty(video,'videoHeight',{configurable:true,get:()=>__H});
    const g=singleViewGeom(s);
    return JSON.stringify(g?{w:g.w,h:g.h,viewH:g.viewH,strip:g.strip}:null);
  })()`.replace('${JSON.stringify(name)}', JSON.stringify(name))));

  // 1280x1010: a 1280x960 rectified picture with a 50-pixel strip beneath.
  w.eval('window.__H=1010');
  const flatGeom = geomOf('20261010_135246_surround_Left_rectified.mp4');
  if (!flatGeom) fail('a straightened file has no geometry at all');
  else {
    if (flatGeom.strip !== 50)
      fail(`the strip under a straightened file is read as ${flatGeom.strip} pixels, not 50 - `
         + 'so the clock and the trim both treat it as picture');
    if (flatGeom.viewH !== 960)
      fail(`the straightened picture is read as ${flatGeom.viewH} tall, not the 960 the tool writes`);
  }

  // The split tool's square output must still be read the way it always was.
  w.eval('window.__H=1330');
  const splitGeom = geomOf('20261010_135246_surround_Left.mp4');
  if (!splitGeom) fail('a split file has no geometry at all');
  else {
    if (splitGeom.strip !== 50)
      fail(`the strip under a split file is now read as ${splitGeom.strip} pixels, not 50`);
    if (splitGeom.viewH !== 1280)
      fail(`a split camera is no longer read as square: ${splitGeom.viewH} tall`);
  }

  // And a file with no strip at all must not grow one.
  w.eval('window.__H=960');
  const bare = geomOf('20261010_135246_surround_Left_rectified.mp4');
  if (bare && bare.strip !== 0)
    fail(`a strip was invented under a file that has none: ${bare.strip} pixels`);

  // --- a TRIMMED straightened file ---------------------------------------
  // The 4:3 rule cannot find the strip here: the picture is 604 tall, not
  // 960, so "height minus 4:3 of the width" is negative and the strip gets
  // read as picture - which is what put the clock back on the vehicle data.
  // The tool records the picture's height in the name for this case.
  w.eval(`segments.push({name:'20261010_135246_surround_Left_pic604_rectified.mp4',
    status:'ok', start:Date.now(), session:'s', view:'Left', missing:false, flat:true,
    sidecar:null, seconds:60,
    file:{size:10,relPath:'Dashcam and Sentry exports/rectified/x.mp4',name:'x.mp4'}});`);
  w.eval('window.__H=654');
  const trimmed = geomOf('20261010_135246_surround_Left_pic604_rectified.mp4');
  if (!trimmed) fail('a trimmed straightened file has no geometry at all');
  else {
    if (trimmed.viewH !== 604)
      fail(`a trimmed picture is read as ${trimmed.viewH} tall, not the 604 its name records`);
    if (trimmed.strip !== 50)
      fail(`the strip under a trimmed file is read as ${trimmed.strip} pixels, not 50 - `
         + 'so the clock sits on top of the vehicle data');
  }

  // A recorded height that cannot be true of the file in hand is ignored
  // rather than believed: names can be edited, and a picture taller than the
  // frame it is in is not a picture.
  w.eval(`segments.push({name:'20261010_135246_surround_Left_pic9000_rectified.mp4',
    status:'ok', start:Date.now(), session:'s', view:'Left', missing:false, flat:true,
    sidecar:null, seconds:60,
    file:{size:10,relPath:'Dashcam and Sentry exports/rectified/y.mp4',name:'y.mp4'}});`);
  w.eval('window.__H=654');
  const silly = geomOf('20261010_135246_surround_Left_pic9000_rectified.mp4');
  if (silly && silly.strip !== 0)
    fail(`a picture height taller than the frame was believed: strip ${silly.strip}`);

  // --- a straightened clip has one view, and it is the whole frame -------
  // It holds one camera, already flat, with the strip under it. A lane button
  // beside "Whole frame" offered a choice between a picture and the same
  // picture, and the lane view quietly dropped the strip.
  w.eval(`
    Object.defineProperty(video,'videoWidth',{configurable:true,get:()=>1280});
    Object.defineProperty(video,'videoHeight',{configurable:true,get:()=>1010});
    prefs.mode='lane'; prefs.laneIndex=0; mode={kind:'lane',i:0};
    current=segments.findIndex(s=>s.name==='20261010_135246_surround_Left_rectified.mp4');
    buildLaneButtons(segments[current]);
  `);
  const btns = [...w.document.querySelectorAll('#laneBtns button')].map(b => b.textContent.trim());
  if (btns.length !== 1 || !/whole frame/i.test(btns[0]))
    fail('a straightened clip offers views other than the whole frame: ' + JSON.stringify(btns));
  if (w.document.querySelectorAll('#viewToggles input').length)
    fail('a straightened clip offers "In grid" boxes, and it has no grid');

  // Opening one puts the player in whole frame - but must not make that the
  // remembered choice, or the next four-camera recording opens that way too.
  w.eval(`
    prefs.mode='lane'; mode={kind:'lane',i:0};
    const s=segments[current];
    if(isFlat(s)&&mode.kind!=='all') setMode({kind:'all'},false);
  `);
  const after = JSON.parse(w.eval(`JSON.stringify({mode:mode.kind,pref:prefs.mode})`));
  if (after.mode !== 'all')
    fail('opening a straightened clip does not put the player in whole frame: ' + after.mode);
  if (after.pref !== 'lane')
    fail('opening a straightened clip overwrote the remembered view with ' + after.pref
       + ', so the next ordinary recording opens that way too');

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('a straightened recording is named, listed and played as one, not bent again, '
            + 'and its status strip is known to be a strip');
  dom.window.close(); process.exit(0);
}, 500);
