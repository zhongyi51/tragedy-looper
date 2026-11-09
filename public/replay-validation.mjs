// Imported files are untrusted. Reject incompatible snapshots before rendering.
export function validateReplay(data,catalog){
 const fail=()=>{throw Error('回放结构无效或包含未知内容，请使用本游戏导出的回放。');};
 const obj=x=>x&&typeof x==='object'&&!Array.isArray(x),arr=x=>Array.isArray(x),str=x=>typeof x==='string',num=x=>Number.isInteger(x)&&x>=0&&x<=100000;
 const ids=new Set(catalog.characters.map(c=>c.id)),locs=new Set(catalog.locations.map(c=>c.id)),roles=new Set(catalog.roles.map(c=>c.id)),plots=new Set(catalog.plots.map(c=>c.id)),events=new Set(catalog.incidents.map(c=>c.id));
 const seats=new Set(['A','B','C','M','public']),target=x=>ids.has(x)||locs.has(x);
 const card=p=>{if(!obj(p)||!seats.has(p.seat)||!target(p.target)||(p.card!==undefined&&(!str(p.card)||!/^\w+#\d+$/.test(p.card))))fail();};
 const mappings=(map,keys,values)=>{if(!obj(map)||Object.entries(map).some(([k,v])=>!keys.has(k)||!values.has(v)))fail();};
 if(!obj(data)||data.format!=='tragedy-replay-1'||!arr(data.frames)||!data.frames.length||data.frames.length>5000)fail();
 for(const f of data.frames){
  const v=f?.view,s=v?.script;
  if(!obj(v)||!obj(s)||!str(s.title)||!['FS','BTX'].includes(s.ruleset)||!num(s.days)||!num(s.loops)||!arr(s.characters)||s.characters.some(x=>!ids.has(x))||!arr(s.incidents))fail();
  if(s.incidents.some(e=>!obj(e)||!num(e.day)||(e.type!==undefined&&!events.has(e.type))))fail();
  if(!num(v.loop)||!num(v.day)||!num(v.revision)||!['A','B','C'].includes(v.leader)||!seats.has(v.seat)||!(v.turn===null||seats.has(v.turn))||!str(v.phase)||!str(v.phaseId)||![null,'heroes','mastermind'].includes(v.winner))fail();
  if(!obj(v.board)||!obj(v.locations)||[...locs].some(l=>!num(v.locations[l])))fail();
  for(const [id,c] of Object.entries(v.board))if(!ids.has(id)||!obj(c)||c.id!==id||!locs.has(c.location)||typeof c.present!=='boolean'||typeof c.alive!=='boolean'||['goodwill','paranoia','intrigue','guard'].some(k=>!num(c[k])))fail();
  mappings(v.knownRoles,ids,roles);
  if(!arr(v.log)||v.log.length>10000||!arr(v.placements))fail();v.placements.forEach(card);
  for(const e of v.log){if(!obj(e)||!str(e.text)||!str(e.type)||!num(e.loop)||!num(e.day))fail();if(e.cards!==undefined){if(!arr(e.cards))fail();e.cards.forEach(card);}}
  if(v.secret){mappings(v.secret.roles,ids,roles);if(!plots.has(v.secret.mainPlot)||!arr(v.secret.subPlots)||v.secret.subPlots.some(p=>!plots.has(p))||!arr(v.secret.incidents)||v.secret.incidents.some(e=>!num(e.day)||!ids.has(e.culprit)))fail();}
 }
 return data;
}

// Older public exports carried scheduled event names and named non-events.
// Preserve explicitly omniscient M frames; sanitize every public import/export.
export function sanitizePublicReplay(data){
 const clean=structuredClone(data),publicScript=s=>{if(s?.incidents)s.incidents=s.incidents.map(({day})=>({day}));};
 if(clean.perspective!=='M')publicScript(clean.script);
 for(const f of clean.frames||[]){const v=f.view;if(!v||!(clean.perspective==='public'||v.seat!=='M'))continue;
  publicScript(v.script);delete v.secret;
  for(const e of v.log||[])if(e.type==='incident'&&/^预告的「[^」]+」没有发生。$/.test(e.text))e.text=`第 ${e.day} 日预告的事件没有发生。`;
 }
 return clean;
}
