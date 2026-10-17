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
 const removed=[];
 w.__removed=removed;
 const res=await w.eval(`(async function(){
  const NAME='20261008_120000_surround.mp4';
  const f={name:NAME,relPath:'DCIM/CamB/'+NAME,size:10};
  segments.length=0;
  segments.push({name:NAME,file:f,relPath:f.relPath,session:'s',start:1,status:'ok',sidecar:null,scName:null});

  // A root handle exists; the handle for CamB does NOT - a stale map, which is
  // exactly when the old "|| dirHandle" silently deleted from the root.
  const mkDir=(label)=>({ removeEntry:async(n)=>{ window.__removed.push(label+'/'+n); },
                          queryPermission:async()=>'granted', requestPermission:async()=>'granted',
                          getFileHandle:async()=>{throw new Error('nope');} });
  dirHandle=mkDir('ROOT');
  dirHandles={'':mkDir('ROOT')};          // note: no 'DCIM/CamB/' entry

  picked.clear(); picked.add(segKey(segments[0]));
  await deleteSelected();
  return {removed:window.__removed.slice(), hint:(document.getElementById('hint')||{}).textContent||''};
 })()`);
 console.log('removeEntry calls :', res.removed.length?res.removed.join(', '):'none');
 console.log('root file deleted :', res.removed.some(r=>r.startsWith('ROOT/'))?'YES - BAD':'no (correct)');
 console.log('message shown     :', JSON.stringify((res.hint||'').slice(0,90)));
 process.exit(res.removed.length===0?0:1);
},500);
