"""Complete curated-script games with Sol on one side and offline bots on the other.
Credentials arrive on hidden stdin. No automatic paid-request retries.
Run: python scripts/live-cost-qa.py --output reports/sol-cost-baseline.json
"""
import argparse
import concurrent.futures
import importlib.util
import json
import pathlib
import threading
import time
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('qa', ROOT / 'scripts/live-strategy-v2-qa.py')
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('Unexpected redirect; not retried')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--sides', nargs='+', choices=['mastermind', 'heroes'], default=['mastermind', 'heroes'])
    args = parser.parse_args()
    out = pathlib.Path(args.output).resolve()
    if out.exists():
        raise RuntimeError('Output already exists; do not repeat uncertain paid work')
    base, token = qa.credentials()
    lock = threading.Lock()
    report = {'version':'sol-cost-1', 'scriptId':'curated-last-ward', 'games':{},
              'limits':{'budgetPerGameUSD':2, 'maxStepsPerGame':250},
              'caveat':'One full original 4-day/3-loop FS script per side; not a win-rate study.'}
    def save():
        with lock:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    def run(side):
        opener = urllib.request.build_opener(NoRedirect)
        record = {'side':side, 'steps':[]}
        report['games'][side] = record
        def call(path, body=None):
            request = urllib.request.Request(base+'/api/qa'+path,
                data=None if body is None else json.dumps(body).encode(),
                headers={'OAI-Sites-Authorization':'Bearer '+token, 'Content-Type':'application/json'})
            try:
                with opener.open(request, timeout=210) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                try: data = json.loads(error.read())
                except Exception: data = {'code':'NON_JSON'}
                raise RuntimeError(f"HTTP {error.code} {data.get('code')} {data.get('error','')}; not retried") from None
        try:
            record['info'] = call('/info')
            game = call('/games', {'mode':'heroes' if side=='mastermind' else 'mastermind',
                'opponent':'ai','aiProvider':'openrouter','libraryId':'curated-last-ward','budget':2,'requestId':str(uuid.uuid4())})
            record['gameId'] = game['id']
            for step in range(250):
                if game.get('winner'): break
                paid = (game['turn']=='M') == (side=='mastermind')
                route = 'ai-step' if paid else 'bot-step'
                item = {'revision':game['revision'],'seat':game['turn'],'phase':game['phaseId'],
                        'loop':game['loop'],'day':game['day'],'route':route,'pending':True}
                record['steps'].append(item)
                save()
                started = time.monotonic()
                game = call('/games/'+game['id']+'/'+route, {'revision':game['revision'],'commandId':str(uuid.uuid4())})
                item.update({'nextRevision':game['revision'],'seconds':round(time.monotonic()-started,3)})
                if paid:
                    item['receipt'] = game['qaDecision']
                    print(json.dumps({'side':side, 'loop':item['loop'],'day':item['day'],'phase':item['phase'],
                        'calls':len(item['receipt']['usage']),'spent':item['receipt']['spentEstimate'],
                        'usage':[u.get('normalizedUsage') for u in item['receipt']['usage']]}),flush=True)
                item.pop('pending')
                save()
            record.update({'winner':game.get('winner'),'terminalRevision':game['revision'],'spent':game.get('spent')})
            if not game.get('winner'): raise RuntimeError('Step cap reached')
            record['ledger'] = call('/games/'+game['id']+'/usage')
            record['passed'] = abs(sum(x['estimatedCost'] for x in record['ledger'])-record['spent'])<1e-8
        except Exception as error:
            record['error'] = str(error)
            print(json.dumps({'side':side,'error':str(error)}),flush=True)
        save()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(run,args.sides))
    print(json.dumps({'done':True,'results':{s:{k:g.get(k) for k in ['passed','spent','winner','error']} for s,g in report['games'].items()}}),flush=True)

if __name__ == '__main__': main()
