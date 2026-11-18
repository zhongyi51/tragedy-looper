"""Offline comparison of identical tactical fixtures; labels DS estimates explicitly."""
import collections,datetime,importlib.util,json,pathlib,statistics
ROOT=pathlib.Path(__file__).resolve().parents[1]
sp=importlib.util.spec_from_file_location('cost',ROOT/'scripts/summarize-cache-qa.py');cost=importlib.util.module_from_spec(sp);sp.loader.exec_module(cost)
FILES={'sol':'sol-cache-strategy-20261117.json','luna':'luna-strategy-20261117.json','hydrogen':'hydrogen-strategy-20261117.json','deepseek':'deepseek-strategy-20261117.json'}
def summarize():
 data={k:json.loads((ROOT/'reports'/v).read_text()) for k,v in FILES.items()}
 assert len({d['manifestHash'] for d in data.values()})==1,'Different test positions'
 result={}
 for model,d in data.items():
  assert d.get('summary',{}).get('scored')==22 and not d['summary']['errors'],'Unfinished suite'
  rows=list(d['cases'].values());receipts=[r['decision'] for r in rows];stats=cost.usage_summary(receipts)
  stats.update({'bySide':cost.summarize(d),'passed':sum(r['evaluation']['passed'] for r in rows),'legal':sum(r['evaluation']['legal'] for r in rows),'medianEndToEndSeconds':statistics.median(r['latencySeconds'] for r in rows),'maxEndToEndSeconds':max(r['latencySeconds'] for r in rows),'medianProviderSeconds':statistics.median(sum(u['latencyMs'] for u in r['decision']['usage'])/1000 for r in rows)})
  if model=='deepseek':
   # This run is entirely within 04:00–06:00 UTC, an unambiguous off-peak interval.
   for r in rows:
    for key in ['startedAtUTC','finishedAtUTC']:
     dt=datetime.datetime.fromisoformat(r[key]);assert dt.date()==datetime.date(2026,11,17) and 4<=dt.hour<6
   stats['peakEstimateUSD']=stats['costUSD'];stats['offPeakEstimateUSD']=stats['costUSD']/2;stats['costBasis']='token_estimate_not_invoice'
   for side in stats['bySide'].values():side['offPeakEstimateUSD']=side['costUSD']/2
  else:assert stats['providerReported'];stats['costBasis']='provider_invoice'
  result[model]=stats
 return result
if __name__=='__main__':print(json.dumps(summarize(),ensure_ascii=False,indent=2))
