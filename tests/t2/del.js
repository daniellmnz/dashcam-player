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
setTimeout(()=>{
 const out=w.eval(`(function(){
  // The review's scenario: one file name, two camera folders.
  const NAME='20261008_120000_surround.mp4';
  const mk=(rel)=>({name:NAME,relPath:rel,size:1000});
  const a=mk('DCIM/CamA/'+NAME), b=mk('DCIM/CamB/'+NAME);
  segments.length=0;
  segments.push({name:NAME,file:a,relPath:a.relPath,session:'s',start:1,status:'ok',sidecar:null},
                {name:NAME,file:b,relPath:b.relPath,session:'s',start:2,status:'ok',sidecar:null});

  // Tick exactly one box - the first row.
  picked.clear();
  picked.add(segKey(segments[0]));

  const sel=segments.filter(x=>picked.has(segKey(x))&&x.file);
  return {
    keys:segments.map(s=>segKey(s)),
    ticked:picked.size,
    wouldDelete:sel.length,
    targets:sel.map(s=>s.relPath)
  };
 })()`);
 console.log('segment keys   :', out.keys.join('\n                 '));
 console.log('ticked         :', out.ticked);
 console.log('wouldDelete    :', out.wouldDelete, out.wouldDelete===1?'(correct)':'(WRONG)');
 console.log('target(s)      :', out.targets.join(', '));
 process.exit(out.wouldDelete===1?0:1);
},500);
