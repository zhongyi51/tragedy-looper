"""Bounded real-provider QA on changing game states and complete AI authoring.

Uses the isolated, temporarily enabled Sites QA namespace. Credentials enter on
hidden stdin; no retries, credential files, or private user saves are involved.
Run: python scripts/live-provider-cache-qa.py --output reports/provider-cache.json
"""
import argparse
import datetime
import importlib.util
import hashlib
import json
import pathlib
import time
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('strategy_qa', ROOT / 'scripts/live-strategy-v2-qa.py')
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('Unexpected redirect; request not retried')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--providers', nargs='+', choices=['deepseek', 'openrouter'], default=['deepseek', 'openrouter'])
    parser.add_argument('--decisions', type=int, choices=range(1, 7), default=4)
    parser.add_argument('--author', action='store_true')
    parser.add_argument('--qa-profile',choices=['hydrogen-low','hydrogen-high'])
    args = parser.parse_args()
    if args.qa_profile and (args.providers!=['openrouter'] or args.author):parser.error('QA model profile requires only openrouter and no authoring')
    out = pathlib.Path(args.output).resolve()
    if out.exists():
        raise RuntimeError('Use a new output path; never automatically repeat uncertain paid work')
    base, token = qa.credentials()
    opener = urllib.request.build_opener(NoRedirect)
    report = {'version': 'provider-cache-v1', 'base': base, 'httpRequests': 0,
              'purpose': 'Actual evolving states and seats, not repeated identical prompts; bounded integration QA, not model win rates.',
              'games': [], 'authors': [], 'qaProfile':args.qa_profile,
              'sourceHashes': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
                               for p in ['src/ai.mjs', 'src/model-provider.mjs', 'src/game-prompt.mjs', 'src/author.mjs']}}

    def save():
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2))

    def call(path, body=None):
        if report['httpRequests'] >= 350:
            raise RuntimeError('HTTP hard cap reached')
        report['httpRequests'] += 1
        save()
        req = urllib.request.Request(base + '/api/qa' + path,
              data=None if body is None else json.dumps(body).encode(),
              headers={'OAI-Sites-Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with opener.open(req, timeout=210) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:
                code = json.loads(error.read()).get('code', 'HTTP_ERROR')
            except (ValueError, UnicodeDecodeError):
                code = 'NON_JSON'
            raise RuntimeError(f'HTTP {error.code} {code}; not retried') from None

    report['info'] = call('/info')
    script = qa.node("import {getCuratedScript} from './src/script-library.mjs';console.log(JSON.stringify(getCuratedScript('curated-last-ward')));")
    for provider in args.providers:
        record = {'provider': provider, 'decisions': []}
        report['games'].append(record)
        try:
            game = call('/games', {'mode': 'observe', 'opponent': 'ai', 'aiProvider': provider,
                                  'script': script, 'budget': 1, 'requestId': str(uuid.uuid4())})
            record['gameId'] = game['id']
            real = 0
            for step in range(args.decisions + 8):
                if real >= args.decisions or game.get('winner'):
                    break
                item = {'revision': game['revision'], 'phase': game['phaseId'], 'seat': game['turn'],
                        'day': game['day'], 'loop': game['loop'], 'startedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'pendingPaid': True}
                record['decisions'].append(item)
                save()
                started = time.monotonic()
                game = call('/games/' + game['id'] + '/ai-step', {'revision': game['revision'], 'commandId': str(uuid.uuid4()), **({'qaProfile':args.qa_profile} if args.qa_profile else {})})
                receipt = game.get('qaDecision')
                if receipt is None:
                    raise RuntimeError('QA decision receipt missing')
                item.update({'latencySeconds': round(time.monotonic()-started, 3), 'receipt': receipt,
                             'nextRevision': game['revision'], 'nextPhase': game['phaseId']})
                item.pop('pendingPaid')
                if not receipt.get('automatic'):
                    real += 1
                save()
                print(json.dumps({'provider': provider, 'phase': item['phase'], 'seat': item['seat'],
                                  'revision': item['revision'], 'realDecisions': real,
                                  'usage': receipt.get('usage'), 'spent': receipt.get('spentEstimate')}, ensure_ascii=False), flush=True)
            record['completedRealDecisions'] = real
            record['passed'] = real == args.decisions and all(d.get('nextRevision', -1) > d['revision'] for d in record['decisions'])
        except Exception as error:
            record['error'] = str(error)
            print(json.dumps({'provider': provider, 'error': str(error)}), flush=True)
        save()

    if args.author:
        for provider in args.providers:
            record = {'provider': provider, 'pendingPaid': True}
            report['authors'].append(record)
            save()
            try:
                started = time.monotonic()
                game = call('/games', {'mode': 'observe', 'opponent': 'bot', 'authorProvider': provider,
                    'setup': {'generation': 'ai', 'ruleset': 'FS', 'days': 2, 'loops': 2, 'incidentCount': 1,
                              'seed': 20261116, 'theme': '末班列车与消失的车票'}, 'requestId': str(uuid.uuid4())})
                record.pop('pendingPaid')
                record.update({'gameId': game['id'], 'latencySeconds': round(time.monotonic()-started, 3),
                               'title': game['script']['title'], 'intro': game['script'].get('intro')})
                assert 'secret' not in game and 'roles' not in game['script']
                for step in range(130):
                    if game.get('winner'):
                        break
                    game = call('/games/' + game['id'] + '/bot-step', {'revision': game['revision'], 'commandId': str(uuid.uuid4()), **({'qaProfile':args.qa_profile} if args.qa_profile else {})})
                if not game.get('winner'):
                    raise RuntimeError('Generated game did not terminate within bounded offline steps')
                replay = call('/games/' + game['id'] + '/replay?full=1')
                authored = replay['script']
                validation = qa.node("import {readFileSync} from 'node:fs';import {validateScript} from './src/content.mjs';console.log(JSON.stringify(validateScript(JSON.parse(readFileSync(0,'utf8')))));", authored)
                record.update({'validation': validation, 'winner': game['winner'], 'terminalRevision': game['revision'],
                               'generation': authored.get('generation'), 'author': authored.get('author'),
                               'passed': not validation.get('errors') and authored.get('generation', {}).get('provider') == provider})
            except Exception as error:
                record['error'] = str(error)
            save()
            print(json.dumps({'authorProvider': provider, 'passed': record.get('passed', False), 'error': record.get('error'), 'title': record.get('title')}, ensure_ascii=False), flush=True)
    print(json.dumps({'done': True, 'games': [{k:r.get(k) for k in ['provider','passed','error']} for r in report['games']],
                      'authors': [{k:r.get(k) for k in ['provider','passed','error']} for r in report['authors']]}), flush=True)


if __name__ == '__main__':
    main()
