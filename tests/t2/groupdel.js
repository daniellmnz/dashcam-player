// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
// A tick box beside each group heading, so a whole day can be removed without
// ticking nine files. Driven through the SHIPPED page: the list is rendered
// for real and the boxes are clicked, rather than the logic being retyped here.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.NM + '/jsdom');

const html = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8')
  .replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', (fs.readFileSync(SRC + '/dashcam-player.html','utf8').match(/DCP_VERSION="([0-9.]+)"/)||[,'0'])[1]);
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    // The page talks to its helper and draws on a canvas; neither exists here,
    // and an unhandled failure in either leaves the script half-run.
    w.fetch = () => Promise.reject(new Error('no helper'));
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined; w.confirm = () => true;
  } });
const w = dom.window; w.onerror = () => {};

let bad = 0;
function run() {
const fail = m => { bad++; console.log('  FAIL ' + m); };
const eq = (what, got, want) => { if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };

// Two days, nine files and three, plus one with no handle behind it.
function seg(session, n, day) {
  const name = `2026100${day}_1${String(n).padStart(2,'0')}601_surround.mp4`;
  return { session, name, number: n, status: 'ok', missing: false,
           start: Date.UTC(2026, 9, day, 1 + n), dur: 600,
           file: { size: 44e7, relPath: name, name } };
}
const segs = [];
for (let i = 0; i < 9; i++) segs.push(seg('Dashcam video — Fri, 9 Oct 2026', i, 9));
for (let i = 0; i < 3; i++) segs.push(seg('Dashcam video — Thu, 8 Oct 2026', i, 8));

w.eval(`
  segments = ${JSON.stringify(segs)};
  dirHandle = { name: 'EVCam_Video' };
  dirHandles = { '': dirHandle };
  picked.clear();
  collapsed.clear();
  renderList();
`);

const doc = w.document;
const groups = () => [...doc.querySelectorAll('.sesspick')];
// By heading, because the order of the list is a preference, not a promise.
function groupFor(day) {
  const row = [...doc.querySelectorAll('.sessrow')]
    .find(r => (r.textContent || '').includes(day));
  if (!row) { fail('no group heading for ' + day); return null; }
  const cb = row.querySelector('.sesspick');
  if (!cb) fail('no tick box on the ' + day + ' heading');
  return cb;
}
const DAY9 = 'Fri, 9 Oct 2026', DAY8 = 'Thu, 8 Oct 2026';
const files  = () => [...doc.querySelectorAll('.segpick')];
const delBtn = () => doc.getElementById('delSel');
// The button keeps its place at the foot of the rail whether or not anything
// is ticked, so "showing" is the idle class, not the hidden attribute.
const idle = () => doc.getElementById('railfoot').classList.contains('idle');

eq('group tick boxes', groups().length, 2);
eq('file tick boxes', files().length, 12);
eq('nothing picked yet', idle(), true);
eq('and the button is dead', delBtn().disabled, true);

// A group heading must sit in a row with its tick box, not inside the button.
const row = doc.querySelector('.sessrow');
if (!row) fail('no .sessrow wrapper');
else {
  if (!row.querySelector('.sess')) fail('the heading is not inside the row');
  if (row.querySelector('.sess input')) fail('the tick box is inside the heading button');
  if (row.firstElementChild.className !== 'sesspick') fail('the tick box is not first in the row');
}

// Tick the first group: all nine of its files, and none of the other day's.
const g0 = groupFor(DAY9);
g0.checked = true; g0.dispatchEvent(new w.Event('change'));
eq('files picked by the group', files().filter(c => c.checked).length, 9);
eq('delete button text', delBtn().textContent, 'Delete 9 selected files');
eq('delete button live', idle(), false);
eq('and enabled', delBtn().disabled, false);
eq('other group untouched', groupFor(DAY8).checked, false);

// Untick one file: the group goes part-ticked, not off.
const first = files().find(c => c.checked);
first.checked = false; first.dispatchEvent(new w.Event('change'));
eq('group no longer fully ticked', groupFor(DAY9).checked, false);
eq('group is part-ticked', groupFor(DAY9).indeterminate, true);
eq('eight left', delBtn().textContent, 'Delete 8 selected files');

// Put it back: fully ticked again, and not part-ticked.
first.checked = true; first.dispatchEvent(new w.Event('change'));
eq('group ticked again', groupFor(DAY9).checked, true);
eq('not part-ticked', groupFor(DAY9).indeterminate, false);

// Unticking the group clears only its own files.
const g8 = groupFor(DAY8);
g8.checked = true; g8.dispatchEvent(new w.Event('change'));
eq('all twelve', delBtn().textContent, 'Delete 12 selected files');
g0.checked = false; g0.dispatchEvent(new w.Event('change'));
eq('only the other day left', delBtn().textContent, 'Delete 3 selected files');
eq('other day still ticked', groupFor(DAY8).checked, true);

// It has to work while the group is collapsed - that is the point of it.
w.eval(`picked.clear(); collapsed.add(segments[0].session); renderList();`);
eq('collapsed group still has a box', groups().length, 2);
eq('its files are not on screen', files().length, 3);
const gc = groupFor(DAY9);
gc.checked = true; gc.dispatchEvent(new w.Event('change'));
eq('collapsed group selects its nine', delBtn().textContent, 'Delete 9 selected files');

// The selection survives a re-render, and the heading comes back ticked.
w.eval('renderList();');
eq('still ticked after a re-render', groupFor(DAY9).checked, true);
eq('still nine', delBtn().textContent, 'Delete 9 selected files');

// With no folder handle nothing may be offered - there is nothing to delete
// through, exactly as for the per-file boxes.
w.eval(`picked.clear(); collapsed.clear(); dirHandle = null; renderList();`);
eq('no group boxes without a folder', groups().length, 0);
eq('no file boxes without a folder', files().length, 0);

if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
console.log('a group heading selects and clears its own day, collapsed or not');
dom.window.close();
process.exit(0);
}
setTimeout(run, 500);
