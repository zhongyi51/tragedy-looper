"""Paired cache-layout probes on the same legally replayed full script.
No model decision changes the replay; raw provider invoices are retained.
"""
import argparse, hashlib, importlib.util, json, pathlib, urllib.request, urllib.error, uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('qa',ROOT/'scripts/live-strategy-v2-qa.py');qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**kw): raise RuntimeError('Redirect; not retried')
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--profiles',nargs='+',default=['sol-legacy','sol-system','sol-history']);p.add_argument('--per-loop',type=int,default=3);a=p.parse_args()
 out=pathlib.Path(a.output)
 if out.exists(): raise RuntimeError('Existing report; never repeat uncertain paid work')
 base,token=qa.credentials();opener=urllib.request.build_opener(NoRedirect)
 trace=qa.node("""import {createGame,turn,botCommand,applyCommand,automaticCommand} from './src/engine.mjs';import {getCuratedScript} from './src/script-library.mjs';
const script=getCuratedScript('curated-last-ward');let s=createGame(script);const commands=[],positions=[];
for(let n=0;n<600&&!s.winner;n++){const seat=turn(s);if(!automaticCommand(s)&&!(s.phase==='mm_cards'&&s.placements.length))positions.push({revision:s.revision,seat,phase:s.phase,loop:s.loop,day:s.day});const command=botCommand(s,seat);commands.push(command);s=applyCommand(s,seat,command);}
if(!s.winner)throw Error('Unfinished trace');console.log(JSON.stringify({script,commands,positions,winner:s.winner}));""")
 data={'version':'cache-layout-1','profiles':a.profiles,'trace':trace,'sourceHashes':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in ['src/prompt-cache.mjs','src/ai.mjs','src/model-provider.mjs','worker/index.mjs']},'rows':[],'caveat':'Paired evolving legal positions, first three non-forced decisions of each side per loop; not model-vs-model win rates.'}
 def save():out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(data,ensure_ascii=False,indent=2))
 def call(path,body=None):
  req=urllib.request.Request(base+'/api/qa'+path,data=None if body is None else json.dumps(body).encode(),headers={'OAI-Sites-Authorization':'Bearer '+token,'Content-Type':'application/json'})
  try:
   with opener.open(req,timeout=210) as r:return json.load(r)
  except urllib.error.HTTPError as e:
   try:msg=json.loads(e.read())
   except Exception:msg={'code':'NON_JSON'}
   raise RuntimeError(f"HTTP {e.code}: {msg.get('code')} {msg.get('error','')}; no retry") from None
 game=call('/games',{'mode':'observe','opponent':'ai','aiProvider':'openrouter','budget':4,'script':trace['script'],'requestId':str(uuid.uuid4())});data['gameId']=game['id'];save()
 for i in range(0,len(trace['commands']),80):
  game=call('/games/'+game['id']+'/fixture-step',{'revision':game['revision'],'commands':trace['commands'][i:i+80],'commandId':str(uuid.uuid4())})
 data['terminalRevision']=game['revision'];save()
 for side in ['M','heroes']:
  chosen=[]
  for loop in sorted({x['loop'] for x in trace['positions']}):
   chosen.extend([x for x in trace['positions'] if x['loop']==loop and (x['seat']=='M')==(side=='M')][:a.per_loop])
  for profile in a.profiles:
   for pos in chosen:
    row={'profile':profile,'side':side,**pos,'pendingPaid':True};data['rows'].append(row);save()
    try:
     result=call('/games/'+game['id']+'/ai-step',{'revision':game['revision'],'qaProfile':profile,'qaProbeRevision':pos['revision']})
     row['decision']=result['qaDecision'];row.pop('pendingPaid');save()
     print(json.dumps({'profile':profile,'side':side,'revision':pos['revision'],'usage':[u['normalizedUsage'] for u in row['decision']['usage']],'cost':sum(u['estimatedCost'] for u in row['decision']['usage'])}),flush=True)
    except Exception as e:row['error']=str(e);save();raise
 ledger=call('/games/'+game['id']+'/usage');final=call('/games/'+game['id']);receipts=[u for row in data['rows'] for u in row['decision']['usage']];total=sum(u['estimatedCost'] for u in receipts)
 assert len(ledger)==len(receipts) and abs(sum(u['estimatedCost'] for u in ledger)-total)<1e-9 and abs(final['spent']-total)<1e-9
 data['ledgerVerified']={'callCount':len(ledger),'ledgerTotal':sum(u['estimatedCost'] for u in ledger),'gameSpent':final['spent'],'receiptTotal':total};data['complete']=True;save()
if __name__=='__main__':main()
