// The day-group expander arrows.
//
// Asked for at twice the size of the text beside them. The catch with a
// bigger glyph in a line of small text is that it grows the line, which
// pushes every group heading down and costs more room than the arrow is
// worth - so the size and the row height are measured together, in a real
// browser, both open and shut.
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

const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ping') { res.writeHead(200); return res.end(); }
  if (u === '/version') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(VER); }
  if (u === '/ffmpeg') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ffmpeg":true,"winget":true,"state":"done","detail":""}');
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fs.readFileSync(PAGE, 'utf8')
            .replace('__DCP_TOKEN__', 'x'.repeat(64))
            .replace('__DCP_SRVVER__', VER));
});

srv.listen(8807, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 700 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8807/'); await p.waitForTimeout(600);

  // Three days of recordings, so there are group headings to expand.
  await p.evaluate(() => {
    segments.length = 0;
    for (let d = 0; d < 3; d++) for (let i = 0; i < 3; i++) {
      const t = new Date(2026, 9, 8 + d, 13, 0, i * 10);
      segments.push({ name: `2026100${8 + d}_1300${i}0_surround.mp4`, status: 'ok',
                      start: t.getTime(), session: 's' + d, view: null,
                      file: { size: 1000, relPath: 'x.mp4', name: 'x.mp4' }, sidecar: null });
    }
    document.getElementById('dropzone').style.display = 'none';
    renderList();
  });
  await p.waitForTimeout(250);

  const measure = () => p.evaluate(() => {
    const c = document.querySelector('.sess .caret');
    const h = c.closest('.sess');
    return { caret: parseFloat(getComputedStyle(c).fontSize),
             text:  parseFloat(getComputedStyle(h).fontSize),
             width: c.getBoundingClientRect().width,
             row:   h.getBoundingClientRect().height,
             glyph: c.textContent };
  });

  const open = await measure();
  if (Math.abs(open.caret - open.text * 2) > 0.5)
    fail(`the arrow is ${open.caret}px beside ${open.text}px text, wanted twice the text`);
  if (open.width < open.caret * 0.6)
    fail(`the arrow has ${open.width}px of width for a ${open.caret}px glyph, so it will be clipped`);

  // The row must be the height it would be with a small arrow: a taller line
  // here pushes the whole list down.
  const rowWithSmall = await p.evaluate(() => {
    const c = document.querySelector('.sess .caret');
    const was = c.style.cssText;
    c.style.fontSize = getComputedStyle(c.closest('.sess')).fontSize;
    const h = c.closest('.sess').getBoundingClientRect().height;
    c.style.cssText = was;
    return h;
  });
  if (Math.abs(open.row - rowWithSmall) > 0.5)
    fail(`the bigger arrow grew the heading from ${rowWithSmall}px to ${open.row}px`);

  // And the same when the group is shut, which is a different glyph.
  await p.click('.sess');
  await p.waitForTimeout(200);
  const shut = await measure();
  if (shut.glyph === open.glyph) fail('the arrow does not change when the group is shut');
  if (Math.abs(shut.caret - open.caret) > 0.5)
    fail(`the shut arrow is ${shut.caret}px, the open one ${open.caret}px`);
  if (Math.abs(shut.row - open.row) > 0.5)
    fail(`shutting the group changed the heading height: ${open.row} then ${shut.row}`);

  if (errs.length) { bad++; console.log('  FAIL page errors: ' + errs.join('; ')); }
  await b.close(); srv.close();
  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log(`the expander arrows are ${open.caret}px beside ${open.text}px text, and the headings did not grow`);
});
