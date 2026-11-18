// Both servers use the same owner-scoped queries and optimistic revision check.
const summary='id,title,revision,updated';
const invalid=(message,status=400)=>Object.assign(Error(message),{status,code:status===409?'DRAFT_CONFLICT':'DRAFT_ERROR'});

export async function workshopDrafts({path,method,owner,body,all,one}){
 const id=path.slice('/api/scripts/drafts'.length+1);
 if(!id&&method==='GET')return all('SELECT '+summary+' FROM workshop_drafts WHERE owner=? ORDER BY updated DESC,id',owner);
 if(!/^[a-f0-9-]{36}$/.test(id))throw invalid('找不到这份草稿',404);
 const read=()=>one('SELECT '+summary+',content FROM workshop_drafts WHERE owner=? AND id=?',owner,id);
 if(method==='GET'){
  const draft=await read();
  if(!draft)throw invalid('找不到这份草稿',404);
  return draft;
 }
 if(method!=='POST')throw invalid('请选择读取或保存草稿',405);
 const {content,revision}=await body();
 if(typeof content!=='string'||!content.trim()||!Number.isSafeInteger(revision)||revision<0)throw invalid('草稿内容或版本无效');
 let title='未命名草稿';
 try{const draft=JSON.parse(content);if(typeof draft?.title==='string'&&draft.title.trim())title=draft.title.trim().slice(0,120);}catch{/* Keep unfinished JSON editable. */}
 const updated=new Date().toISOString();
 const saved=revision===0
  ?await one('INSERT INTO workshop_drafts(owner,id,title,content,revision,updated) VALUES(?,?,?,?,1,?) ON CONFLICT(owner,id) DO NOTHING RETURNING '+summary,owner,id,title,content,updated)
  :await one('UPDATE workshop_drafts SET title=?,content=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=? RETURNING '+summary,title,content,updated,owner,id,revision);
 if(saved)return saved;
 const current=await read();
 if(current?.content===content){const {content:stored,...metadata}=current;return metadata;}
 throw invalid('这份草稿已有新版本。可另存副本保留本次修改，或重新打开已保存的版本。',409);
}
