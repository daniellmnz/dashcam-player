// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
const fs=require('fs');
const {JSDOM}=require(process.env.NM+'/jsdom');
const raw=fs.readFileSync(SRC + '/dashcam-player.html','utf8');
const V=(raw.match(/DCP_VERSION="([0-9.]+)"/)||[])[1];
const html=raw.replace('__DCP_TOKEN__','a'.repeat(64)).replace('__DCP_SRVVER__',V);
const mem={
  lanePlayerSettings:JSON.stringify({mode:'lane',rate:2,burnTime:false,showNames:false,
    autoRebuild:false,scanDirs:'Movies',statusBar:false,sortAsc:true,wholeScale:60,exportQuality:'standard',exportStrip:false,exportTrim:true}),
  lanePlayerTrim:JSON.stringify({top:40,bottom:5}),
  lanePlayerLens:JSON.stringify({k:1.0,zoom:1.8}),
  lanePlayerViews:JSON.stringify([0,1]),
  };
const dom=new JSDOM(html,{runScripts:"dangerously",url:"http://localhost:8777/",
  beforeParse(w){ w.fetch=()=>Promise.reject(new Error('x'));
    w.HTMLCanvasElement.prototype.getContext=()=>null;
    w.URL.createObjectURL=()=>'blob:stub'; w.URL.revokeObjectURL=()=>{}; w.indexedDB=undefined;
    w.requestAnimationFrame=cb=>setTimeout(cb,0);
    Object.defineProperty(w,'localStorage',{value:{
      getItem:k=>(k in mem?mem[k]:null), setItem:(k,v)=>{mem[k]=String(v);},
      removeItem:k=>{delete mem[k];}}}); }});
const w=dom.window; w.onerror=()=>{};
setTimeout(()=>{
  const before=w.eval(`({mode:prefs.mode,trim:trim.top+'/'+trim.bottom,names:prefs.showNames,views:[...shown].length})`);
  console.log('before reset:', JSON.stringify(before));
  w.eval(`document.getElementById('reset').onclick()`);
  const after=w.eval(`({
    mode:prefs.mode, rate:prefs.rate, sortAsc:prefs.sortAsc,
    burnTime:prefs.burnTime, statusBar:prefs.statusBar, showNames:prefs.showNames,
    scanDirs:prefs.scanDirs, autoRebuild:prefs.autoRebuild, wholeScale:prefs.wholeScale, exportQuality:prefs.exportQuality, exportStrip:prefs.exportStrip, exportTrim:prefs.exportTrim,
    uiWhole:document.getElementById('wholeScale').value,
    trim:trim.top+'/'+trim.bottom, lensPct:Math.round(lens.k/1.2*100), zoom:lens.zoom,
    views:[...shown].length,
    uiNames:document.getElementById('showNames').checked,
    uiScan:document.getElementById('scanDirs').value,
    uiRebuild:document.getElementById('autoRebuild').checked,
    uiStatus:document.getElementById('statusBar').checked,
    uiSort:document.getElementById('sortAsc').checked,
    uiBurn:document.getElementById('burnTime').checked,
    uiRate:document.getElementById('rate').value,
    uiTrimTop:document.getElementById('trimTop').value,
    uiTrimBot:document.getElementById('trimBottom').value,
    uiLens:document.getElementById('lensKVal').textContent,
    uiZoom:document.getElementById('lensZoom').value
  })`);
  const want={mode:'grid',rate:1,sortAsc:false,burnTime:true,
    statusBar:true,showNames:true,scanDirs:'DCIM, SentryMode, Movies, Download/OpenAVM',autoRebuild:true,wholeScale:100,uiWhole:'100',exportQuality:'high',exportStrip:true,exportTrim:false,
    trim:'15/30',lensPct:30,zoom:1,views:8,
    uiNames:true,uiScan:'DCIM, SentryMode, Movies, Download/OpenAVM',uiRebuild:true,uiStatus:true,uiSort:false,uiBurn:true,
    uiRate:'1',uiTrimTop:'15',uiTrimBot:'30',uiLens:'30%',uiZoom:'1'};
  let ok=true;
  console.log('\nafter reset:');
  for(const k of Object.keys(want)){
    const good=after[k]===want[k]; if(!good) ok=false;
    console.log(`  ${k.padEnd(11)} ${String(after[k]).padEnd(7)} ${good?'ok':'WANT '+want[k]}`);
  }
  console.log('\nVERDICT: '+(ok?'reset restores every stated default, state and controls together':'PROBLEM'));
  process.exit(ok?0:1);
},500);
