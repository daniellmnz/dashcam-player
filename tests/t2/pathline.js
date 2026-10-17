// The path under the picture, and the link that opens it.
//
// The page cannot know where a file is. The File System Access API hands
// over a name and a handle and nothing else - which is why the exporter has
// to go hunting for a file the page can only describe, and why "where is
// this thing?" was, until now, a question the player could not answer.
//
// It can answer it second-hand: the helper searches for the mark the page
// leaves in the open folder and writes down where it found it, and the
// file's own relative path hangs off the end of that. So the two things
// worth testing are that the line is built from those two pieces and not
// from a guess, and that it says less rather than more when the helper has
// not answered - a path that is wrong is worse than a path that is partial.
const fs = require('fs');
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

const PAGE = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = PAGE.match(/DCP_VERSION="([0-9.]+)"/)[1];

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

// What the helper says about the open folder, and everything the page asked.
let located = null;           // null = still looking
const asked = [];

const dom = new JSDOM(PAGE.replace('__DCP_TOKEN__', 'x'.repeat(64)).replace('__DCP_SRVVER__', VER), {
  runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = (path, opts) => {
      asked.push({ path: String(path), headers: (opts || {}).headers || {} });
      if (/^\/locate-status/.test(path)) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve(located
            ? { state: 'found', dir: located }
            : { state: 'looking' })
        });
      }
      if (/^\/reveal-file/.test(path)) {
        return Promise.resolve({ ok: revealWorks, headers: { get: () => 'text/plain' },
                                 text: () => Promise.resolve(revealWorks ? 'ok' : 'not found') });
      }
      return Promise.reject(new Error('x'));
    };
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined;
  } });
let revealWorks = true;
const w = dom.window; w.onerror = () => {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const line = () => w.document.getElementById('pathLine');
const linkEl = () => w.document.getElementById('pathOpen');

// One recording, wherever it sits inside the folder that was opened.
function put(rel) {
  const name = rel.split('/').pop();
  w.eval(`
    segments.length = 0;
    segments.push({ name:${JSON.stringify(name)}, status:'ok', start:1, session:'s',
      view:null, missing:false, flat:false, sidecar:null, seconds:60,
      file:{ size:10, name:${JSON.stringify(name)}, relPath:${JSON.stringify(rel)} } });
    current = 0;
    renderPathLine(segments[0]);
  `);
}

(async () => {
  await sleep(300);

  if (typeof w.renderPathLine !== 'function') {
    fail('there is no path under the picture at all');
    console.log(`FAIL: ${bad} problem(s)`); w.close(); process.exit(1);
  }

  // --- before the helper has answered ----------------------------------
  // All that can honestly be said is where the file sits INSIDE the folder
  // that was opened. Said plainly, and not as a link: there is nowhere for
  // a link to go.
  put('Movies/a_surround.mp4');
  const partial = line();
  if (partial.hidden) fail('nothing is shown while the folder is still being located');
  if (!/Movies\\a_surround\.mp4/.test(partial.textContent))
    fail('the path within the folder is not shown: ' + partial.textContent);
  if (!/finding full file path/i.test(partial.textContent))
    fail('a partial path is not marked as one still being worked out: ' + partial.textContent);
  if (linkEl()) fail('a link is offered with nowhere to send it');
  // And nothing invented: no drive letter, no backslash at the front.
  if (/^[A-Za-z]:\\/.test(partial.textContent.trim()))
    fail('a path on disk was made up before the helper said anything: ' + partial.textContent);

  // --- once the helper has answered ------------------------------------
  located = 'F:\\DCIM';
  w.eval('forgetRootPath()');
  await w.eval('ensureRootPath()');
  put('Movies/a_surround.mp4');
  const a = linkEl();
  if (!a) fail('the full path is not a link once the folder is known');
  else {
    if (a.textContent !== 'F:\\DCIM\\Movies\\a_surround.mp4')
      fail('the full path is not the folder plus the file: ' + a.textContent);
    if (!(a.title || '').trim()) fail('the link does not say what it does');
  }

  // A folder opened at the root of a card ends in a separator already.
  located = 'F:\\';
  w.eval('forgetRootPath()');
  await w.eval('ensureRootPath()');
  put('DCIM/a_surround.mp4');
  if (linkEl() && linkEl().textContent !== 'F:\\DCIM\\a_surround.mp4')
    fail('a folder ending in a separator doubles it: ' + linkEl().textContent);

  // A file with no folder under the opened one - picked on its own.
  located = 'F:\\DCIM';
  w.eval('forgetRootPath()');
  await w.eval('ensureRootPath()');
  put('a_surround.mp4');
  if (linkEl() && linkEl().textContent !== 'F:\\DCIM\\a_surround.mp4')
    fail('a file at the top of the folder is given the wrong path: ' + linkEl().textContent);

  // --- what the click sends --------------------------------------------
  // A name and a folder WITHIN the located one, and the token. Never a path:
  // the page has none, and the helper will not take one.
  put('Movies/a_surround.mp4');
  asked.length = 0;
  linkEl().dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(150);
  const req = asked.find(x => /^\/reveal-file/.test(x.path));
  if (!req) fail('clicking the path asks the helper for nothing');
  else {
    const q = req.path;
    if (!/[?&]name=a_surround\.mp4\b/.test(q)) fail('the request does not name the file: ' + q);
    if (!/[?&]dir=Movies\b/.test(q)) fail('the request does not say which folder: ' + q);
    if (/F%3A|F:|%5C|\\/.test(q)) fail('the page sent a path on disk, which it must never do: ' + q);
    if (!req.headers['X-Dashcam-Token'])
      fail('the request goes without the token, so any page could ask for it');
  }

  // --- when the helper cannot find it ----------------------------------
  // The path stays - it is still the best answer to "where is this file" -
  // but it stops pretending to be a link that works.
  revealWorks = false;
  put('Movies/a_surround.mp4');
  const dead = linkEl();
  dead.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(150);
  if (!/could not be opened/i.test(line().textContent))
    fail('a link that did nothing says nothing: ' + line().textContent);
  if (!/a_surround\.mp4/.test(line().textContent))
    fail('the path was taken away when the link failed: ' + line().textContent);
  revealWorks = true;

  // --- a different folder is a different place -------------------------
  // The helper's answer is about ONE folder. Carried over, the line would
  // name the last card while showing this one's recordings - which is the
  // one failure that would be believed, because it looks like a path.
  //
  // Opened for real rather than by resetting the variable by hand: the thing
  // being tested is that OPENING a folder forgets the last one, and a test
  // that clears it itself would pass with that step missing.
  located = 'F:\\DCIM';
  w.eval('forgetRootPath()');
  await w.eval('ensureRootPath()');
  if (!w.eval('rootPath')) fail('the helper\'s answer was not remembered at all');
  // A handle with nothing on it: the read fails, which is beside the point -
  // the folder has still been opened, and that is what must forget.
  await w.eval('openHandle({name:"OtherCard"}).catch(()=>{})');
  await sleep(120);
  if (w.eval('rootPath'))
    fail('opening another folder kept the last one\'s path: ' + w.eval('rootPath'));
  located = null;
  put('Movies/a_surround.mp4');
  if (linkEl()) fail('the previous folder\'s path is still being shown: ' + linkEl().textContent);
  if (!/finding full file path/i.test(line().textContent))
    fail('after changing folder the line does not fall back to the partial path');

  // --- the picture still fits ------------------------------------------
  // The line sits in the same block as the picture and the transport row,
  // inside a stage that hides anything which overflows. Left out of the sum,
  // it takes its height off the bottom of the video instead.
  const sizer = PAGE.match(/function canvasBox\(\)\{[\s\S]*?\n\}/);
  if (!sizer) fail('the page no longer works out how much room the picture has');
  else if (!/pathLine/.test(sizer[0]))
    fail('the room left for the picture does not allow for the path beneath it');

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); w.close(); process.exit(1); }
  console.log('the path under the picture is built from what the helper found, and opens the file');
  w.close(); process.exit(0);
})();
