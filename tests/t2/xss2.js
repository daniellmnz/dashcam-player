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
    w.indexedDB=undefined; w.__fired=0; }});
const w=dom.window; w.onerror=()=>{};
setTimeout(()=>{
 const out=w.eval(`(function(){
  const EVIL='rec<img src=x onerror="window.__fired=1">.mp4';
  segments.length=0;
  segments.push({name:EVIL,session:'s1',start:Date.now(),number:1,status:'ok',
    file:{name:EVIL,size:1},view:'Front',sidecar:{result:'OK',frameHealth:null}});
  prefs.showNames=true; collapsed.clear(); renderList();
  const list=document.getElementById('list');
  const tags=[...list.querySelectorAll('*')].map(e=>e.tagName).join(',');
  const hv=list.innerHTML;
  // Where does the literal "<img" sit - in text, or inside an attribute value?
  const i=hv.indexOf('<img');
  return {tags, fired:window.__fired||0,
    imgElements:list.getElementsByTagName('img').length,
    context: i<0?null:hv.slice(Math.max(0,i-30),i+20),
    // Re-parse the serialized markup: if the <img were live, this would find it.
    reparseImgs:(()=>{const d=document.createElement('div');d.innerHTML=hv;
      return d.getElementsByTagName('img').length;})()};
 })()`);
 console.log('elements in #list      :',out.tags);
 console.log('live <img> elements    :',out.imgElements);
 console.log('payload executed       :',out.fired);
 console.log('"<img" found at        :',out.context?JSON.stringify(out.context):'not present');
 console.log('re-parsed <img> count  :',out.reparseImgs,'(attribute value is inert)');
 const safe=out.fired===0&&out.imgElements===0&&out.reparseImgs===0;
 console.log(safe?'\nVERDICT: payload neutralised - rendered as literal text':'\nVERDICT: STILL VULNERABLE');
 process.exit(safe?0:1);
},500);
