"""Summarize matched provider receipts; never infer unrestricted game win rates."""
import argparse,collections,json

def usage_summary(receipts):
 rows=[u for d in receipts for u in d.get('usage',[])]
 out={'decisions':len(receipts),'calls':len(rows),'repairs':sum(d.get('repairAttempts',0) for d in receipts)}
 out['costUSD']=sum(u['estimatedCost'] for u in rows)
 out['providerReported']=all(u.get('costKind')=='provider_reported' for u in rows)
 for key in ['inputTokens','cachedInputTokens','cacheWriteTokens','outputTokens','reasoningTokens']:
  out[key]=sum(u.get('normalizedUsage',{}).get(key,0) for u in rows)
 out['cacheHitFraction']=out['cachedInputTokens']/out['inputTokens'] if out['inputTokens'] else 0
 out['inputCostUSD']=sum(u.get('usage',{}).get('cost_details',{}).get('upstream_inference_prompt_cost',0) for u in rows)
 out['outputCostUSD']=sum(u.get('usage',{}).get('cost_details',{}).get('upstream_inference_completions_cost',0) for u in rows)
 return out

def summarize(data):
 groups=collections.defaultdict(list)
 if data.get('version')=='cache-layout-1':
  for row in data['rows']:
   if 'decision' in row:groups[row['side']+'/'+row['profile']].append(row['decision'])
  return {k:usage_summary(v) for k,v in groups.items()}
 for row in data['cases'].values():
  groups['mastermind' if row['seat']=='M' else 'heroes'].append(row)
 return {side:{**usage_summary([r['decision'] for r in rows if 'decision' in r]),'scheduled':len(rows),'passed':sum(r.get('evaluation',{}).get('passed',False) for r in rows),'legal':sum(r.get('evaluation',{}).get('legal',False) for r in rows),'errors':sum('error' in r for r in rows),'failures':[{'id':r['id'],'replicate':r['replicate'],'reason':r.get('decision',{}).get('reason'),'error':r.get('error')} for r in rows if not r.get('evaluation',{}).get('passed')]} for side,rows in groups.items()}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('paths',nargs='+');a=p.parse_args()
 print(json.dumps({path:summarize(json.load(open(path))) for path in a.paths},ensure_ascii=False,indent=2))
