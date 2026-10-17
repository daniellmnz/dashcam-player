// Found from this file's own location, so the suite travels with the
// repository rather than pointing at one machine's folders.
const SRC = process.env.DCP_SRC
  || require('path').resolve(__dirname, '..', '..', 'src');
const {JSDOM}=require(process.env.NM+'/jsdom'), fs=require('fs'), c=require('crypto');
const html=fs.readFileSync(SRC + '/dashcam-player.html','utf8');
const d=new JSDOM(html), doc=d.window.document;
const t=doc.querySelector('script').textContent;
const h='sha256-'+c.createHash('sha256').update(t,'utf8').digest('base64');
const meta=doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
const declared=(meta.match(/sha256-[A-Za-z0-9+/=]+/)||[])[0];
let bad=[];
doc.querySelectorAll('*').forEach(el=>{for(const a of el.attributes) if(/^on/i.test(a.name)) bad.push(a.name);});
const ok = declared===h && bad.length===0;
if(!ok){ console.log('CSP hash mismatch or inline handler present'); console.log(' declared',declared); console.log(' actual  ',h); }
process.exit(ok?0:1);
