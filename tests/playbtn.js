// The play and pause button, measured in a real browser.
//
// It carries a drawn shape rather than the words "Play" and "Pause". Two
// things about that cannot be checked by reading the source: whether the
// right shape is actually PAINTED - the first attempt hid one path with the
// "hidden" attribute, which is an HTML attribute and does nothing at all on
// an SVG path, so both shapes were drawn on top of each other and the button
// looked like Play while the video ran - and whether the button keeps its
// width as it toggles, since the two shapes are not the same width and the
// row beside it must not shuffle every time the video is paused.
const { chromium } = require(process.env.NM + '/playwright-core');
// Where that browser is. A clone of this repository has no browser at
// the path this was developed against - playwright-core deliberately
// downloads none - so the runner passes one in and this falls back for
// anyone running the file directly.
const CHROMIUM = process.env.DCP_CHROMIUM || '/opt/pw-browsers/chromium';
const fs = require('fs');
const path = require('path');
const SRC = process.env.DCP_SRC || path.resolve(__dirname, '..', 'src');

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));

  const html = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8')
    .replace('__DCP_TOKEN__', 'a'.repeat(64)).replace('__DCP_SRVVER__', '0.0.0');
  await page.setContent(html);
  await page.evaluate(() => {
    document.getElementById('transport').hidden = false;
    document.getElementById('scrub').hidden = false;
  });
  await page.waitForTimeout(150);

  // No words left on it.
  const text = (await page.textContent('#play') || '').trim();
  if (/play|pause/i.test(text)) fail('the button still carries a word: ' + JSON.stringify(text));

  // What is actually painted. The shapes are measured by their own bounding
  // boxes: a path that is not displayed has none.
  const shapes = async () => page.evaluate(() => {
    const out = {};
    for (const [k, sel] of [['play', '#play .gplay'], ['pause', '#play .gpause']]) {
      const el = document.querySelector(sel);
      out[k] = !!(el && el.getBoundingClientRect().width > 0 &&
                  getComputedStyle(el).display !== 'none');
    }
    const b = document.getElementById('play');
    out.w = Math.round(b.getBoundingClientRect().width);
    out.label = b.getAttribute('aria-label');
    out.title = b.title;
    return out;
  });

  const paused = await shapes();
  if (!paused.play) fail('the play shape is not painted while the video is paused');
  if (paused.pause) fail('the pause shape is painted as well, so the two overlap');
  if (paused.label !== 'Play') fail('a screen reader is told "' + paused.label + '" while paused');
  if (!/space/i.test(paused.title)) fail('the tooltip no longer gives the shortcut: ' + paused.title);

  // Now with the video running. Driven through the real handler, so the
  // element's own state is what decides - the same path the space bar takes.
  await page.evaluate(() => {
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
    syncPlayButton();
  });
  await page.waitForTimeout(80);

  const playing = await shapes();
  if (!playing.pause) fail('the pause shape is not painted while the video runs');
  if (playing.play) fail('the play shape is still painted while the video runs');
  if (playing.label !== 'Pause') fail('a screen reader is told "' + playing.label + '" while playing');

  // The width must not change between the two, or everything to the right of
  // it moves every time you press space.
  if (paused.w !== playing.w)
    fail(`the button changes width between play and pause: ${paused.w} then ${playing.w}`);

  // And back again: a one-way swap would be worse than none.
  await page.evaluate(() => {
    Object.defineProperty(video, 'paused', { configurable: true, get: () => true });
    syncPlayButton();
  });
  await page.waitForTimeout(80);
  const again = await shapes();
  if (!again.play || again.pause) fail('the shape does not go back when the video is paused again');

  if (errs.length) fail('page errors: ' + errs.join('; '));
  await browser.close();

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('the play and pause shapes are drawn, swap over, and keep the button the same width');
  process.exit(0);
})();
