// What the folder scan finds, and what it leaves alone.
//
// On a card opened at its root the scan confines itself to the recorder's own
// folders - DCIM and SentryMode - so that a drive full of other things is not
// trawled. Moving the exports to the top of the card put them outside that
// fence, and split files stopped appearing in the list the moment they were
// made. Nothing here covered the walk at all, which is why.
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

setTimeout(async () => {
  // A directory handle over a plain object: { name: null } is a file,
  // { name: {...} } is a folder.
  w.eval(`
    window.__tree = tree => {
      const dir = (name, node) => ({
        kind:'directory', name,
        async *values(){
          for (const [k,v] of Object.entries(node)) {
            yield v === null
              ? { kind:'file', name:k, getFile: async () => ({ name:k, size:1 }) }
              : dir(k, v);
          }
        }
      });
      return dir('root', tree);
    };
  `);

  const scan = async tree => {
    w.__scanTree = tree;
    const out = await w.eval(`filesFromHandle(window.__tree(window.__scanTree))`);
    return out.map(f => f.relPath).sort();
  };

  // A card as it really is: the recorder's folders, the exports the tools
  // write, and a pile of things that are none of our business.
  const card = {
    'DCIM': { 'EVCam_Video': { 'a_surround.mp4': null, 'a_surround.json': null } },
    'SentryMode': { '2026-10-10_11_01_43': { 'alert_360.mp4': null, 'info_inner.txt': null } },
    'Dashcam and Sentry exports': {
      'split': { 'a_surround_Front.mp4': null },
      'rectified': { 'a_surround_Front.mp4': null },
      'snapshots': { 'a_surround_Front_2m33s.jpg': null }
    },
    'Holiday photos': { 'beach.mp4': null },
    '$RECYCLE.BIN': { '$RJUNK.mp4': null },
    'System Volume Information': { 'x.mp4': null }
  };
  const got = await scan(card);

  const wants = [
    ['DCIM/EVCam_Video/a_surround.mp4', 'the recordings'],
    // The sidecar is what carries the lane layout, the true duration and the
    // frame health. Collected by the same walk as the video, so a fence that
    // misses it leaves every recording reading "No sidecar" with no error.
    ['DCIM/EVCam_Video/a_surround.json', 'the sidecars beside them'],
    ['SentryMode/2026-10-10_11_01_43/info_inner.txt', 'the sentry event data'],
    ['SentryMode/2026-10-10_11_01_43/alert_360.mp4', 'sentry clips'],
    ['Dashcam and Sentry exports/split/a_surround_Front.mp4', 'files the split tool wrote'],
    ['Dashcam and Sentry exports/rectified/a_surround_Front.mp4', 'files the fisheye tool wrote']
  ];
  for (const [path, what] of wants)
    if (!got.includes(path)) fail(`${what} are not found: ${path}`);

  const nevers = [
    ['Holiday photos/beach.mp4', 'unrelated video on the drive'],
    ['$RECYCLE.BIN/$RJUNK.mp4', 'deleted recordings in the recycle bin'],
    ['System Volume Information/x.mp4', 'system folders']
  ];
  for (const [path, what] of nevers)
    if (got.includes(path)) fail(`${what} should be left alone: ${path}`);

  // A folder picked from inside the recordings is scanned as it stands.
  const inside = await scan({ 'a_surround.mp4': null, 'sub': { 'b_surround.mp4': null } });
  if (!inside.includes('a_surround.mp4') || !inside.includes('sub/b_surround.mp4'))
    fail('a folder opened directly is not scanned: ' + JSON.stringify(inside));

  // And with no recorder folders present, the exports folder alone must not
  // fence the scan off from everything else.
  const loose = await scan({
    'a_surround.mp4': null,
    'Dashcam and Sentry exports': { 'split': { 'a_surround_Front.mp4': null } }
  });
  if (!loose.includes('a_surround.mp4'))
    fail('recordings beside an exports folder are missed: ' + JSON.stringify(loose));
  if (!loose.includes('Dashcam and Sentry exports/split/a_surround_Front.mp4'))
    fail('the exports are missed when there is no DCIM: ' + JSON.stringify(loose));

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('the scan finds the recordings and everything the tools wrote, and nothing else');
  dom.window.close(); process.exit(0);
}, 500);
