import {readFileSync,writeFileSync,mkdirSync,cpSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),read=p=>readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,'');
const manifest=JSON.parse(read('.openai/hosting.json'));
if(!manifest.project_id||manifest.d1!=='DB')throw Error('需要 Sites project_id 和 DB 绑定');
const catalog=JSON.parse(read('data/catalog.json'));
// Deterministic single-module bundle; no runtime filesystem or build dependencies.
const strip=s=>s.replace(/^import .*?;\r?\n/gm,'').replace(/\bexport (?=(?:const|let|function|async function|class)\b)/g,'');
let content=strip(read('src/content.mjs')).replace(/const catalog=.*?;\r?\n/,`const catalog=${JSON.stringify(catalog)};\n`);
let ai=strip(read('src/ai.mjs')).replace("process.env.DEEPSEEK_API_KEY||''","''").replace("process.env.DEEPSEEK_MODEL||'deepseek-flash'","'deepseek-flash'").replace("(process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com')","('https://api.deepseek.com')").replace('Buffer.byteLength(JSON.stringify(messages))','new TextEncoder().encode(JSON.stringify(messages)).length');
const assets={},add=(url,p,type)=>assets[url]={data:readFileSync(path.join(root,p)).toString('base64'),type};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
// Same rule as the local server: the client is every known file type under public/.
for(const d of readdirSync(path.join(root,'public'),{recursive:true,withFileTypes:true}).filter(d=>d.isFile()&&types[path.extname(d.name)]).sort((a,b)=>path.join(a.parentPath,a.name).localeCompare(path.join(b.parentPath,b.name)))){const p=path.relative(root,path.join(d.parentPath,d.name)).split(path.sep).join('/');add(p.replace(/^public/,''),p,types[path.extname(d.name)]);}
assets['/']=assets['/index.html'];
for(const c of catalog.characters)for(const key of ['portrait','card'])add('/'+c[key],c[key],'image/png');
for(const n of ['click_001','drop_001','confirmation_001','error_001','glitch_001','bong_001','open_001'])add('/assets/audio/Audio/'+n+'.ogg','assets/audio/Audio/'+n+'.ogg','audio/ogg');
const bundle="import {createHash} from 'node:crypto';\n"+content+'\n'+strip(read('src/engine.mjs'))+'\n'+ai+'\n'+strip(read('src/play.mjs'))+'\n'+strip(read('worker/index.mjs'))+'\nconst ASSETS='+JSON.stringify(assets)+';\nexport default createWorker(ASSETS);\n';
if(/sk-[a-zA-Z0-9]{20,}/.test(bundle))throw Error('疑似凭据，不可构建');
mkdirSync(path.join(root,'dist/server'),{recursive:true});mkdirSync(path.join(root,'dist/.openai'),{recursive:true});
writeFileSync(path.join(root,'dist/server/index.js'),bundle);
writeFileSync(path.join(root,'dist/server/wrangler.json'),JSON.stringify({name:'tragedy-looper',main:'index.js',compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat']},null,2));
writeFileSync(path.join(root,'dist/.openai/hosting.json'),JSON.stringify(manifest,null,2));
cpSync(path.join(root,'drizzle'),path.join(root,'dist/.openai/drizzle'),{recursive:true});
console.log(JSON.stringify({assets:Object.keys(assets).length,bundleBytes:Buffer.byteLength(bundle),secretsEmbedded:false}));
