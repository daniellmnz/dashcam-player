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
 const r=await w.eval(`(async function(){
  const out={};
  const N='20261008_120000_surround';

  // 1. An absurd timestamp used to throw RangeError inside renderList and
  //    leave the sidebar empty. Build the segment directly so the row is not
  //    filtered out for an unrelated reason (a stub file cannot be probed).
  segments.length=0;
  segments.push({name:N+'.mp4', file:{name:N+'.mp4',relPath:'DCIM/A/'+N+'.mp4',size:10},
                 relPath:'DCIM/A/'+N+'.mp4', session:'s1', status:'ok',
                 start:1e18, number:1,
                 sidecar:{startedAtEpochMs:1e18, recordingSessionId:'s1'}});
  prefs.showNames=true; collapsed.clear();
  let renderThrew=null;
  try{ renderList(); }catch(e){ renderThrew=e.message; }
  out.renderThrew=renderThrew;
  out.rowsAfterBadTs=document.querySelectorAll('#list .seg').length;
  out.clampedTs=cleanTs(1e18);
  out.fmtDateOfJunk=fmtDate(1e18);

  // 2. A huge lanes array used to create one button+checkbox per lane,
  //    and Math.max.apply throws above ~130k args.
  const lanes=[]; for(let i=0;i<200000;i++) lanes.push({x0:0,y0:0,x1:10,y1:10,lane:i});
  const sc2={laneLayout:{lanes},recordingSessionId:'s2',actualTrack:{durationMs:1}};
  const json2={name:'b_sidecar.json',relPath:'DCIM/B/b_sidecar.json',
               text:async()=>JSON.stringify(sc2)};
  await ingest([{name:'b.mp4',relPath:'DCIM/B/b.mp4',size:10}, json2]);
  const seg=segments.find(s=>s.name==='b.mp4');
  out.lanesCapped=seg&&seg.sidecar?seg.sidecar.laneLayout.lanes.length:'n/a';
  let threw=null;
  try{ bannerGeom(seg); }catch(e){ threw=e.message; }
  out.bannerGeomThrew=threw;

  // 3. ingest now reports instead of throwing an unhandled rejection
  out.ingestBadInput=await (async()=>{ try{ await ingest(null); return 'handled'; }
                                       catch(e){ return 'THREW: '+e.message; } })();

  // 4. cancel plumbing exists
  out.hasCancel = typeof progressPanel==='function' && typeof rebuildCancel==='boolean';
  return out;
 })()`);
 console.log('renderList threw            :', r.renderThrew||'no');
 console.log('rows after absurd timestamp :', r.rowsAfterBadTs, r.rowsAfterBadTs>0?'(list survived)':'(EMPTY - bad)');
 console.log('timestamp clamped to        :', r.clampedTs);
 console.log('fmtDate(1e18) returns       :', JSON.stringify(r.fmtDateOfJunk));
 console.log('200k lanes capped to        :', r.lanesCapped);
 console.log('bannerGeom threw            :', r.bannerGeomThrew||'no');
 console.log('ingest(null)                :', r.ingestBadInput);
 console.log('cancel plumbing present     :', r.hasCancel);
 const ok=r.rowsAfterBadTs>0 && r.clampedTs===null && r.lanesCapped===16
          && !r.bannerGeomThrew && r.ingestBadInput==='handled' && r.hasCancel;
 console.log(ok?'\nVERDICT: reliability items hold':'\nVERDICT: PROBLEM');
 process.exit(ok?0:1);
},600);
