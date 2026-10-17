// The bitrate and frame rate shown beside the file name.
//
// The frame rate is the part worth testing properly. It is read out of the
// file's own index, and the obvious way to read it - search the index for the
// first "mdhd" and the first "stsz" and divide - is wrong on any recording
// that has sound in it: there is a second media header and a second sample
// table, belonging to the audio track, and whichever comes first in the file
// is whichever the recorder happened to write first. Get that wrong and the
// line says 48000 fps, with a straight face.
//
// So these fixtures are real files made by ffmpeg at known rates, including
// ones whose audio track is written FIRST, and the answer is checked against
// what it was asked for rather than against the same arithmetic done twice.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const SRC = process.env.DCP_SRC || path.resolve(__dirname, '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcp-fstat-'));
const made = {};
function build(name, args) {
  const out = path.join(tmp, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y'].concat(args).concat([out]), { stdio: 'pipe' });
  made[name] = out;
}
try {
  // Plain video at three rates, one of them the awkward one.
  build('r30.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=4',
                    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']);
  build('r25.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=4',
                    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']);
  build('r2997.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30000/1001:d=4',
                      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']);
  // With sound, video first - and with sound, SOUND first, which is the one
  // that catches a reader that takes whichever track it meets.
  build('snd_vfirst.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=4',
                           '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
                           '-map', '0:v', '-map', '1:a',
                           '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                           '-c:a', 'aac']);
  // One frame spread over half a minute: not a frame rate any recorder here
  // produces, so reading one out of it means the index was misread.
  build('slow.mp4', ['-f', 'lavfi', '-i', 'color=c=black:s=64x48:r=1/30:d=30',
                     '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']);
  build('snd_afirst.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=24:d=4',
                           '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
                           '-map', '1:a', '-map', '0:v',
                           '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                           '-c:a', 'aac']);
} catch (e) {
  console.log('ffmpeg is not available, so the fixtures cannot be built');
  process.exit(2);
}

// What ffprobe makes of the same files, so the expected answers are measured
// rather than assumed from the arguments ffmpeg was given.
function probeFps(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_frames,duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' }).trim().split('\n');
  const dur = parseFloat(out[0]), n = parseInt(out[1], 10);
  return (n && dur) ? n / dur : 0;
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

// A stand-in for the browser's File: the page only ever asks for a slice of
// it, which is the whole point - it must not read a gigabyte to answer this.
let bytesRead = 0;
function asFile(p, name) {
  const buf = fs.readFileSync(p);
  return {
    name, size: buf.length, relPath: 'Movies/' + name,
    slice: (a, b) => {
      const end = Math.min(b === undefined ? buf.length : b, buf.length);
      bytesRead += Math.max(0, end - a);
      return { arrayBuffer: async () => new Uint8Array(buf.subarray(a, end)).buffer };
    }
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await sleep(300);

  if (typeof w.fpsFromHeader !== 'function') {
    fail('the page cannot read a frame rate out of a file at all');
    console.log(`FAIL: ${bad} problem(s)`); w.close(); process.exit(1);
  }

  // --- the frame rate, against ffprobe ---------------------------------
  for (const [file, label] of [['r30.mp4', '30 fps'], ['r25.mp4', '25 fps'],
                               ['r2997.mp4', '29.97 fps'],
                               ['snd_vfirst.mp4', '30 fps with sound after it'],
                               ['snd_afirst.mp4', '24 fps with sound BEFORE it']]) {
    const want = probeFps(made[file]);
    const got = await w.fpsFromHeader(asFile(made[file], file));
    if (!got) { fail(`${label}: nothing was read out of ${file}`); continue; }
    if (Math.abs(got - want) > 0.1)
      fail(`${label}: read ${got.toFixed(2)} fps, ffprobe says ${want.toFixed(2)}`);
  }

  // The audio-first file is the one that fails loudly when the tracks are
  // confused, so it is worth saying what the wrong answer would look like.
  const afirst = await w.fpsFromHeader(asFile(made['snd_afirst.mp4'], 'snd_afirst.mp4'));
  if (afirst > 1000)
    fail(`the audio track was read as the video track: ${afirst.toFixed(0)} fps`);

  // --- and it does not read the whole file to find out ------------------
  // The index is a few kilobytes at one end; reading the lot would make
  // opening a recording on a card cost as much as copying it.
  bytesRead = 0;
  const big = asFile(made['r30.mp4'], 'r30.mp4');
  await w.fpsFromHeader(big);
  if (bytesRead > big.size * 0.5)
    fail(`reading the frame rate pulled in ${bytesRead} of ${big.size} bytes`);

  // --- rubbish in, nothing out -----------------------------------------
  // Never a number made up to fill the space: the line leaves the figure out
  // when it cannot be read, which is the whole reason it can be trusted.
  const junk = { name: 'x.mp4', size: 4096, relPath: 'x.mp4',
    slice: (a, b) => ({ arrayBuffer: async () => new Uint8Array(Math.max(0, (b || 4096) - a)).buffer }) };
  const none = await w.fpsFromHeader(junk);
  if (none) fail('a file with no index still produced a frame rate: ' + none);

  // And an answer that parses but cannot be true is not passed on either. A
  // figure this far from anything a recorder writes means the index was read
  // wrongly, and the line would be stating that with a straight face.
  const absurd = await w.fpsFromHeader(asFile(made['slow.mp4'], 'slow.mp4'));
  if (absurd) fail('one frame in thirty seconds was reported as a frame rate: ' + absurd);

  // --- the line itself --------------------------------------------------
  const secs = 4;
  const sz = fs.statSync(made['r30.mp4']).size;
  w.eval(`
    segments.length = 0;
    segments.push({ name:'r30.mp4', status:'ok', start:1, session:'s', view:null,
      missing:false, flat:false, sidecar:null, seconds:${secs}, fps:30,
      file:{ size:${sz}, name:'r30.mp4', relPath:'Movies/r30.mp4' } });
    current = 0;
    renderPathLine(segments[0]);
  `);
  const text = w.document.getElementById('pathLine').textContent;
  const wantMbps = (sz * 8 / secs / 1e6).toFixed(1);
  if (!text.includes(wantMbps + ' Mb/s'))
    fail(`the line does not carry the bitrate ${wantMbps} Mb/s: ${text}`);
  if (!/\b30 fps\b/.test(text)) fail('the line does not carry the frame rate: ' + text);
  if (/30\.00 fps/.test(text)) fail('a round frame rate is dressed up with decimals: ' + text);
  // The name comes first - the figures are there to describe it, not to
  // compete with it.
  if (text.indexOf('r30.mp4') > text.indexOf('Mb/s'))
    fail('the figures come before the file they describe: ' + text);

  // 29.97 keeps its decimals, because it is a different thing from 30.
  if (w.fmtFps(29.97) !== '29.97 fps') fail('29.97 fps is rounded away: ' + w.fmtFps(29.97));
  if (w.fmtFps(30.0001) !== '30 fps') fail('30 fps is not shown plainly: ' + w.fmtFps(30.0001));

  // The same again once the helper has said where the folder is, because
  // that draws a different line: the path becomes a link, and the figures
  // have to follow it rather than get in front of it.
  w.eval(`rootPath = 'F:\\\\DCIM'; segments[0].fps = 30; renderPathLine(segments[0]);`);
  const linked = w.document.getElementById('pathLine').textContent;
  if (!w.document.getElementById('pathOpen'))
    fail('the path stopped being a link once there were figures beside it');
  if (!/Mb\/s/.test(linked) || !/\b30 fps\b/.test(linked))
    fail('the figures are missing from the line with the full path: ' + linked);
  if (linked.indexOf('r30.mp4') > linked.indexOf('Mb/s'))
    fail('the figures come before the file they describe: ' + linked);
  // The link is the path and nothing else - the figures are not part of what
  // gets clicked, or clicking the line would mean clicking a bitrate.
  if (/Mb\/s|fps/.test(w.document.getElementById('pathOpen').textContent))
    fail('the figures were put inside the link: ' + w.document.getElementById('pathOpen').textContent);
  w.eval(`rootPath = '';`);

  // --- nothing known, nothing claimed ------------------------------------
  w.eval(`
    segments[0].seconds = 0; segments[0].fps = 0; segments[0].sidecar = null;
    renderPathLine(segments[0]);
  `);
  const bare = w.document.getElementById('pathLine').textContent;
  if (/Mb\/s|fps/.test(bare))
    fail('a figure was shown for a recording that cannot say: ' + bare);
  if (!/r30\.mp4/.test(bare)) fail('the name went missing with the figures: ' + bare);

  // --- the sidecar answers without opening the file ----------------------
  // The recorder that writes one has already counted the frames, so there is
  // nothing to read and nothing to wait for.
  w.eval(`
    segments[0].fps = 0; segments[0].fpsTried = false;
    segments[0].sidecar = { frameStats:{count:120}, actualTrack:{durationMs:4000} };
    renderPathLine(segments[0]);
  `);
  const viaSidecar = w.document.getElementById('pathLine').textContent;
  if (!/\b30 fps\b/.test(viaSidecar))
    fail('the sidecar\'s own frame count is not used: ' + viaSidecar);

  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad) { console.log(`FAIL: ${bad} problem(s)`); w.close(); process.exit(1); }
  console.log('the bitrate and frame rate beside the name are read from the file, video track and all');
  w.close(); process.exit(0);
})();
