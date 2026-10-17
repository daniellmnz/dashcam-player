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
  const r={};
  // esc() itself
  r.escaped=esc(EVIL);
  // the split panel, which interpolates splitLabel and st.detail
  splitLabel=EVIL;
  splitPanel("Making single view file",'<p>'+esc(splitLabel)+'</p>');
  const msg=document.getElementById('msg');
  r.panelImgs=msg.getElementsByTagName('img').length;
  r.panelText=msg.textContent.slice(0,60);
  // a quote-breaking attribute payload against the rebuild download link
  const Q='a" onfocus="window.__fired=2" x="';
  r.attrEscaped=esc(Q);
  r.fired=window.__fired||0;
  return r;
 })()`);
 console.log('esc() output          :',JSON.stringify(out.escaped));
 console.log('attribute payload esc :',JSON.stringify(out.attrEscaped));
 console.log('panel <img> elements  :',out.panelImgs);
 console.log('panel shows literally :',JSON.stringify(out.panelText));
 console.log('payload executed      :',out.fired);
 const ok=out.panelImgs===0&&out.fired===0&&!/[<>"]/.test(out.escaped);
 console.log(ok?'\nVERDICT: panels safe':'\nVERDICT: PROBLEM');
 process.exit(ok?0:1);
},500);
