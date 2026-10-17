// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
// Where a sentry clip opens, and whether the panel admits it knows.
//
// The recorder writes "d" as a one-element array - the moment the alert fired.
// This code wanted a [start,end] pair, so a real alert produced no row, no
// jump button and no seek, and nothing here noticed because every test fed it
// the pair it was hoping for. The real file is the first case below.
const fs = require('fs');
const { JSDOM } = require(process.env.NM + '/jsdom');
const PAGE = SRC + '/dashcam-player.html';
const dom = new JSDOM(fs.readFileSync(PAGE, 'utf8'), {
  runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined; w.confirm = () => true;
  } });
const w = dom.window; w.onerror = () => {};

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };
const eq = (what, got, want) => { if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };

setTimeout(() => {
  // The shape of a real info_inner.txt, with the position replaced: the
  // field is never read by any of this, and a recording's coordinates are
  // somebody's actual whereabouts at a known minute. The parliament
  // buildings in Wellington stand in for it.
  const REAL = { t: '2026-10-10_10_56_19', r: 3, l: '-41.288700,174.777200',
                 d: [63432], az: 3 };

  const r = w.eval(`(function(){
    let dur = 0;
    Object.defineProperty(video,'duration',{get:()=>dur,configurable:true});
    const at = (meta, d) => { dur = d; return startPointFor({sentry:true, meta}); };
    const off = meta => alertOffset({sentry:true, meta});
    return {
      real:        at(${JSON.stringify(REAL)}, 123),
      realOffset:  off(${JSON.stringify(REAL)}),
      pair:        at({d:[42000,47000]}, 123),
      pairOffset:  off({d:[42000,47000]}),
      early:       at({d:[1000]}, 123),
      beyond:      at({d:[900000]}, 123),
      noD:         at({}, 123),
      emptyD:      off({d:[]}),
      junkD:       off({d:['x']}),
      negative:    off({d:[-5]}),
      notArray:    off({d:'63432'}),
      backwards:   off({d:[9000,1000]})
    };
  })()`);

  // The real file: an alert 63.4s in, opened two seconds before it.
  eq('real file seeks', r.real, 61.432);
  eq('real file offset', r.realOffset && r.realOffset.at, 63432);
  eq('real file has no end', r.realOffset && r.realOffset.end, null);

  // A pair still reads as a window, for any recorder that writes one.
  eq('a pair still works', r.pair, 40);
  eq('a pair keeps its end', r.pairOffset && r.pairOffset.end, 47000);

  // Nothing sensible to seek to.
  eq('alert near the start', r.early, 0);
  eq('alert past the end', r.beyond, 0);
  eq('no d at all', r.noD, 0);
  eq('empty d', r.emptyD, null);
  eq('junk in d', r.junkD, null);
  eq('negative offset', r.negative, null);
  eq('d not an array', r.notArray, null);
  eq('end before start', r.backwards && r.backwards.end, null);

  // The panel has to show it too - the button is how you get back to the
  // moment after scrubbing away, and it was never being drawn.
  const shown = w.eval(`(function(){
    const s = {sentry:true, name:'2026-10-10_10_56_19_alert_360.mp4',
               meta:${JSON.stringify(REAL)}};
    renderFacts(s);
    const box = document.getElementById('facts');
    const btn = [...box.querySelectorAll('button')]
                .find(b => /jump to the alert/i.test(b.textContent));
    return { text: box.textContent, hasButton: !!btn };
  })()`);
  if (!shown.hasButton) fail('no "Jump to the alert" button for a real alert');
  if (!/Alert at/.test(shown.text)) fail('the panel does not say where the alert is');
  if (!/1:03/.test(shown.text)) fail('the panel does not show 1:03 for 63432 ms');

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('a one-number alert offset seeks, shows and offers the jump button');
  dom.window.close(); process.exit(0);
}, 500);
