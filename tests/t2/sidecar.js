// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
const fs=require('fs');
const {JSDOM}=require(process.env.NM+'/jsdom');
const html=fs.readFileSync(SRC + '/dashcam-player.html','utf8');
const dom=new JSDOM(html,{runScripts:"dangerously",url:"http://localhost:8777/",
  beforeParse(w){ w.fetch=()=>Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext=()=>null;
    w.URL.createObjectURL=()=>'blob:stub'; w.URL.revokeObjectURL=()=>{};
    w.indexedDB=undefined; w.confirm=()=>true; }});
const w=dom.window; w.onerror=()=>{};
setTimeout(async()=>{
 const res=await w.eval(`(async function(){
  const N='20261008_120000_surround';
  const vid=(rel)=>({name:N+'.mp4',relPath:rel,size:10,type:'video/mp4'});
  // Only CamA has a sidecar. CamB's video must NOT inherit it.
  const sc={recordingSessionId:'SESSION-FROM-CAM-A',segmentNumber:7,
            startedAtEpochMs:Date.now(),actualTrack:{durationMs:1000}};
  const json={name:N+'_sidecar.json',relPath:'DCIM/CamA/'+N+'_sidecar.json',
              text:async()=>JSON.stringify(sc)};
  const files=[vid('DCIM/CamA/'+N+'.mp4'), vid('DCIM/CamB/'+N+'.mp4'), json];
  await ingest(files);
  return segments.filter(s=>s.file).map(s=>({
    rel:s.relPath||segKey(s),
    hasSidecar:!!s.sidecar,
    scName:s.scName||null,
    session:String(s.session).slice(0,24)
  }));
 })()`);
 for(const r of res) console.log(r.rel.padEnd(42),'sidecar='+(r.hasSidecar?'yes':'no ').padEnd(4),'scName='+String(r.scName));
 const a=res.find(r=>r.rel.includes('CamA')), b=res.find(r=>r.rel.includes('CamB'));
 const ok=a&&a.hasSidecar&&b&&!b.hasSidecar;
 console.log('\nCamA keeps its sidecar :', a&&a.hasSidecar?'yes':'no');
 console.log('CamB wrongly inherits  :', b&&b.hasSidecar?'YES - BAD':'no (correct)');
 console.log(ok?'VERDICT: sidecars no longer cross folders':'VERDICT: PROBLEM');
 process.exit(ok?0:1);
},500);
