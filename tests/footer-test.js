// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', 'src');
// The point of the change is that nothing moves. Measured in a real browser,
// because this is a layout question and only a layout engine can answer it.
const http = require('http'), fs = require('fs');
const { chromium } = require(process.env.NM + '/playwright-core');
// Screenshots go to the system temp folder, not into the checkout.
const SHOT = require('path').join(require('os').tmpdir(), 'dcp-footer-test.png');
const PAGE = SRC + '/dashcam-player.html';
const VER = fs.readFileSync(PAGE,'utf8').match(/DCP_VERSION="([0-9.]+)"/)[1];
const srv = http.createServer((req,res)=>{
  const u=req.url.split('?')[0];
  if(u==='/ping'){res.writeHead(200);return res.end();}
  if(u==='/version'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end(VER);}
  res.writeHead(200,{'Content-Type':'text/html'});
  res.end(fs.readFileSync(PAGE,'utf8').replace('__DCP_TOKEN__','x'.repeat(64)).replace('__DCP_SRVVER__',VER));
});
let bad=0; const fail=m=>{bad++;console.log('  FAIL '+m);};
srv.listen(8796,'127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const p = await b.newPage({ viewport:{width:1200,height:700} });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:8796/');
  await p.waitForTimeout(700);

  // Before a folder is open there should be no reserved gap at all.
  const beforeOpen = await p.evaluate(() => document.getElementById('railfoot').hidden);
  if (beforeOpen !== true) fail('the footer is taking up space before a folder is open');

  await p.evaluate(() => {
    const mk=(session,n,day)=>{
      const name=`2026100${day}_1${String(n).padStart(2,'0')}601_surround.mp4`;
      return {session,name,number:n,status:'ok',missing:false,
              start:Date.UTC(2026,9,day,13,n*10),dur:600,file:{size:4.43e8,relPath:name,name}};
    };
    segments.length=0;
    for(let i=0;i<9;i++) segments.push(mk('Dashcam video — Fri, 9 Oct 2026',i,9));
    for(let i=0;i<14;i++) segments.push(mk('Dashcam video — Thu, 8 Oct 2026',i,8));
    dirHandle={name:'EVCam_Video'}; dirHandles={'':dirHandle};
    picked.clear(); collapsed.clear(); renderList();
  });
  await p.waitForTimeout(250);

  const snap = () => p.evaluate(() => {
    const list=document.getElementById('list');
    const foot=document.getElementById('railfoot');
    const rows=[...document.querySelectorAll('.segrow')];
    const last=rows[rows.length-1];
    return { listH: Math.round(list.getBoundingClientRect().height),
             listTop: Math.round(list.getBoundingClientRect().top),
             footH: Math.round(foot.getBoundingClientRect().height),
             footHidden: foot.hidden,
             scrollH: list.scrollHeight,
             lastRowTop: last?Math.round(last.getBoundingClientRect().top):null,
             btnVisible: getComputedStyle(document.getElementById('delSel')).visibility };
  });

  const before = await snap();
  if (before.footHidden) fail('no reserved space once a folder is open');
  if (before.btnVisible !== 'hidden') fail('the button shows with nothing ticked');

  // Tick one file.
  await p.evaluate(() => {
    const cb=document.querySelector('.segpick');
    cb.checked=true; cb.dispatchEvent(new Event('change'));
  });
  await p.waitForTimeout(200);
  const after = await snap();

  if (after.listH !== before.listH) fail(`the list changed height: ${before.listH} -> ${after.listH}`);
  if (after.listTop !== before.listTop) fail(`the list moved: ${before.listTop} -> ${after.listTop}`);
  if (after.lastRowTop !== before.lastRowTop) fail(`rows moved: ${before.lastRowTop} -> ${after.lastRowTop}`);
  if (after.btnVisible !== 'visible') fail('the button did not appear');
  if (after.footH !== before.footH) fail(`the footer changed height: ${before.footH} -> ${after.footH}`);

  // And the button must be below the list, not above it.
  const order = await p.evaluate(() => {
    const l=document.getElementById('list').getBoundingClientRect();
    const f=document.getElementById('railfoot').getBoundingClientRect();
    return { listBottom: Math.round(l.bottom), footTop: Math.round(f.top) };
  });
  if (order.footTop < order.listBottom - 1) fail('the footer is not below the list');

  // Untick: still nothing moves.
  await p.evaluate(() => {
    const cb=document.querySelector('.segpick');
    cb.checked=false; cb.dispatchEvent(new Event('change'));
  });
  await p.waitForTimeout(200);
  const back = await snap();
  if (back.listH !== before.listH) fail(`unticking changed the list height: ${back.listH}`);
  if (back.btnVisible !== 'hidden') fail('the button stayed visible with nothing ticked');

  console.log(JSON.stringify({before,after}));
  // Capture it with a group ticked, which is the state worth looking at.
  await p.evaluate(() => {
    const g=document.querySelector('.sesspick'); g.checked=true;
    g.dispatchEvent(new Event('change'));
  });
  await p.waitForTimeout(200);
  await p.screenshot({ path: SHOT });
  console.log('errors:', errs.length?errs:'none');
  if (bad) { console.log(`FAIL: ${bad} problem(s)`); await b.close(); srv.close(); process.exit(1); }
  console.log('the list keeps its height and place when the button appears');
  await b.close(); srv.close();
});
