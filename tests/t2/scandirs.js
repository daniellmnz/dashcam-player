// The folders a drive is scanned for are a setting.
//
// Two recorders are in use and they do not agree: one writes DCIM and
// SentryMode, the other a folder called Movies. A constant list meant the
// second one's recordings were invisible on a card opened at its root - no
// error, no empty-folder message, just a list with nothing in it. This runs
// the real scan against both shapes and against a name only the setting
// knows about.
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

  // What the player ships with. Passed explicitly where it matters: the
  // helper below leaves the setting alone when it is given nothing, so a case
  // written that way would run with whatever the case before it set.
  const DEFAULT_SETTING = w.eval(`DEFAULTS.prefs.scanDirs`);

  const scan = async (tree, setting) => {
    w.__scanTree = tree;
    if (setting !== undefined) w.eval(`prefs.scanDirs = ${JSON.stringify(setting)}`);
    const out = await w.eval(`filesFromHandle(window.__tree(window.__scanTree))`);
    return out.map(f => f.relPath).sort();
  };

  // The second recorder: video and sidecars together in Movies, with the
  // usual pile of unrelated things beside it.
  const movieCard = {
    'Movies': { '2026-10-11_14-22-05.mp4': null, '2026-10-11_14-22-05.json': null },
    'Holiday photos': { 'beach.mp4': null },
    'System Volume Information': { 'x.mp4': null }
  };
  const got = await scan(movieCard, undefined);
  for (const p of ['Movies/2026-10-11_14-22-05.mp4', 'Movies/2026-10-11_14-22-05.json'])
    if (!got.includes(p)) fail('the default list does not include Movies: ' + JSON.stringify(got));
  if (got.includes('Holiday photos/beach.mp4'))
    fail('a Movies card is not fenced: ' + JSON.stringify(got));

  // Both recorders on one drive, which is the case that made this a setting.
  const both = await scan({
    'DCIM': { 'EVCam_Video': { 'a_surround.mp4': null } },
    'Movies': { 'b.mp4': null },
    'Holiday photos': { 'beach.mp4': null }
  }, undefined);
  if (!both.includes('DCIM/EVCam_Video/a_surround.mp4') || !both.includes('Movies/b.mp4'))
    fail('both recorders are not read from one drive: ' + JSON.stringify(both));
  if (both.includes('Holiday photos/beach.mp4'))
    fail('the fence is lost when both recorders are present: ' + JSON.stringify(both));

  // A name only the setting knows about. Nothing in the code may special-case
  // this one, so it proves the list is read rather than hardcoded.
  const custom = await scan({
    'BlackBoxCam': { 'c.mp4': null },
    'DCIM': { 'a.mp4': null }
  }, 'BlackBoxCam');
  if (!custom.includes('BlackBoxCam/c.mp4'))
    fail('a folder named in the setting is not scanned: ' + JSON.stringify(custom));
  if (custom.includes('DCIM/a.mp4'))
    fail('a folder left out of the setting is still scanned: ' + JSON.stringify(custom));

  // Spacing and stray separators around an entry are tidied away.
  const sep = await scan({ 'Movies': { 'd.mp4': null } }, ' movies/ , , DCIM ');
  if (!sep.includes('Movies/d.mp4'))
    fail('spacing and stray separators break the setting: ' + JSON.stringify(sep));

  // A PATH, not just a name. The second recorder moved to Download/OpenAVM,
  // which a setting of single top-level names could not describe at all -
  // separators used to be stripped, turning it into "downloadopenavm", a
  // folder that will never exist, so a card opened at its root listed nothing.
  const nested = await scan({
    'Download': { 'OpenAVM': { 'OpenAVM_179_abc_S002.mp4': null,
                               'OpenAVM_179_abc_S002.sidecar.json': null },
                  'manual.pdf': null,
                  'Telegram': { 'funny.mp4': null } },
    'Holiday photos': { 'beach.mp4': null }
  }, DEFAULT_SETTING);
  if (!nested.includes('Download/OpenAVM/OpenAVM_179_abc_S002.mp4'))
    fail('the recordings below Download are not found: ' + JSON.stringify(nested));
  if (!nested.includes('Download/OpenAVM/OpenAVM_179_abc_S002.sidecar.json'))
    fail('the sidecar below Download is not found: ' + JSON.stringify(nested));
  // Download is a corridor, not a recorder's folder: what else is in it is
  // none of ours, and a phone's Download folder is full of other things.
  if (nested.some(p => /Telegram/.test(p)))
    fail('everything under Download was swept in: ' + JSON.stringify(nested));
  if (nested.includes('Holiday photos/beach.mp4'))
    fail('a card with only the nested recorder is not fenced: ' + JSON.stringify(nested));

  // The path is matched whole. A folder of that name somewhere else is a
  // different folder, and a configured path is not a licence to go hunting
  // for its last segment.
  const elsewhere = await scan({
    'OpenAVM': { 'x.mp4': null },
    'Download': { 'OpenAVM': { 'y.mp4': null } }
  }, 'Download/OpenAVM');
  if (!elsewhere.includes('Download/OpenAVM/y.mp4'))
    fail('the configured path was not read: ' + JSON.stringify(elsewhere));
  if (elsewhere.includes('OpenAVM/x.mp4'))
    fail('a folder of the same name at the top was read as the configured path: '
       + JSON.stringify(elsewhere));

  // And a backslash is the same separator to a person typing one.
  const backslash = await scan({ 'Download': { 'OpenAVM': { 'z.mp4': null } } },
                               'Download\\OpenAVM');
  if (!backslash.includes('Download/OpenAVM/z.mp4'))
    fail('a path typed with backslashes does not match: ' + JSON.stringify(backslash));

  // Opening the recorder's own folder still reads it as it stands - there is
  // no configured folder inside it, and fencing it to nothing would empty the
  // list of the very recordings that were opened.
  const inside = await scan({ 'OpenAVM_179_abc_S002.mp4': null, 'notes.json': null },
                            DEFAULT_SETTING);
  if (!inside.includes('OpenAVM_179_abc_S002.mp4'))
    fail('opening the recordings folder itself finds nothing: ' + JSON.stringify(inside));

  // An empty setting must not fence the scan down to nothing, which would
  // silently empty the list with no way back except Reset.
  const empty = await scan({ 'DCIM': { 'a.mp4': null }, 'Movies': { 'b.mp4': null } }, '   ');
  if (!empty.includes('DCIM/a.mp4') || !empty.includes('Movies/b.mp4'))
    fail('an empty setting empties the list: ' + JSON.stringify(empty));

  // The exports stay visible whichever recorder folder is present.
  const ex = await scan({
    'Movies': { 'a.mp4': null },
    'Dashcam and Sentry exports': { 'split': { 'a_Front.mp4': null } }
  }, 'Movies');
  if (!ex.includes('Dashcam and Sentry exports/split/a_Front.mp4'))
    fail('the exports vanish on a Movies card: ' + JSON.stringify(ex));

  // When a card is fenced and nothing comes back, the message says which
  // folders were looked in. The commonest reason for an empty list is that
  // the recordings are somewhere the setting does not name - and until this,
  // nothing on screen said what it does name, so "pick the folder that holds
  // the recordings" was true and no help whatever.
  await scan({ 'Download': { 'OpenAVM': { 'readme.txt': null } },
               'Holiday photos': { 'beach.mp4': null } }, DEFAULT_SETTING);
  await w.eval(`ingestInner([])`);
  const hint = w.document.getElementById('pickHint').textContent;
  if (!/Download\/OpenAVM/.test(hint))
    fail('an empty list does not say which folders were looked in, spelled as they '
       + 'were written: ' + hint);
  if (!/Settings/i.test(hint))
    fail('an empty list does not say where to change them: ' + hint);

  // A folder opened from inside the recordings is not fenced, so there is no
  // list of folders to name and the old wording stands.
  await scan({ 'notes.txt': null }, DEFAULT_SETTING);
  await w.eval(`ingestInner([])`);
  const loose = w.document.getElementById('pickHint').textContent;
  if (/Looked in/i.test(loose))
    fail('a folder read as it stands claims to have been fenced: ' + loose);

  // The setting is a real setting: typing in the field saves it, so it is
  // still there next time the player is opened.
  const field = w.document.getElementById('scanDirs');
  if (!field) fail('there is no field to set the folders in');
  else {
    field.value = 'Movies, DCIM';
    field.dispatchEvent(new w.Event('input', { bubbles: true }));
    const stored = JSON.parse(w.localStorage.getItem('lanePlayerSettings') || '{}');
    if (stored.scanDirs !== 'Movies, DCIM')
      fail('the setting is not saved: ' + JSON.stringify(stored.scanDirs));
  }
  w.eval(`prefs = freshPrefs()`);
  if (!/movies/i.test(w.eval(`prefs.scanDirs`)))
    fail('Movies is not in the default setting: ' + w.eval(`prefs.scanDirs`));
  if (!/download\/openavm/i.test(w.eval(`prefs.scanDirs`)))
    fail('the nested recorder folder is not in the default setting: ' + w.eval(`prefs.scanDirs`));

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); dom.window.close(); process.exit(1); }
  console.log('the folders to scan are a setting, and both recorders are read');
  dom.window.close(); process.exit(0);
}, 500);
