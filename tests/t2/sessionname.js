// What the day heading says.
//
// The OpenAVM recorder puts a session id in its sidecars, and the list used
// that id as the group heading: "Session b6fa8d0d". It identifies nothing a
// person can see, and two cards' worth of recordings read as a wall of hex.
// This drives the real intake with AVM-shaped files and reads the heading
// off the rendered list.
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

const SID = 'b6fa8d0d-4f21-4a6e-9c1b-7e3d0a5f2b88';

// A file the intake can read: mp4Status walks the boxes, so the stub carries
// a real moov header and reports "ok" rather than "damaged".
function mp4(name, relPath) {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(32, 0); buf.write('moov', 4);
  return {
    name, relPath, size: 4 * 1024 * 1024,
    // A real ArrayBuffer, not a Node Buffer: DataView rejects the latter and
    // the intake marks the file unreadable without ever reaching the list.
    slice: (a, b) => ({ arrayBuffer: async () => new Uint8Array(buf.subarray(a, b)).buffer }),
    text: async () => ''
  };
}
function json(name, relPath, data) {
  return { name, relPath, size: 400, text: async () => JSON.stringify(data) };
}

setTimeout(async () => {
  const start = Date.UTC(2026, 9, 11, 2, 30, 0);
  const files = [
    mp4('a_surround.mp4', 'Movies/a_surround.mp4'),
    json('a_surround.json', 'Movies/a_surround.json',
      { recordingSessionId: SID, segmentNumber: 1, startedAtEpochMs: start,
        actualTrack: { width: 2560, height: 2660, durationMs: 60000 } }),
    mp4('b_surround.mp4', 'Movies/b_surround.mp4'),
    json('b_surround.json', 'Movies/b_surround.json',
      { recordingSessionId: SID, segmentNumber: 2, startedAtEpochMs: start + 60000,
        actualTrack: { width: 2560, height: 2660, durationMs: 60000 } })
  ];

  w.__files = files;
  await w.eval(`ingestInner(window.__files)`);

  const heads = [...w.document.querySelectorAll('.sess b')].map(b => b.textContent.trim());
  if (!heads.length) fail('the list has no headings at all');

  const all = heads.join(' | ');
  if (/session/i.test(all)) fail('the heading still says "Session": ' + all);
  if (all.includes('b6fa8d0d')) fail('the session id is still on screen: ' + all);
  if (!heads.some(h => /Dashcam video \(AVM\)/.test(h)))
    fail('the heading does not name the recording: ' + all);

  // One session, one heading - the label must not have split the group.
  if (heads.length !== 1) fail('the recordings were split across headings: ' + all);

  // The id is still what paired them: both segments sit under that heading.
  const rows = w.document.querySelectorAll('.seg');
  if (rows.length !== 2) fail('expected both recordings in the group, got ' + rows.length);

  // And the date is still shown beside the heading, as it is for every group.
  const date = w.document.querySelector('.sess .date, .sess .when, .sess span:last-child');
  if (date && !date.textContent.trim()) fail('the group lost its date');

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('the heading names the recording, not the recorder\'s session id');
  dom.window.close(); process.exit(0);
}, 500);
