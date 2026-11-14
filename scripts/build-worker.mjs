import {readFileSync,writeFileSync,mkdirSync,cpSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),read=p=>readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,'');
const manifest=JSON.parse(read('.openai/hosting.json'));
if(!manifest.project_id||manifest.d1!=='DB')throw Error('需要 Sites project_id 和 DB 绑定');
const catalog=JSON.parse(read('data/catalog.json'));
// Bundle this dependency-free named-export module graph. Each module keeps its
// own scope, so shared helper names cannot collide when adding authoring services.
// Unsupported syntax or cycles fail the build rather than silently dropping code.
const modules=new Map(),visiting=new Set(),chunks=[];
const namedBindings=text=>text.split(',').map(x=>x.trim()).filter(Boolean).map(x=>x.replace(/\s+as\s+/,':')).join(',');
function bundleModule(file){
 if(modules.has(file))return modules.get(file);
 if(visiting.has(file))throw Error('Circular Worker dependency: '+file);
 visiting.add(file);const id='mod_'+modules.size+'_'+visiting.size,exports=new Map();
 let source=read(file);
 if(file==='src/content.mjs')source=source.replace(/^import \{readFileSync\} from 'node:fs';\r?\n/m,'').replace(/^export const catalog=.*?;\r?\n/m,`export const catalog=${JSON.stringify(catalog)};\n`);
 if(file==='src/model-provider.mjs')source=source.replace("process.env.DEEPSEEK_API_KEY||''","''").replace("process.env.DEEPSEEK_MODEL||'deepseek-flash'","'deepseek-flash'").replace("(process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com')","('https://api.deepseek.com')").replaceAll('Buffer.byteLength(JSON.stringify(messages))','new TextEncoder().encode(JSON.stringify(messages)).length');
 const dependency=specifier=>{
  if(specifier==='node:crypto')return 'runtimeCrypto';
  if(!specifier.startsWith('.'))throw Error('Unsupported Worker import '+specifier+' in '+file);
  const next=path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier));
  if(next.startsWith('../'))throw Error('Worker import leaves source tree');
  return bundleModule(next);
 };
 source=source.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];\r?\n/gm,(_all,bindings,specifier)=>`const {${namedBindings(bindings)}}=${dependency(specifier)};\n`);
 source=source.replace(/^export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?\r?\n/gm,(_all,names,specifier)=>{
  const module=dependency(specifier);for(const item of names.split(',')){const [local,alias]=item.trim().split(/\s+as\s+/);if(local)exports.set(alias||local,`${module}.${local}`);}return '';
 });
 source=source.replace(/^export\s*\{([^}]+)\};?\r?\n/gm,(_all,names)=>{for(const item of names.split(',')){const [local,alias]=item.trim().split(/\s+as\s+/);if(local)exports.set(alias||local,local);}return '';});
 source=source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\b)/g,(match,offset)=>{
  const name=source.slice(offset+match.length).match(/^(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/)?.[1];
  if(!name)throw Error('Unsupported Worker export in '+file);exports.set(name,name);return '';
 });
 if(/^\s*(?:import\s|export\s)/m.test(source))throw Error('Unsupported module declaration in '+file);
 visiting.delete(file);modules.set(file,id);
 chunks.push(`const ${id}=(()=>{\n${source}\nreturn {${[...exports].map(([name,value])=>`${name}:${value}`).join(',')}};\n})();`);
 return id;
}
const assets={},add=(url,p,type)=>assets[url]={data:readFileSync(path.join(root,p)).toString('base64'),type};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
// Same rule as the local server: the client is every known file type under public/.
for(const d of readdirSync(path.join(root,'public'),{recursive:true,withFileTypes:true}).filter(d=>d.isFile()&&types[path.extname(d.name)]).sort((a,b)=>path.join(a.parentPath,a.name).localeCompare(path.join(b.parentPath,b.name)))){const p=path.relative(root,path.join(d.parentPath,d.name)).split(path.sep).join('/');add(p.replace(/^public/,''),p,types[path.extname(d.name)]);}
assets['/']=assets['/index.html'];
for(const c of catalog.characters)for(const key of ['portrait','card'])add('/'+c[key],c[key],'image/png');
for(const n of ['click_001','drop_001','confirmation_001','error_001','glitch_001','bong_001','open_001'])add('/assets/audio/Audio/'+n+'.ogg','assets/audio/Audio/'+n+'.ogg','audio/ogg');
const entry=bundleModule('worker/index.mjs');
const bundle="import * as runtimeCrypto from 'node:crypto';\n"+chunks.join('\n')+'\nconst ASSETS='+JSON.stringify(assets)+`;\nexport default ${entry}.createWorker(ASSETS);\n`;
if(/sk-[a-zA-Z0-9]{20,}/.test(bundle))throw Error('疑似凭据，不可构建');
mkdirSync(path.join(root,'dist/server'),{recursive:true});mkdirSync(path.join(root,'dist/.openai'),{recursive:true});
writeFileSync(path.join(root,'dist/server/index.js'),bundle);
writeFileSync(path.join(root,'dist/server/wrangler.json'),JSON.stringify({name:'tragedy-looper',main:'index.js',compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat']},null,2));
writeFileSync(path.join(root,'dist/.openai/hosting.json'),JSON.stringify(manifest,null,2));
cpSync(path.join(root,'drizzle'),path.join(root,'dist/.openai/drizzle'),{recursive:true});
console.log(JSON.stringify({assets:Object.keys(assets).length,bundleBytes:Buffer.byteLength(bundle),secretsEmbedded:false}));
