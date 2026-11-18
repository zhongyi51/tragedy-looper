"""Reproduce the cost totals from provider receipts; no network access."""
import collections
import json
import pathlib
import sys

def summarize(path):
    report = json.loads(pathlib.Path(path).read_text())
    result = {}
    for side, game in report['games'].items():
        steps = [s for s in game['steps'] if s.get('receipt', {}).get('usage')]
        calls = [u for s in steps for u in s['receipt']['usage']]
        cost = sum(u['estimatedCost'] for u in calls)
        tokens = {key: sum(u['normalizedUsage'][key] for u in calls)
                  for key in ['inputTokens','cachedInputTokens','cacheWriteTokens','outputTokens','reasoningTokens']}
        input_cost = sum(u['usage']['cost_details']['upstream_inference_prompt_cost'] for u in calls)
        by_loop = collections.defaultdict(lambda: {'calls':0, 'cost':0})
        for step in steps:
            by_loop[step['loop']]['calls'] += len(step['receipt']['usage'])
            by_loop[step['loop']]['cost'] += sum(u['estimatedCost'] for u in step['receipt']['usage'])
        result[side] = {'complete':bool(game.get('winner')), 'sampleOnly':game.get('sampleOnly',False),
            'passed':game.get('passed',False), 'calls':len(calls), 'cost':cost,
            'inputCost':input_cost, 'outputCost':cost-input_cost, 'inputCostShare':input_cost/cost if cost else 0,
            'tokens':tokens, 'cacheHitShare':tokens['cachedInputTokens']/tokens['inputTokens'] if tokens['inputTokens'] else 0,
            'repairs':sum(s['receipt']['repairAttempts'] for s in steps),
            'callsByPhase':dict(collections.Counter(s['phase'] for s in steps)), 'byLoop':dict(by_loop),
            'firstCall':calls[0] if calls else None, 'lastCall':calls[-1] if calls else None,
            'budgetChecks':game.get('budgetChecks'), 'error':game.get('error')}
        if game.get('passed'):
            assert abs(cost-game['spent'])<1e-8
        if 'ledger' in game:
            assert len(calls)==len(game['ledger'])
            assert abs(cost-sum(u['estimatedCost'] for u in game['ledger']))<1e-8
            result[side]['firstReservation']=game['ledger'][0]['reserved'] if calls else None
            result[side]['lastReservation']=game['ledger'][-1]['reserved'] if calls else None
        assert all(u['costKind']=='provider_reported' for u in calls), 'Do not label estimates as actual bills'
    return result

if __name__ == '__main__':
    print(json.dumps({path:summarize(path) for path in sys.argv[1:]}, ensure_ascii=False, indent=2))
