// The file list must never scroll sideways.
//
// Two things conspired to put a horizontal scrollbar under it, and both are
// checked here because either one alone brings it back.
//
// First, the box said "overflow-y:auto" and said nothing about the other
// axis - which does NOT leave it visible. CSS computes the other axis to
// auto whenever one of them is auto or scroll, so the list had a horizontal
// scrollbar waiting for the first row that did not fit.
//
// Second, a row that did not fit. Two rules now stop that, and each was
// measured to be sufficient on its own: the grid track can shrink, and the
// cell inside it clips with an ellipsis. Kept together because without the
// second the text is cut mid-character at the rail's edge.
//
// The row that did not fit: The row is a grid of three columns and the
// last of them - the duration and size - is nowrap in an "auto" track, which
// refuses to size below its max-content width. A long one, as a sentry row
// has ("alert - 10:00 - 1.08 GB"), pushed the whole row wider than the rail
// instead of being trimmed. It fitted on the machine it was written on and
// did not on a laptop, where the monospace font is wider.
//
// So the row is measured with the hidden axis deliberately turned back ON:
// hiding an overflow is not the same as not having one, and a test that only
// checked for the scrollbar would pass while the names were being cut off.
//
// A layout question, so it is measured in a real browser.
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', 'src');
const http = require('http'), fs = require('fs');
const { chromium } = require(process.env.NM + '/playwright-core');
// Where that browser is. A clone of this repository has no browser at
// the path this was developed against - playwright-core deliberately
// downloads none - so the runner passes one in and this falls back for
// anyone running the file directly.
const CHROMIUM = process.env.DCP_CHROMIUM || '/opt/pw-browsers/chromium';
const PAGE = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = PAGE.match(/DCP_VERSION="([0-9.]+)"/)[1];
const BODY = PAGE.replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', VER);

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ping') { res.writeHead(200); return res.end(); }
  if (u === '/version') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(VER); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(BODY);
}).listen(8913);

// A list like a real card: a day of recordings, a rectified export with a
// long name, and a sentry row, whose size column is the longest of the lot.
const FILL = () => {
  const mk = (n, extra) => Object.assign({
    name: n, status: 'ok', start: Date.now() - Math.random() * 8.64e7,
    session: 'Dashcam video — Wed, 14 Oct 2026', view: null, missing: false,
    flat: false, sidecar: null, seconds: 600,
    file: { size: 1.16e9, relPath: 'DCIM/EVCam_Video/' + n, name: n } }, extra || {});
  segments.length = 0;
  for (let i = 0; i < 16; i++) segments.push(mk(`2026101${i % 10}_1${i}0308_surround.mp4`));
  segments.push(mk('20261013_14_00_43_alert_360_Right_rectified.mp4',
    { session: 'Rectified video — Tue, 13 Oct 2026', view: 'Right', flat: true }));
  segments.push(mk('20261013_140043_alert_360.mp4',
    { session: 'Sentry alerts — Tue, 13 Oct 2026', sentry: true }));
  // The row this was reported on: a sentry alert, whose first cell carries
  // nothing but a time. It is the SHORTEST first cell in the list, which is
  // what made it the one to fail - the track it sat in was the one that got
  // starved, and a cell with nothing to trim had nowhere to put the
  // difference but on top of its neighbour.
  segments.push(mk('20261015_145435_alert_360.mp4',
    { session: 'Sentry alerts — Thu, 15 Oct 2026', sentry: true, seconds: 120,
      file: { size: 121.1e6, relPath: 'SentryMode/20261015_145435_alert_360.mp4',
              name: '20261015_145435_alert_360.mp4' } }));
  prefs.showNames = true;
  renderList();
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM,
                                          args: ['--no-sandbox'] });
  // The last two are the laptop: a narrower rail, and a wider monospace font
  // than the box this is built in has. Either is enough on its own.
  const CASES = [
    ['as built', null],
    ['a narrower rail', '.shell{grid-template-columns:280px minmax(0,1fr)!important}'],
    ['a wider monospace font', '.seg .t,.seg .d{font-size:16px!important}'],
    ['both at once', '.shell{grid-template-columns:280px minmax(0,1fr)!important}'
                   + '.seg .t,.seg .d{font-size:16px!important}'],
  ];

  for (const [label, squeeze] of CASES) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
    await page.goto('http://localhost:8913/');
    await page.waitForTimeout(350);
    if (squeeze) await page.addStyleTag({ content: squeeze });
    await page.evaluate(FILL);
    await page.waitForTimeout(200);

    const got = await page.evaluate(() => {
      const wrap = document.getElementById('list');
      const cs = getComputedStyle(wrap);
      // Turn the hidden axis back on, so what is measured is whether the
      // CONTENT fits - not whether hiding it covers up that it does not.
      const was = wrap.style.overflowX;
      wrap.style.overflowX = 'auto';
      const content = { client: wrap.clientWidth, scroll: wrap.scrollWidth };
      const rows = [...wrap.querySelectorAll('.seg')]
        .filter(r => r.scrollWidth > r.clientWidth + 0.5)
        .map(r => ({ w: r.scrollWidth, c: r.clientWidth,
                     text: (r.textContent || '').trim().slice(0, 40) }));
      // A cell that cannot fit its text has to CLIP it. Not fitting is fine
      // and expected on a narrow rail; what is not fine is painting the
      // overflow across the cell beside it, which leaves two texts on top of
      // each other and no scrollbar to show for it.
      const spill = [];
      for (const r of wrap.querySelectorAll('.seg')) {
        for (const sel of ['.t', '.d', '.f']) {
          const c = r.querySelector(sel);
          if (!c) continue;
          if (c.scrollWidth <= c.clientWidth + 0.5) continue;
          const st = getComputedStyle(c);
          if (st.overflowX === 'visible')
            spill.push({ sel, over: Math.round(c.scrollWidth - c.clientWidth),
                         text: (c.textContent || '').trim().slice(0, 30) });
        }
      }
      wrap.style.overflowX = was;
      return { overflowX: cs.overflowX, content, rows, spill,
               barNow: wrap.scrollWidth > wrap.clientWidth };
    });

    // The axis is said out loud, so no row can ever put a bar there.
    if (got.overflowX !== 'hidden')
      fail(`${label}: the list's horizontal axis is "${got.overflowX}", not hidden - `
         + 'one over-wide row away from a scrollbar');
    if (got.barNow)
      fail(`${label}: the list is scrolling sideways`);
    // And the rows fit on their own, so nothing is being quietly cut off.
    if (got.content.scroll > got.content.client + 0.5)
      fail(`${label}: the list's content is ${got.content.scroll}px wide in a `
         + `${got.content.client}px rail, so it is only hidden, not fitting`);
    for (const r of got.rows)
      fail(`${label}: a row is ${r.w}px in a ${r.c}px list - "${r.text}"`);
    for (const c of got.spill)
      fail(`${label}: ${c.sel} overflows its cell by ${c.over}px without clipping, `
         + `so it is drawn over the one next to it - "${c.text}"`);

    await page.close();
  }

  await browser.close(); srv.close();
  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('the file list fits its rail and never scrolls sideways, however the font falls');
  process.exit(0);
})();
