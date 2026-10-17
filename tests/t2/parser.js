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
    w.indexedDB=undefined; }});
const w=dom.window; w.onerror=()=>{};

function reader(path){
  const fd=fs.openSync(path,'r'); const size=fs.statSync(path).size; let bytes=0;
  return {size,bytes:()=>bytes,
    read:(a,b)=>{ const n=Math.max(0,Math.min(b,size)-a); const buf=Buffer.alloc(n);
      if(n) fs.readSync(fd,buf,0,n,a); bytes+=n; return new Uint8Array(buf); }};
}

// Real recordings, which are far too large to keep in the repository and are
// somebody's own footage besides. The folder they live in is named here, and
// a clone that has none skips rather than fails: the parser cannot be tested
// against files that are not there, and pretending otherwise would leave a
// red suite for everyone who ever checks this out.
const SAMPLES = process.env.DCP_SAMPLES || '/mnt/user-data/uploads';

setTimeout(async()=>{
  let files=[];
  try { files=fs.readdirSync(SAMPLES).filter(f=>f.endsWith('.mp4')).sort(); }
  catch { files=[]; }
  if(!files.length){
    console.log(`no recordings in ${SAMPLES} - set DCP_SAMPLES to a folder of them`);
    process.exit(2);
  }
  let healthy=0, broken=0, walkerRanEverywhere=true;
  const noIndex=[];
  for(const f of files){
    const R=reader(require('path').join(SAMPLES,f));
    w.__read=R.read; w.__size=R.size;
    const out=await w.eval(`(async function(){
      const boxes=[]; await walkBoxes(window.__read,window.__size,t=>{boxes.push(t);});
      let ref=null,err=null;
      try{ const r=await readReference(window.__read,window.__size);
           ref=r.width+'x'+r.height+' hvcC='+r.hvcC.length+'B'; }
      catch(e){ err=e.message; }
      const pay=await findPayload(window.__read,window.__size);
      return {boxes,ref,err,pay};
    })()`);
    if(out.ref) healthy++; else { broken++; noIndex.push(f); }
    if(out.boxes.length===0) walkerRanEverywhere=false;
    console.log(f.padEnd(34),'boxes='+out.boxes.join(',').padEnd(26),
                'payload@'+String(out.pay).padEnd(8),
                (out.ref||'no index').padEnd(22),(R.bytes()/1048576).toFixed(1)+'MB');
  }
  console.log(`\nhealthy=${healthy} broken=${broken}  walker ran on every file: ${walkerRanEverywhere}`);
  // What is asserted is the parser's behaviour, not how many files happen to
  // be in that folder. It is shared, and a recording added to it for some
  // other reason used to turn this check red: it wanted exactly six healthy
  // files and a seventh arrived. The properties worth holding are that the
  // walker reached the end of every file, that a complete recording yields an
  // index, and that the one truncated recording is still recognised as having
  // none rather than being read as whole.
  // The one recording in that folder that really is cut short, and so really
  // has no index to find.
  const truncated=['20261001_141021_surround.mp4'];
  const want=files.filter(f=>truncated.includes(f)).join(',');
  const got=noIndex.join(',');
  if(got!==want) console.log(`  files with no index: got [${got}], expected [${want}]`);
  const ok=walkerRanEverywhere&&healthy>=1&&got===want;
  console.log(ok?'VERDICT: parser healthy':'VERDICT: PROBLEM');
  process.exit(ok?0:1);
},500);
