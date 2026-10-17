// What the player says when a recording will not decode.
//
// The commonest cause is not a bad file: it is graphics acceleration being
// switched off. HEVC is decoded by the graphics card rather than by the
// browser, and the browser's own support check takes that setting into
// account - so with acceleration off, canPlayType reports no HEVC at all,
// which is precisely the state this message is shown in. Telling someone to
// convert their recordings when a toggle would have done is a poor trade, so
// the order of the advice is part of what is checked here.
//
// The settings addresses must NOT be links. A page is not allowed to navigate
// to chrome:// or edge://, so a link there is one that silently does nothing -
// worse than text the reader can copy.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
const fs = require('fs');
const { JSDOM } = require(process.env.NM + '/jsdom');
const html = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost:8777/',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub';
    w.URL.revokeObjectURL = () => {};
    w.indexedDB = undefined;
  } });
const w = dom.window;
w.onerror = () => {};

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };
const ok = m => console.log('  ok   ' + m);

setTimeout(() => {
  // No HEVC, which is what the browser reports both when the codec really is
  // missing and when acceleration has been turned off.
  const noHevc = w.eval(`(function(){
    video.canPlayType=()=>"";
    loadFailed("the decoder gave up");
    return document.getElementById("msg").innerHTML;
  })()`);

  const want = [
    ['graphics acceleration', /graphics acceleration/i,
     'the commonest cause and the only free fix is not mentioned'],
    ['the Edge settings address', /edge:\/\/settings\/system/,
     'there is nothing to paste into the address bar'],
    ['the Chrome settings address', /chrome:\/\/settings\/system/,
     'there is nothing to paste into the address bar'],
    ['the toggle by name', /Use graphics acceleration when available/,
     'the setting is not named, so it has to be hunted for'],
    ['how to check it took', /Decode hevc main/,
     'there is no way to tell whether the change worked'],
    ['the Edge extension', /HEVC Video Extensions/,
     'Edge needs it and Chrome does not; saying so saves a wasted install']
  ];
  for (const [what, re, why] of want) {
    if (!re.test(noHevc)) fail(`${what} is missing - ${why}`);
  }
  if (want.every(([, re]) => re.test(noHevc)))
    ok('the message recommends graphics acceleration, and says how and how to check');

  // Order: the free fix before the one that rewrites every file.
  const accAt = noHevc.search(/graphics acceleration/i);
  const ffAt = noHevc.indexOf('ffmpeg');
  if (ffAt >= 0 && accAt > ffAt)
    fail('converting the files is offered before the setting that costs nothing');
  else ok('the setting is offered before converting the files');

  // A link out, opened in a way that does not hand the page over.
  const link = /<a href="(https:\/\/[^"]+)"([^>]*)>/.exec(noHevc);
  if (!link) fail('there is no link to fuller instructions');
  else {
    if (!/target="_blank"/.test(link[2]))
      fail('the instructions link replaces the player rather than opening beside it');
    else if (!/noopener/.test(link[2]) || !/noreferrer/.test(link[2]))
      fail('the instructions link is opened without noopener/noreferrer');
    else ok('there is a link to fuller instructions, opened safely');
  }

  // The settings addresses must be text to copy, never links: a page cannot
  // navigate to chrome:// or edge://, so such a link would do nothing at all.
  if (/<a[^>]+href="(chrome|edge):\/\//.test(noHevc))
    fail('a settings address is a link, and clicking it will silently do nothing');
  else ok('the settings addresses are text to copy, not dead links');

  // And when the browser CAN decode HEVC, none of this is the problem.
  const withHevc = w.eval(`(function(){
    video.canPlayType=()=>"probably";
    loadFailed("the decoder gave up");
    return document.getElementById("msg").innerHTML;
  })()`);
  if (/graphics acceleration/i.test(withHevc))
    fail('a browser that already decodes HEVC is told to turn acceleration on');
  else ok('a browser that already decodes HEVC is not sent to the settings page');

  console.log(bad ? `\n${bad} FAIL` : '\nthe decode failure points at the setting first');
  process.exit(bad ? 1 : 0);
}, 500);
