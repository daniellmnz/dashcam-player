// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', 'src');
// What the player says when the helper is no longer there. A bare
// "Failed to fetch" is what sent us hunting; it must never say only that.
const http=require('http'), fs=require('fs');
const { chromium }=require(process.env.NM+'/playwright-core');
const PAGE=SRC + '/dashcam-player.html';
const VER=fs.readFileSync(PAGE,'utf8').match(/DCP_VERSION="([0-9.]+)"/)[1];
let alive=true, bad=0;
const fail=m=>{bad++;console.log('  FAIL '+m);};
const srv=http.createServer((req,res)=>{
  const u=req.url.split('?')[0];
  if(!alive){ req.socket.destroy(); return; }   // the helper has gone away
  if(u==='/ping'){res.writeHead(200);return res.end();}
  if(u==='/version'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end(VER);}
  if(u==='/split'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('started');}
  res.writeHead(200,{'Content-Type':'text/html'});
  res.end(fs.readFileSync(PAGE,'utf8').replace('__DCP_TOKEN__','x'.repeat(64)).replace('__DCP_SRVVER__',VER));
});
srv.listen(8787,'127.0.0.1',async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
  const p=await b.newPage();
  await p.goto('http://127.0.0.1:8787/'); await p.waitForTimeout(900);

  // With the helper answering, the request goes through.
  const ok=await p.evaluate(async()=>{
    try{ const r=await localFetch('/split?name=a.mp4&views=1'); return r.status; }
    catch(e){ return 'threw: '+e.message; }
  });
  if(ok!==200) fail('a live helper did not answer: '+ok);

  // Now it stops, as it does when the window has been in the background.
  alive=false;
  const msg=await p.evaluate(async()=>{
    let why='', up=false;
    try{ await localFetch('/split?name=a.mp4&views=1'); }
    catch(e){ why=e.message; }
    try{ const q=await localFetch('/ping'); up=q.ok; }catch{}
    // Mirror what the page's own catch does with those two facts.
    return { why, up };
  });
  if(!/fetch/i.test(msg.why)) fail('expected a fetch failure, got: '+msg.why);
  if(msg.up) fail('ping answered though the helper was stopped');

  // And the shipped page must turn that into an instruction, not a TypeError.
  const src=fs.readFileSync(PAGE,'utf8');
  if(!/The background helper has stopped/.test(src))
    fail('the page has no message for a helper that has stopped');
  if(!/Close this window and open Dashcam Player again/.test(src))
    fail('the message does not say what to do about it');
  if(!/localFetch\("\/ping"\); alive=q\.ok/.test(src))
    fail('the page does not check whether the helper is there before reporting');

  await b.close(); srv.close();
  if(bad){ console.log(`FAIL: ${bad} problem(s)`); process.exit(1); }
  console.log('a stopped helper is reported as such, with what to do about it');
});
