// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
const fs=require('fs');
const {JSDOM}=require(process.env.NM+'/jsdom');
const raw=fs.readFileSync(SRC + '/dashcam-player.html','utf8');
const PAGEVER=(raw.match(/DCP_VERSION="([0-9.]+)"/)||[])[1];
const html=raw.replace('__DCP_TOKEN__','a'.repeat(64)).replace('__DCP_SRVVER__',PAGEVER);

function boot(store,label){
  const mem={...store};
  const dom=new JSDOM(html,{runScripts:"dangerously",url:"http://localhost:8777/",
    beforeParse(w){
      w.fetch=()=>Promise.reject(new Error('x'));
      w.HTMLCanvasElement.prototype.getContext=()=>null;
      w.URL.createObjectURL=()=>'blob:stub'; w.URL.revokeObjectURL=()=>{};
      w.indexedDB=undefined;
      Object.defineProperty(w,'localStorage',{value:{
        getItem:k=>(k in mem?mem[k]:null),
        setItem:(k,v)=>{mem[k]=String(v);},
        removeItem:k=>{delete mem[k];},
      }});
    }});
  const w=dom.window; w.onerror=()=>{};
  return new Promise(res=>setTimeout(()=>{
    const got=w.eval(`({
      mode:prefs.mode, rate:prefs.rate,
      burnTime:prefs.burnTime, statusBar:prefs.statusBar, showNames:prefs.showNames,
      scanDirs:prefs.scanDirs, autoRebuild:prefs.autoRebuild,
      wholeScale:prefs.wholeScale, exportQuality:prefs.exportQuality,
      exportStrip:prefs.exportStrip, exportTrim:prefs.exportTrim,
      exportClock:prefs.exportClock,
      uiWhole:document.getElementById('wholeScale').value,
      trim:trim.top+'/'+trim.bottom,
      lensPct:Math.round(lens.k/1.2*100), zoom:lens.zoom,
      uiNames:document.getElementById('showNames').checked,
      uiBurn:document.getElementById('burnTime').checked,
      uiRebuild:document.getElementById('autoRebuild').checked,
      uiTrimTop:document.getElementById('trimTop').value,
      uiLens:document.getElementById('lensKVal').textContent
    })`);
    res({label,got,w,mem});
  },500));
}
(async()=>{
  const want={mode:'grid',rate:1,burnTime:true,statusBar:true,
              showNames:true,scanDirs:'DCIM, SentryMode, Movies, Download/OpenAVM',autoRebuild:true,
              wholeScale:100,exportQuality:'high',exportStrip:true,exportTrim:false,
              exportClock:true,
              trim:'15/30',lensPct:30,zoom:1};
  const a=await boot({}, 'first run (nothing stored)');
  console.log('=== '+a.label+' ===');
  let ok=true;
  for(const k of Object.keys(want)){
    const good=a.got[k]===want[k];
    if(!good) ok=false;
    console.log(`  ${k.padEnd(11)} ${String(a.got[k]).padEnd(8)} ${good?'ok':'WANT '+want[k]}`);
  }
  console.log('  controls   names='+a.got.uiNames+' burn='+a.got.uiBurn+' rebuild='+a.got.uiRebuild
              +' trimTop='+a.got.uiTrimTop+' lens='+a.got.uiLens+' whole='+a.got.uiWhole);
  // The menu must SHOW the default, not merely store it: a blank select is
  // how a stored value the menu has no option for looks.
  if(a.got.uiWhole!=='100'){ ok=false; console.log('  WANT the size menu showing 100, got '+JSON.stringify(a.got.uiWhole)); }

  // An existing install: settings already chosen must survive untouched.
  const existing={
    lanePlayerSettings:JSON.stringify({mode:'lane',rate:2,burnTime:false,showNames:false,autoRebuild:false,scanDirs:'Movies'}),
    lanePlayerTrim:JSON.stringify({top:0,bottom:0}),
    lanePlayerLens:JSON.stringify({k:0,zoom:1.5})
  };
  const b=await boot(existing,'existing install (upgrade)');
  console.log('\n=== '+b.label+' ===');
  const keep={mode:'lane',rate:2,burnTime:false,showNames:false,autoRebuild:false,scanDirs:'Movies',
              trim:'0/0',lensPct:0,zoom:1.5};
  for(const k of Object.keys(keep)){
    const good=b.got[k]===keep[k];
    if(!good) ok=false;
    console.log(`  ${k.padEnd(11)} ${String(b.got[k]).padEnd(8)} ${good?'kept':'ALTERED - want '+keep[k]}`);
  }
  // An install from before a recorder moved its recordings.
  //
  // The folder list is stored, so a stored one wins over the default - which
  // meant that adding Download/OpenAVM to the default reached nobody who
  // already had the player. Their list was not a choice, it was what the
  // player put there, so it is brought up to date. A list somebody has
  // actually edited is theirs and is left exactly as it is.
  const old = await boot({
    lanePlayerSettings: JSON.stringify({ scanDirs: 'DCIM, SentryMode, Movies', rate: 2 })
  }, 'an install from before the move');
  console.log('\n=== ' + old.label + ' ===');
  if (!/download\/openavm/i.test(old.got.scanDirs)) {
    ok = false;
    console.log('  scanDirs   ' + old.got.scanDirs + '  WANT the new folder added');
  } else console.log('  scanDirs   ' + old.got.scanDirs + '  brought up to date');
  // Everything else they had chosen survives it.
  if (old.got.rate !== 2) { ok = false; console.log('  rate       ' + old.got.rate + '  ALTERED - want 2'); }
  // And it is written back, so it is not worked out afresh every time and the
  // Folders field shows what is actually being scanned.
  const saved = JSON.parse(old.mem.lanePlayerSettings || '{}');
  if (!/download\/openavm/i.test(saved.scanDirs || '')) {
    ok = false;
    console.log('  stored     ' + saved.scanDirs + '  WANT it written back');
  }

  // A list somebody typed themselves is not touched, whatever is added to the
  // default afterwards.
  const mine = await boot({
    lanePlayerSettings: JSON.stringify({ scanDirs: 'BlackBoxCam, Movies' })
  }, 'a list of my own');
  if (mine.got.scanDirs !== 'BlackBoxCam, Movies') {
    ok = false;
    console.log('  a chosen folder list was overwritten: ' + mine.got.scanDirs);
  }

  // The tick box that hid sentry events is gone - they are half of what this
  // player is for. The risk is the upgrade: someone who had left it unticked
  // has "sentry":false sitting in their stored settings, and if anything
  // still read it their sentry events would stay hidden with no control left
  // to bring them back.
  const c=await boot({lanePlayerSettings:JSON.stringify({sentry:false})},'upgrade with sentry events hidden');
  console.log('\n=== '+c.label+' ===');
  const shown=c.w.eval(`(function(){
    segments.length=0;
    segments.push({name:'drive.mp4',status:'ok',start:2,session:'s',sentry:false,missing:false,
                   file:{name:'drive.mp4',relPath:'drive.mp4',size:9},sidecar:null,view:null});
    segments.push({name:'alert.mp4',status:'ok',start:1,session:'s',sentry:true,missing:false,
                   file:{name:'alert.mp4',relPath:'alert.mp4',size:9},sidecar:null,view:null});
    return viewOrder().map(i=>segments[i].name);
  })()`);
  const hasAlert=shown.includes('alert.mp4');
  if(!hasAlert) ok=false;
  console.log('  listed     '+JSON.stringify(shown)+'   '+(hasAlert?'ok':'WANT the sentry event listed'));
  if(c.w.document.getElementById('sentry')) { ok=false; console.log('  the sentry tick box is still there'); }

  console.log('\nVERDICT: '+(ok?'defaults applied on first run; existing settings untouched':'PROBLEM'));
  process.exit(ok?0:1);
})();
