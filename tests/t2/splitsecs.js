// What the page tells the tool about the recording's length.
//
// The percentage the player shows is worked out by dividing by that length,
// which the tool gets from ffprobe - and ffprobe cannot read it out of every
// recording. When it cannot, the progress read "working" from start to
// finish. The page has the file open and playing, so it knows, and sends it.
// Not for a clip: there the tool measures the clip, which is the right thing
// to divide by, and the whole recording's length would peg the bar near zero.
const fs = require('fs');
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

const raw = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = raw.match(/DCP_VERSION="([0-9.]+)"/)[1];

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

// Drives the real Export single view clip button and hands back the /split URL.
function ask({ duration, sidecarMs, clip }) {
  const html = raw.replace('__DCP_TOKEN__', 'a'.repeat(64)).replace('__DCP_SRVVER__', VER);
  const sent = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost:8777/',
    beforeParse(w) {
      w.fetch = u => { sent.push(String(u)); return Promise.resolve({ ok: true, status: 200,
        text: async () => 'started', json: async () => ({ state: 'starting' }) }); };
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
      w.indexedDB = undefined;
    } });
  const w = dom.window; w.onerror = () => {};
  return new Promise(res => setTimeout(async () => {
    // jsdom's media element reports no duration, so it is given one the way
    // a real browser would once the file is loaded.
    w.eval(`Object.defineProperty(video,'duration',{configurable:true,get:()=>${duration}})`);
    await w.eval(`(async function(){
      const N='a_surround.mp4';
      dirHandle={name:'Movies'};
      segments.length=0;
      segments.push({name:N,file:{name:N,relPath:N,size:10},relPath:N,session:'s',
        start:1,status:'ok',view:null,missing:false,
        sidecar:${sidecarMs ? `{actualTrack:{durationMs:${sidecarMs}}}` : 'null'}});
      current=0; mode={kind:'lane',i:0};
      ${clip ? `clip.in=${clip[0]}; clip.out=${clip[1]};` : ''}
      const b=document.getElementById('splitThis');
      if(b) await (async b=>{
        // The export now shows one frame and waits for an answer, so a test
        // that presses the button has to give one or it waits for ever.
        const p=b.onclick?b.onclick():null;
        for(let i=0;i<40&&!document.getElementById('xpok');i++) await new Promise(r=>setTimeout(r,25));
        const ok=document.getElementById('xpok'); if(ok) ok.click();
        await p;
      })(b);
    })()`);
    dom.window.close();
    res(sent.find(u => u.startsWith('/split?')) || null);
  }, 600));
}

(async () => {
  // The whole recording, with a duration the page read off the video.
  const whole = await ask({ duration: 182.4 });
  if (!whole) fail('no split was requested at all');
  else {
    const m = /[?&]secs=([0-9.]+)/.exec(whole);
    if (!m) fail('the recording length was not sent: ' + whole);
    else if (Math.abs(parseFloat(m[1]) - 182.4) > 0.01)
      fail('the length sent was ' + m[1] + ', not 182.4');
  }

  // A marked clip: the tool measures the clip, so nothing is sent.
  const clipped = await ask({ duration: 600, clip: [10, 25] });
  if (!clipped) fail('no split was requested for the clip');
  else {
    if (/[?&]secs=/.test(clipped))
      fail("the whole recording's length was sent for a clip: " + clipped);
    if (!/[?&]dur=/.test(clipped)) fail('the clip length was not sent: ' + clipped);
  }

  // No duration from the video - a file the browser has not measured either.
  // The sidecar knows, when there is one.
  const fromSidecar = await ask({ duration: NaN, sidecarMs: 60000 });
  if (fromSidecar && !/[?&]secs=60\.00/.test(fromSidecar))
    fail('the sidecar length was not used as a fallback: ' + fromSidecar);

  // And with neither, nothing is invented.
  const nothing = await ask({ duration: NaN });
  if (nothing && /[?&]secs=/.test(nothing))
    fail('a length was sent that nothing knew: ' + nothing);

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('the page tells the tool how long the recording is, except for a clip');
  process.exit(0);
})();
