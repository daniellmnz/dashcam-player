// The clock on a single view file.
//
// Those files are cut out of a recording and named after it. One recorder
// puts the time in the file name, the other writes it into the sidecar - and
// a file cut from the second kind arrived with no time at all. The clock
// burned onto the frame fell back to a stopwatch starting at 0:00.0, the row
// showed no time, and the group heading had no date. The source recording is
// in the same list with its time already worked out, so it is asked.
const fs = require('fs');
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

const PAGE = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = PAGE.match(/DCP_VERSION="([0-9.]+)"/)[1];

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

// Everything the burn draws, captured. The real draw path is used: what is
// being checked is the text that lands on the picture.
const painted = [];
const dom = new JSDOM(PAGE.replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', VER), {
  runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext = () => ({
      canvas: { width: 1280, height: 1330 },
      fillText: (t) => painted.push(String(t)),
      measureText: () => ({ width: 120 }),
      drawImage() {}, fillRect() {}, clearRect() {}, save() {}, restore() {},
      translate() {}, rotate() {}, scale() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, stroke() {}, fill() {}, setTransform() {},
      set font(v) {}, get font() { return ''; },
      set fillStyle(v) {}, get fillStyle() { return ''; },
      set textBaseline(v) {}, get textBaseline() { return ''; },
      set imageSmoothingQuality(v) {}, set imageSmoothingEnabled(v) {}
    });
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined;
  } });
const w = dom.window; w.onerror = () => {};

// The AVM recorder's shape: no time in the name, the time in the sidecar.
const START = Date.UTC(2026, 9, 11, 2, 30, 0);
function mp4(name) {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(32, 0); buf.write('moov', 4);
  return { name, relPath: 'Movies/' + name, size: 4 * 1024 * 1024,
    slice: (a, b) => ({ arrayBuffer: async () => new Uint8Array(buf.subarray(a, b)).buffer }),
    text: async () => '' };
}
function json(name, data) {
  return { name, relPath: 'Movies/' + name, size: 400, text: async () => JSON.stringify(data) };
}

setTimeout(async () => {
  w.__files = [
    mp4('a_surround.mp4'),
    json('a_surround.json', { recordingSessionId: 'b6fa8d0d-4f21-4a6e-9c1b-7e3d0a5f2b88',
      segmentNumber: 1, startedAtEpochMs: START,
      actualTrack: { width: 2560, height: 2660, durationMs: 60000 } }),
    // What the split tool wrote: the whole recording, and a clip from 25s in.
    mp4('a_surround_Front.mp4'),
    mp4('a_surround_Rear_clip25.mp4')
  ];
  await w.eval(`ingestInner(window.__files)`);

  const find = n => w.eval(`JSON.stringify((segments.find(s=>s.name===${JSON.stringify(n)})||{}))`);
  const whole = JSON.parse(find('a_surround_Front.mp4'));
  const clip = JSON.parse(find('a_surround_Rear_clip25.mp4'));

  if (!whole.start) fail('the single view file has no time at all');
  else if (whole.start !== START) fail('the single view file took the wrong time: ' + new Date(whole.start).toISOString());

  if (clip.start !== START + 25000)
    fail('a clip did not start 25s into the recording: ' + new Date(clip.start || 0).toISOString());

  if (!/\d/.test(String(whole.session))) fail('the group heading has no date: ' + whole.session);

  // The clock as it is actually painted onto the frame.
  painted.length = 0;
  w.eval(`
    Object.defineProperty(video,'duration',{configurable:true,get:()=>30});
    Object.defineProperty(video,'videoWidth',{configurable:true,get:()=>1280});
    Object.defineProperty(video,'videoHeight',{configurable:true,get:()=>1330});
    Object.defineProperty(video,'currentTime',{configurable:true,get:()=>0});
    Object.defineProperty(video,'readyState',{configurable:true,get:()=>4});
    current=segments.findIndex(s=>s.name==='a_surround_Front.mp4');
    prefs.burnTime=true; document.getElementById('burnTime').checked=true;
    try{ draw(); }catch(e){}
  `);
  const stamp = painted.join(' | ');
  if (!stamp) fail('nothing was drawn onto the frame');
  else {
    if (/^\s*0:00/.test(stamp) || /\b0:00\.0\b/.test(stamp))
      fail('the frame still carries a stopwatch, not the time of day: ' + stamp);
    if (!/2026/.test(stamp)) fail('the date is not on the frame: ' + stamp);
  }

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('a single view file carries the date and time of the recording it came from');
  dom.window.close(); process.exit(0);
}, 500);
