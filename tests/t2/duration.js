// How long is this recording?
//
// Harder than it sounds. A recorder that writes its segments without a length
// in the header leaves the browser reporting Infinity, or NaN before enough
// has loaded, and ffprobe no better off - which is why the split showed no
// percentage for those files. Infinity is the trap: it passes a truthiness
// test, so `video.duration || fallback` takes the Infinity and never reaches
// the fallback, and everything downstream divides by it.
const fs = require('fs');
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

const PAGE = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = PAGE.match(/DCP_VERSION="([0-9.]+)"/)[1];
const dom = new JSDOM(PAGE.replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', VER), {
  runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined;
  } });
const w = dom.window; w.onerror = () => {};

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

setTimeout(() => {
  // The element's duration, and what it can seek to, are both set the way a
  // browser would once the file is open.
  const set = (duration, seekEnd) => {
    w.eval(`Object.defineProperty(video,'duration',{configurable:true,get:()=>${duration}})`);
    w.eval(`Object.defineProperty(video,'seekable',{configurable:true,get:()=>(${
      seekEnd === null ? '{length:0}' : `{length:1,end:()=>${seekEnd}}`}) })`);
  };
  const ask = seg => w.eval(`knownSeconds(${JSON.stringify(seg)})`);

  // The ordinary case.
  set(120, 120);
  if (ask({}) !== 120) fail('a measured recording: got ' + ask({}));

  // No length in the header. The browser still knows how far it can seek.
  set(Infinity, 95.5);
  let got = ask({});
  if (got !== 95.5) fail('a recording with no declared length: got ' + got);

  // Nor that - but the sidecar carries the figure the recorder wrote.
  set(Infinity, null);
  got = ask({ sidecar: { actualTrack: { durationMs: 61000 } } });
  if (got !== 61) fail('the sidecar length was not used: got ' + got);

  // Before anything has loaded.
  set(NaN, null);
  got = ask({ sidecar: { actualTrack: { durationMs: 61000 } } });
  if (got !== 61) fail('NaN duration with a sidecar: got ' + got);

  // Other shapes a sidecar may use for the same thing.
  set(NaN, null);
  if (ask({ sidecar: { durationMs: 30000 } }) !== 30) fail('durationMs on the sidecar itself was ignored');
  if (ask({ sidecar: { durationSec: 42 } }) !== 42) fail('durationSec was ignored');
  if (ask({ asset: { durationMs: 15000 } }) !== 15) fail("the manifest asset's length was ignored");

  // Nothing knows: zero, and nothing invented. A wrong number here would show
  // a confident percentage that means nothing.
  set(NaN, null);
  if (ask({}) !== 0) fail('a length was invented from nowhere: ' + ask({}));
  set(Infinity, Infinity);
  if (ask({}) !== 0) fail('Infinity was accepted as a length');
  set(0, 0);
  if (ask({ sidecar: { actualTrack: { durationMs: 0 } } }) !== 0) fail('zero was accepted as a length');
  set(-5, null);
  if (ask({}) !== 0) fail('a negative length was accepted');

  // The readout uses the same answer, so a recording with no declared length
  // shows its real running time rather than 0:00.
  set(Infinity, 95.5);
  w.eval(`segments.length=0;segments.push({name:'a.mp4',start:0,sidecar:null});current=0;updateTime();`);
  const total = w.document.getElementById('tTotal').textContent.trim();
  if (!/1:35|0:01:35/.test(total)) fail('the time readout does not show the real length: ' + total);

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('the recording\'s length is found wherever it is, and never invented');
  dom.window.close(); process.exit(0);
}, 500);
