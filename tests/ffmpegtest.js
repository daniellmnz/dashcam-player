// Offering to install ffmpeg.
//
// ffmpeg is the one thing the export tools need that does not come with the
// app, and a page cannot see a PATH - it has to ask the helper. This drives
// the whole exchange in a real browser against a stub helper: the offer only
// appears when ffmpeg is missing, the install is followed to its end, and the
// page says what happened either way.
//
// The stub answers /ffmpeg and /install-ffmpeg the way dashcam-server.ps1
// does, so what is checked here is the page's half of a contract whose other
// half is checked by ffmpegsrv.ps1.
const http = require('http'), fs = require('fs'), path = require('path');
const SRC = process.env.DCP_SRC || path.resolve(__dirname, '..', 'src');
const { chromium } = require(process.env.NM + '/playwright-core');
// Where that browser is. A clone of this repository has no browser at
// the path this was developed against - playwright-core deliberately
// downloads none - so the runner passes one in and this falls back for
// anyone running the file directly.
const CHROMIUM = process.env.DCP_CHROMIUM || '/opt/pw-browsers/chromium';
const PAGE = process.env.DCP_PAGE || SRC + '/dashcam-player.html';
const VER = fs.readFileSync(PAGE, 'utf8').match(/DCP_VERSION="([0-9.]+)"/)[1];

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };
const eq = (what, got, want) => { if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };

// What the stub helper currently believes.
let state = { ffmpeg: false, winget: true, state: 'idle', detail: '' };
let installs = 0, tokens = [];

const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  const send = (body, type) => {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  if (u === '/ping') { res.writeHead(200); return res.end(); }
  if (u === '/version') return send(VER, 'text/plain');
  if (u === '/ffmpeg') return send(JSON.stringify(state), 'application/json');
  if (u === '/install-ffmpeg') {
    installs++;
    tokens.push(req.headers['x-dashcam-token'] || '');
    // The helper answers "running" when it already started one itself.
    const reply = state.state === 'running' ? 'running' : 'started';
    state = { ffmpeg: false, winget: true, state: 'running', detail: 'Installing Gyan.FFmpeg.Essentials with winget.' };
    return send(reply, 'text/plain');
  }
  send(fs.readFileSync(PAGE, 'utf8')
         .replace('__DCP_TOKEN__', 'x'.repeat(64))
         .replace('__DCP_SRVVER__', VER), 'text/html');
});

// Waits on something this process knows - the stub helper's own counters -
// rather than on the page. The predicate for waitFor runs in the browser,
// where those variables do not exist.
const waitHere = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise(r => setTimeout(r, 100));
  }
  return true;
};
const waitFor = async (p, fn, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    if (await p.evaluate(fn)) return true;
    if (Date.now() - t0 > ms) return false;
    await p.waitForTimeout(150);
  }
};

srv.listen(8803, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 700 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8803/'); await p.waitForTimeout(700);

  // A four-camera recording with one camera on screen, which is when the
  // split button - and so the offer - belongs.
  await p.evaluate(() => {
    document.getElementById('transport').hidden = false;
    document.getElementById('stage').classList.remove('empty');
    document.getElementById('dropzone').style.display = 'none';
    const lanes = [1,2,3,4].map(n => ({ lane:n, displayOrder:n,
      x0:((n-1)%2)*1280, y0:(n>2?1280:0), x1:((n-1)%2)*1280+1280, y1:(n>2?2560:1280) }));
    segments.length = 0;
    segments.push({ name:'20261010_140247_surround.mp4', status:'ok', start:1, session:'s',
                    view:null, file:{ size:1000, relPath:'x.mp4' },
                    sidecar:{ laneLayout:{ lanes }, recordingSessionId:'s' } });
    current = 0; mode = { kind:'lane', i:0 };
    syncSplitButton();
  });

  // Finding ffmpeg missing is reason enough to fetch it. Nobody presses
  // anything: the player noticed, so the player deals with it.
  if (!await waitHere(() => installs > 0))
    fail('the page found ffmpeg missing and did nothing about it');
  eq('exactly one fetch was started', installs, 1);
  if (!/^x{64}$/.test(tokens[0] || '')) fail('the fetch went without the token: ' + JSON.stringify(tokens[0]));
  eq('the split button is still offered', await p.evaluate(() => document.getElementById('splitThis').hidden), false);
  eq('no button to press while it runs', await p.evaluate(() => document.getElementById('getFfmpeg').hidden), true);
  if (!/install/i.test(await p.textContent('#splitNote') || ''))
    fail('the page does not say it is installing: ' + await p.textContent('#splitNote'));

  // While winget runs, the page repeats what the helper is doing.
  if (!await waitFor(p, () => /winget/i.test(document.getElementById('splitNote').textContent)))
    fail('the helper\'s progress is not shown');

  // It finishes. Nothing is restarted: the helper re-reads the PATH itself.
  state = { ffmpeg: true, winget: true, state: 'done', detail: 'ffmpeg is installed and ready.' };
  const note = await (async () => {
    await waitFor(p, () => /ready/i.test(document.getElementById('splitNote').textContent));
    return await p.textContent('#splitNote') || '';
  })();
  if (!/ready/i.test(note)) fail('the page does not confirm it is ready: ' + note);
  if (/restart|reboot|sign out/i.test(note) && !/nothing to restart/i.test(note))
    fail('the page asks for a restart that is not needed: ' + note);
  eq('nothing is offered once it is there', await p.evaluate(() => document.getElementById('getFfmpeg').hidden), true);

  // An attempt that failed is not retried on its own - a machine with no
  // winget would be asked again every time anything looked. The button is
  // how that one is tried again.
  installs = 0;
  state = { ffmpeg: false, winget: false, state: 'failed', detail: 'winget is not available on this PC.' };
  await p.evaluate(() => { ffmpegTried = false; ffmpegHere = null; clearInterval(ffmpegPoll); ffmpegPoll = null; checkFfmpeg(); });
  await p.waitForTimeout(600);
  eq('a failed attempt is not repeated unasked', installs, 0);
  eq('the button is offered instead', await p.evaluate(() => document.getElementById('getFfmpeg').hidden), false);

  await p.click('#getFfmpeg');
  await p.waitForTimeout(300);
  eq('the button tries again', installs, 1);
  state = { ffmpeg: false, winget: false, state: 'failed', detail: 'winget is not available on this PC.' };
  if (!await waitFor(p, () => /winget is not available/.test(document.getElementById('splitNote').textContent)))
    fail('a failed install does not say why: ' + await p.textContent('#splitNote'));
  eq('the offer is still there to try again', await p.evaluate(() => document.getElementById('getFfmpeg').hidden), false);

  // An install the helper started itself, found already running at load: it
  // is followed, not duplicated.
  installs = 0;
  await p.evaluate(() => { ffmpegHere = null; ffmpegTried = false; clearInterval(ffmpegPoll); ffmpegPoll = null; });
  state = { ffmpeg: false, winget: true, state: 'running',
            detail: 'Installing Gyan.FFmpeg.Essentials with winget.' };
  await p.evaluate(() => checkFfmpeg());
  if (!await waitFor(p, () => /winget/i.test(document.getElementById('splitNote').textContent)))
    fail('an install started by the installer is not reported');
  eq('no second install was asked for', installs, 0);
  eq('the offer is hidden while it runs', await p.evaluate(() => document.getElementById('getFfmpeg').hidden), true);
  state = { ffmpeg: true, winget: true, state: 'done', detail: 'ffmpeg is installed and ready.' };
  if (!await waitFor(p, () => /ready/i.test(document.getElementById('splitNote').textContent)))
    fail('the finish of an installer-started fetch is not reported');

  // And where ffmpeg is already present, nothing is offered at all.
  state = { ffmpeg: true, winget: true, state: 'done', detail: '' };
  await p.evaluate(() => checkFfmpeg());
  if (!await waitFor(p, () => document.getElementById('getFfmpeg').hidden))
    fail('the offer shows even though ffmpeg is installed');

  if (errs.length) { bad++; console.log('  FAIL page errors: ' + errs.join('; ')); }
  await b.close(); srv.close();
  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('ffmpeg is fetched as soon as it is found missing, followed to the end, and not retried unasked');
});
