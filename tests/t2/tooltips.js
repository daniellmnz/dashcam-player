// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
const fs=require('fs');
const {JSDOM}=require(process.env.NM+'/jsdom');
const raw=fs.readFileSync(SRC + '/dashcam-player.html','utf8');
const V=(raw.match(/DCP_VERSION="([0-9.]+)"/)||[])[1];
const html=raw.replace('__DCP_TOKEN__','a'.repeat(64)).replace('__DCP_SRVVER__',V);
const dom=new JSDOM(html,{runScripts:"dangerously",url:"http://localhost:8777/",
  beforeParse(w){ w.fetch=()=>Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext=()=>null;
    w.URL.createObjectURL=()=>'blob:stub'; w.URL.revokeObjectURL=()=>{}; w.indexedDB=undefined;
    w.requestAnimationFrame=cb=>setTimeout(cb,0); }});
const w=dom.window; w.onerror=()=>{};
setTimeout(()=>{
  // build the dynamic controls too
  w.eval(`
    segments.length=0;
    const lanes=[{lane:1,x0:0,y0:0,x1:1280,y1:1280,displayOrder:1},
                 {lane:2,x0:1280,y0:0,x1:2560,y1:1280,displayOrder:2},
                 {lane:3,x0:0,y0:1280,x1:1280,y1:2560,displayOrder:3},
                 {lane:4,x0:1280,y0:1280,x1:2560,y1:2560,displayOrder:4}];
    segments.push({name:'x.mp4',file:{name:'x.mp4',relPath:'x.mp4',size:10},session:'s',
      start:1,status:'ok',view:null,missing:false,meta:null,manifest:null,asset:null,
      sidecar:{laneLayout:{lanes},actualTrack:{durationMs:1000},recordingSessionId:'s'}});
    current=0;
    try{ buildLaneButtons(segments[0]); }catch(e){}
  `);
  const d=w.document;
  const els=[...d.querySelectorAll('button, input, select')];
  let missing=[];
  for(const e of els){
    const own=e.getAttribute('title');
    const viaLabel=e.parentElement&&e.parentElement.tagName==='LABEL'&&e.parentElement.getAttribute('title');
    if(!own&&!viaLabel) missing.push(e.tagName.toLowerCase()+'#'+(e.id||'(dynamic)')+' "'+(e.textContent||'').trim().slice(0,24)+'"');
  }
  console.log('controls found      : '+els.length);
  console.log('lane buttons built  : '+d.querySelectorAll('#laneBtns button').length);
  console.log('grid tick boxes     : '+d.querySelectorAll('#viewToggles input').length);
  console.log('without a tooltip   : '+missing.length);
  missing.forEach(m=>console.log('   '+m));
  // show a sample so the wording can be eyeballed
  console.log('\nsample:');
  ['pickFolder','autoRebuild','trimBottom','lensK','theme','reset'].forEach(id=>{
    const e=d.getElementById(id); if(e) console.log('  '+id.padEnd(13)+(e.getAttribute('title')||'-'));
  });
  const lb=d.querySelector('#laneBtns button');
  if(lb) console.log('  '+'laneBtn'.padEnd(13)+lb.title);

  // Removed on request: the full-screen button, the render-quality choice and
  // the layout override.
  // Checked here because this is the test that inventories the control row,
  // and a control that is gone from the markup but still wired up in the
  // script leaves the handler throwing on a missing element.
  let gone=0;
  for(const id of ['full','quality','layout']){
    if(d.getElementById(id)){ gone++; console.log('   #'+id+' is back in the markup'); }
  }
  const script=raw.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  for(const dead of ['requestFullscreen','exitFullscreen','fullscreenElement',
                     'fullscreenchange','prefs.quality','prefs.layout']){
    if(script.includes(dead)){ gone++; console.log('   the script still uses '+dead); }
  }

  // Playback speed belongs with Play, not up among the view settings.
  const scrub=d.getElementById('scrub');
  const order=[...scrub.children].map(e=>e.id).filter(Boolean);
  if(order[0]!=='play'||order[1]!=='rate'){
    gone++; console.log('   the speed control is not beside Play: '+order.join(', '));
  }
  if(d.querySelector('.controls #rate')){
    gone++; console.log('   the speed control is still in the top row as well');
  }

  process.exit(missing.length===0&&gone===0?0:1);
},600);
