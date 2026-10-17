// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
const fs=require('fs');
const {JSDOM}=require(process.env.NM+'/jsdom');
const raw=fs.readFileSync(SRC + '/dashcam-player.html','utf8');
const PAGEVER=(raw.match(/DCP_VERSION="([0-9.]+)"/)||[])[1];

function run(serverVersion,url,label){
  const html=raw.replace('__DCP_TOKEN__','a'.repeat(64))
                .replace('__DCP_SRVVER__',serverVersion);
  const sent=[];
  const dom=new JSDOM(html,{runScripts:"dangerously",url,
    beforeParse(w){ w.fetch=(u)=>{sent.push(String(u));return Promise.resolve({ok:true,status:200,
        text:async()=>'started',json:async()=>({state:'starting'})});};
      w.HTMLCanvasElement.prototype.getContext=()=>null;
      w.URL.createObjectURL=()=>'blob:stub'; w.URL.revokeObjectURL=()=>{}; w.indexedDB=undefined; }});
  const w=dom.window; w.onerror=()=>{};
  return new Promise(res=>setTimeout(async()=>{
    const out=await w.eval(`(async function(){
      const N='x.mp4';
      dirHandle={name:'EVCam_Video'};
      segments.length=0;
      segments.push({name:N,file:{name:N,relPath:N,size:10},relPath:N,session:'s',
                     start:1,status:'ok',sidecar:null,view:null,missing:false});
      current=0; mode={kind:'lane',i:0};
      const b=document.getElementById('splitThis');
      if(b) await (async b=>{
        // The export now shows one frame and waits for an answer, so a test
        // that presses the button has to give one or it waits for ever.
        const p=b.onclick?b.onclick():null;
        for(let i=0;i<40&&!document.getElementById('xpok');i++) await new Promise(r=>setTimeout(r,25));
        const ok=document.getElementById('xpok'); if(ok) ok.click();
        await p;
      })(b);
      return { stale:helperIsStale(), srvVer:DCP_SERVER_VERSION, unknown:DCP_SERVER_UNKNOWN };
    })()`);
    const splitSent=sent.some(u=>u.startsWith('/split?'));
    console.log(label);
    console.log('  helper reports: '+(out.srvVer||(out.unknown?'(placeholder - too old)':'(none)'))
                +'   stale: '+out.stale+'   /split sent: '+(splitSent?'yes':'no'));
    res({stale:out.stale,splitSent});
  },600));
}
(async()=>{
  const L='http://localhost:8777/';
  const a=await run(PAGEVER,  L, `=== helper matches the page (${PAGEVER}) ===`);
  const b=await run('1.25.1', L, '=== helper left over from an older version ===');
  const c=await run('__DCP_SRVVER__', L, '=== helper too old to know the handshake ===');
  const d=await run('__DCP_SRVVER__','file:///C:/x/dashcam-player.html','=== opened as a local file, no helper ===');
  const ok = a.splitSent && !a.stale
          && b.stale && !b.splitSent
          && c.stale && !c.splitSent      // the case the last build missed
          && !d.stale;                    // file:// must not be flagged
  console.log('\nVERDICT: '+(ok?'all four cases correct':'PROBLEM'));
  process.exit(ok?0:1);
})();
