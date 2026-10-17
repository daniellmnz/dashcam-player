// The Rectify fisheye tick box, which lives in the export question.
//
// Straightening a camera used to mean leaving the player, finding the Start
// menu tool and pointing it at a file by hand. It is the same request the
// split already makes to the same place, differing only in whether the curve
// is taken out on the way - which is a property of the file you are asking
// for, not a separate errand. So: one button, and a box that says which kind
// of file it writes.
//
// The box was on the control bar and is now in the question itself, next to
// the frame it changes - it could otherwise be ticked minutes before the
// preview that would have shown it was the wrong choice. The remembered
// answer still decides what the button OFFERS; the question can overrule it
// for one export. The things most likely to go wrong are the box being
// ignored, and a file that is already one camera - which cannot be split at
// all - ending up with no way to straighten it.
const fs = require('fs');
const SRC = process.env.DCP_SRC || require('path').resolve(__dirname, '..', '..', 'src');
const { JSDOM } = require(process.env.NM + '/jsdom');

const raw = fs.readFileSync(SRC + '/dashcam-player.html', 'utf8');
const VER = raw.match(/DCP_VERSION="([0-9.]+)"/)[1];

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

// Drives the page and hands back what it asked the helper for, along with
// what was on offer at the time.
function run({ view, clip, press, rect, tick }) {
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
  w.w2 = w;   // so the evaluated string can reach this window's Event
  return new Promise(res => setTimeout(async () => {
    // A real frame size: the button only appears when the picture really is
    // a grid, and jsdom's video element reports nothing by itself.
    w.eval(`
      Object.defineProperty(video,'duration',{configurable:true,get:()=>120});
      Object.defineProperty(video,'videoWidth',{configurable:true,get:()=>${view ? 1280 : 2560}});
      Object.defineProperty(video,'videoHeight',{configurable:true,get:()=>${view ? 1330 : 2660}});
    `);
    await w.eval(`(async function(){
      const N=${JSON.stringify(view ? 'a_surround_Front.mp4' : 'a_surround.mp4')};
      dirHandle={name:'Movies'};
      segments.length=0;
      segments.push({name:N,file:{name:N,relPath:'Movies/'+N,size:10},relPath:'Movies/'+N,
        session:'s',start:1,status:'ok',sidecar:null,missing:false,flat:false,
        view:${view ? '"Front"' : 'null'}});
      current=0; mode={kind:'lane',i:0};
      ${clip ? `clip.in=${clip[0]}; clip.out=${clip[1]};` : ''}
      ${rect ? `prefs.rectify=true;` : ''}
      syncSplitButton();
      ${press ? `const b=document.getElementById(${JSON.stringify(press)}); if(b) await (async b=>{
        // The export shows one frame and waits for an answer, so a test that
        // presses the button has to give one or it waits for ever.
        const p=b.onclick?b.onclick():null;
        for(let i=0;i<40&&!document.getElementById('xpok');i++) await new Promise(r=>setTimeout(r,25));
        // What the question offered, recorded before it is answered.
        window.__askedRect=!!document.getElementById('xprect');
        window.__askedStrip=!!document.getElementById('xpstrip');
        ${tick ? `const t=document.getElementById('xprect');
          if(t){ t.checked=${tick === 'on' ? 'true' : 'false'};
                 t.dispatchEvent(new w2.Event('change',{bubbles:true}));
                 await new Promise(r=>setTimeout(r,60)); }` : ''}
        const ok=document.getElementById('xpok'); if(ok) ok.click();
        await p;
      })(b);` : ''}
    })()`);
    const vis = id => { const el = w.document.getElementById(id); return el ? !el.hidden : null; };
    const el = w.document.getElementById('splitThis') || {};
    const out = { url: sent.find(u => u.startsWith('/split?')) || null,
                  split: vis('splitThis'),
                  // What the QUESTION offered, which is where the choice lives now.
                  box: w.__askedRect === undefined ? null : w.__askedRect,
                  stripBox: w.__askedStrip === undefined ? null : w.__askedStrip,
                  title: el.title || '', text: (el.textContent || '').trim() };
    dom.window.close();
    res(out);
  }, 600));
}

(async () => {
  if (!/id="xprect"/.test(raw)) fail('there is no Rectify fisheye tick box anywhere');
  // It belongs in the question now. Left on the bar as well, the two could be
  // set to different things and the frame would agree with only one of them.
  if (/id="rectify"[^>]*>/.test(raw) && /barcheck/.test(raw))
    fail('the tick box is still on the control bar as well as in the question');
  if (/id="dewarpThis"|id="rectifyThis"/.test(raw)) fail('the old fisheye button is still there as well');

  // A four-camera recording with one camera on screen: the box offers a
  // choice, and unticked the button does what it always did.
  const grid = await run({});
  if (!grid.split) fail('the export button is not offered on a grid recording');
  // One label whatever the remembered answer is. The button used to name the
  // kind of clip, which announced a decision the question had not asked yet.
  if (!/^export clip$/i.test(grid.text))
    fail('the button does not read "Export clip": ' + grid.text);

  const plain = await run({ press: 'splitThis' });
  if (!plain.box) fail('the question offers no choice where there is one to make');
  if (!plain.url) fail('pressing the button asked the helper for nothing');
  else if (!/[?&]tool=split\b/.test(plain.url)) fail('unticked, the button did not ask for the split: ' + plain.url);

  // Ticked, the same button writes the straightened kind instead.
  const ticked = await run({ rect: true });
  if (!/^export clip$/i.test(ticked.text))
    fail('the button changes its label with the remembered answer: ' + ticked.text);
  if (!/whole recording/i.test(ticked.title))
    fail('with nothing marked the tooltip does not say so: ' + ticked.title);
  // "file" is gone from the labels: everything these buttons write is a clip
  // of a recording, and two nouns for it read as two different buttons.
  if (/\bfile\b/i.test(ticked.text) || /\bfile\b/i.test(grid.text))
    fail('a label still says "file": ' + grid.text + ' / ' + ticked.text);
  const rectUrl = (await run({ rect: true, press: 'splitThis' })).url;
  if (!rectUrl || !/[?&]tool=rectify\b/.test(rectUrl)) fail('ticked, the button did not ask for the fisheye tool: ' + rectUrl);
  // And the question overrules the remembered answer, in both directions.
  const turnedOn = (await run({ press: 'splitThis', tick: 'on' })).url;
  if (!turnedOn || !/[?&]tool=rectify\b/.test(turnedOn))
    fail('ticking the box in the question did not change the export: ' + turnedOn);
  const turnedOff = (await run({ rect: true, press: 'splitThis', tick: 'off' })).url;
  if (!turnedOff || !/[?&]tool=split\b/.test(turnedOff))
    fail('unticking the box in the question did not change the export: ' + turnedOff);
  if (!/[?&]views=1\b/.test(String(rectUrl))) fail('the request does not say which camera: ' + rectUrl);

  // A file that is already one camera cannot be split, so there is no choice
  // to offer: the box goes away and the button straightens it, rather than
  // refusing until a box somewhere is ticked.
  const single = await run({ view: true });
  if (!single.split) fail('nothing is offered on a file that is already one camera');
  if (!/^export clip$/i.test(single.text))
    fail('the button reads differently on a single-camera file: ' + single.text);
  // The label says nothing about the kind, so the tooltip has to.
  if (!/straighten/i.test(single.title))
    fail('nothing says it will straighten a file that is already one camera: ' + single.title);
  const singlePress = await run({ view: true, press: 'splitThis' });
  if (singlePress.box) fail('a choice is offered where there is none to make');
  if (!singlePress.url || !/[?&]tool=rectify\b/.test(singlePress.url))
    fail('a single camera file was not sent to the fisheye tool: ' + singlePress.url);

  // The marks apply to either kind.
  const clipped = await run({ rect: true, clip: [10, 25], press: 'splitThis' });
  if (!clipped.url || !/[?&]start=10\.00\b/.test(clipped.url) || !/[?&]dur=15\.00\b/.test(clipped.url))
    fail('the clip did not reach the fisheye tool: ' + clipped.url);
  // The label reads "clip" either way now, so it can no longer tell us a
  // range was taken up - the tooltip is where that lives, and it names the
  // stretch rather than just hinting at one.
  if (!/0:10/.test(clipped.title) || !/0:25/.test(clipped.title))
    fail('the tooltip does not name the marked stretch: ' + clipped.title);
  if (!/straighten/i.test(clipped.title))
    fail('the tooltip does not say it will straighten it: ' + clipped.title);
  const clipSplit = await run({ clip: [10, 25], press: 'splitThis' });
  if (!clipSplit.url || !/[?&]dur=/.test(clipSplit.url))
    fail('the clip no longer reaches the split tool: ' + clipSplit.url);

  // And the choice is remembered, the way the other tick boxes are.
  if (!/rectify:false/.test(raw)) fail('the choice is not among the settings, so it is forgotten each time');

  if (bad) { console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('one button, and a tick box in the question that decides which kind of file it writes');
  process.exit(0);
})();
