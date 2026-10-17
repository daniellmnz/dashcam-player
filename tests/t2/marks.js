// The dot beside a row, and what it says when you hover it.
//
// The dots went through a green-on-everything phase that told nobody
// anything, then a faults-only phase, then away altogether. They are back
// on every row, and the rule that makes them worth having is that each one
// answers for itself: hover any dot and a sentence says why it is that
// colour. A dot that draws the eye and then refuses to explain is the one
// thing this must not become, so every state is checked for a real
// explanation - not merely for having a title attribute.
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
  w.eval(`
    // Distinct, descending times: the list groups by session as it walks the
    // rows, so segments of one session have to be contiguous, as real ones are.
    let when=Date.now();
    const mk=(name,extra)=>Object.assign({
      name, status:'ok', start:(when-=60000), session:'s', view:null, missing:false,
      file:{size:1000,relPath:name,name}, sentry:false, meta:null,
      sidecar:{recordingSessionId:'s'}
    }, extra||{});
    segments.length=0;
    segments.push(mk('plain.mp4'));                                   // 0
    segments.push(mk('broken.mp4',{sidecar:{recordingSessionId:'s',result:'FAILED'}}));   // 1
    segments.push(mk('nosidecar.mp4',{sidecar:null}));                // 2
    const SENTRY='Sentry alerts \u2014 Sat';
    segments.push(mk('20261010_140247_alert_surround.mp4',{sentry:true,session:SENTRY}));  // 3
    segments.push(mk('alertbroken.mp4',{sentry:true,session:SENTRY,
                     sidecar:{recordingSessionId:'s',result:'FAILED'}}));                   // 4
    renderList();
  `);

  // Found by the index each row carries, not by position: the list shows the
  // newest first, so the rows come back in the opposite order to the array.
  // Found by the index each row carries, not by position: the list shows the
  // newest first, so the rows come back in the opposite order to the array.
  // Found by the index each row carries, not by position: the list shows the
  // newest first, so the rows come back in the opposite order to the array.
  const rows = [...w.document.querySelectorAll('.seg')];
  const row = i => w.document.querySelector(`.seg[data-i="${i}"]`);
  if (rows.length !== 5) {
    fail(`expected 5 rows, found ${rows.length}`);
  } else {
    const plain = row(0), broken = row(1), noSidecar = row(2), sentry = row(3), both = row(4);
    const mark = r => r.querySelector('.mark');
    const why = r => ((mark(r) || {}).title || '').trim();

    // Every row has a dot, and every dot explains itself in a sentence that
    // reads on its own. A bare code like "FAILED" is what this replaces.
    for (const [r, what] of [[plain, 'a healthy recording'], [broken, 'a failed recording'],
                             [noSidecar, 'a recording with no sidecar'], [sentry, 'a sentry event'],
                             [both, 'a failed sentry event']]) {
      if (!mark(r)) { fail(what + ' has no dot'); continue; }
      const t = why(r);
      if (!t) fail(what + ' has a dot that says nothing');
      else if (t.split(/\s+/).length < 4) fail(what + ' has a dot that only mutters: ' + t);
    }

    // The colours still mean what they did.
    if (!/\bok\b/.test(mark(plain).className)) fail('a healthy recording is not marked healthy: ' + mark(plain).className);
    if (!/\bbad\b/.test(mark(broken).className)) fail('a broken recording is not marked: ' + mark(broken).className);
    if (!/\bbad\b/.test(mark(both).className))
      fail('a broken sentry recording hides its fault behind the accent: ' + mark(both).className);

    // A missing sidecar is not a fault and must not be coloured as one. It
    // is the ordinary state of every recording from one of the two
    // recorders, so its dot says that rather than implying something broke.
    if (/\b(warn|bad)\b/.test(mark(noSidecar).className))
      fail('a missing sidecar is marked as a fault: ' + mark(noSidecar).className);
    if (!/\bnone\b/.test(mark(noSidecar).className))
      fail('a missing sidecar is marked as a clean bill of health: ' + mark(noSidecar).className);
    if (!/no report|no data file|writes no/i.test(why(noSidecar)))
      fail('the dot does not explain what a missing sidecar means: ' + why(noSidecar));

    // The failed recording says what the recorder said, not just that
    // something is wrong.
    if (!/FAILED/.test(why(broken))) fail('the fault is not named: ' + why(broken));

    // A sentry event is the thing you came looking for, and it is said in
    // the colour of the row and of its heading - not in the dot, which is
    // busy reporting health.
    if (!/\bsentry\b/.test(sentry.className))
      fail('a sentry row is not marked as one: ' + sentry.className);
    if (/\balert\b/.test(mark(sentry).className))
      fail('a sentry row carries a dot as well as its colour: ' + mark(sentry).className);
    const head = w.document.querySelector('.sess.alert');
    if (!head) fail('the sentry group heading is not marked');
    else if (!/sentry/i.test(head.textContent)) fail('the wrong group is marked: ' + head.textContent.trim());
    const heads = [...w.document.querySelectorAll('.sess')];
    if (heads.filter(h => /\balert\b/.test(h.className)).length !== 1)
      fail('more than one group heading is marked as sentry');

    // The fault is not also written into the row text: the dot reports it
    // now, and saying it twice is how a list turns into a wall.
    const says = r => (r.querySelector('.d') || {}).textContent || '';
    if (/failed/i.test(says(broken))) fail('the fault is reported twice: ' + says(broken));
  }

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('every dot explains itself, and a sentry event is still said in its colour');
  dom.window.close(); process.exit(0);
}, 500);
