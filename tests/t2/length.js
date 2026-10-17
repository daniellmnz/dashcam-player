// How long is this recording, when nothing has told us?
//
// The list showed a length only for recordings that came with a sidecar, and
// only one of the two recorders in use writes one - so half the card showed
// a size and nothing else. The length is in the file's own header, a few
// bytes past the index the list already walks to decide whether a recording
// is sound, so it is read there.
//
// Run against real MP4 files built by ffmpeg, not a hand-rolled fixture:
// the whole point is reading a real container correctly.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');
const SRC = process.env.DCP_SRC || path.resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

// ffmpeg is how the fixtures are made; without it there is nothing to read.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcp-len-'));
function build(name, args) {
  const out = path.join(tmp, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, out], { stdio: 'pipe' });
  return out;
}
let files;
try {
  files = {
    // Over a megabyte, or the list skips it as empty before reading anything.
    plain: build('plain.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=25:duration=47',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '400k']),
    // The same recording written in fragments, which is how a recorder that
    // may lose power mid-write does it. Its header declares no length.
    frag: build('frag.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=25:duration=47',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '400k',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof'])
  };
} catch (e) {
  console.log('ffmpeg is not available, so the real files cannot be built');
  process.exit(2);
}

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

// A File over a real file on disk, reading the bytes the page asks for.
function fileFor(p, name) {
  const buf = fs.readFileSync(p);
  return { name, relPath: 'Movies/' + name, size: buf.length,
    slice: (a, b) => ({ arrayBuffer: async () => new Uint8Array(buf.subarray(a, b)).buffer }),
    text: async () => '' };
}

setTimeout(async () => {
  const meta = async (p, name) => {
    w.__f = fileFor(p, name);
    return await w.eval(`mp4Meta(window.__f)`);
  };

  const m = await meta(files.plain, 'a_surround.mp4');
  if (m.status !== 'ok') fail('a sound recording was not read as sound: ' + m.status);
  if (Math.abs(m.seconds - 47) > 0.5) fail('the length read out of the file was ' + m.seconds + ', not 47');

  // A fragmented recording declares no length in its header. Nothing may be
  // invented for it - a confident wrong figure is worse than none.
  const f = await meta(files.frag, 'b_surround.mp4');
  if (f.seconds !== 0) fail('a length was invented for a file that declares none: ' + f.seconds);

  // And it reaches the row, for a recording with no sidecar at all.
  w.__files = [fileFor(files.plain, 'a_surround.mp4')];
  await w.eval(`ingestInner(window.__files)`);
  const seg = JSON.parse(w.eval(`JSON.stringify(segments[0]||{})`));
  if (Math.abs((seg.seconds || 0) - 47) > 0.5) fail('the length did not reach the list: ' + seg.seconds);
  const said = w.eval(`detailLine(segments[0])`);
  if (!/0:47/.test(said)) fail('the row does not show the length: ' + said);

  // The sidecar still wins when there is one: it is what the recorder meant,
  // and the header can disagree with it on a time-lapse.
  const withSc = w.eval(`detailLine(Object.assign({},segments[0],
    {sidecar:{actualTrack:{durationMs:61000}}}))`);
  if (!/1:01/.test(withSc)) fail('the sidecar length was not preferred: ' + withSc);

  // It is also one of the sources the split percentage divides by.
  const known = w.eval(`knownSeconds({seconds:47})`);
  if (known !== 47) fail('the length read from the file is not used for the progress: ' + known);

  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('the length is read out of the file itself, so every recording shows one');
  dom.window.close(); process.exit(0);
}, 500);
