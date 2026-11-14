"""One real decision per legally replayed strategy position, without terminal grinding.

Run from a baseline or candidate checkout containing the same fixture files:
  python scripts/live-strategy-v2-qa.py --label baseline --replicates 2 --output reports/strategy-baseline.json
  python scripts/live-strategy-v2-qa.py --label candidate --replicates 2 --output reports/strategy-candidate.json
Credentials are supplied as {"base":"https://...","token":"..."} on hidden stdin.
No transport retry or failed-case resampling is automatic. --dry-run is offline.
These are bounded tactical results, not an estimate of unrestricted game win rate.
"""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess
import sys
import termios
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
VERSION = 'strategy-v2'


def node(source, payload=None):
    process = subprocess.run(['node', '--input-type=module', '-e', source], cwd=ROOT,
                             input=None if payload is None else json.dumps(payload),
                             capture_output=True, text=True, check=True, timeout=45)
    return json.loads(process.stdout)


def fixtures(extra_inference=False):
    extra = "import {publicInferenceFixture} from './test/fixtures/strategy-public-inference.mjs';" if extra_inference else ''
    expression = '[...strategyFixtures(),publicInferenceFixture()]' if extra_inference else 'strategyFixtures()'
    return node("import {strategyFixtures,serializeStrategyFixture} from './test/fixtures/strategy-v2.mjs';" + extra +
                "console.log(JSON.stringify(" + expression + ".map(serializeStrategyFixture)));")


def evaluate(case_id, commands):
    if case_id == 'mc-hero-infer-y-before-silver':
        return node("""import {readFileSync} from 'node:fs';
import {publicInferenceFixture,evaluatePublicInference} from './test/fixtures/strategy-public-inference.mjs';
const input=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(evaluatePublicInference(publicInferenceFixture(),input.commands)));
""", {'commands': commands})
    return node("""import {readFileSync} from 'node:fs';
import {strategyFixtures,evaluateStrategy} from './test/fixtures/strategy-v2.mjs';
const input=JSON.parse(readFileSync(0,'utf8')),fixture=strategyFixtures().find(f=>f.id===input.id);
if(!fixture)throw Error('Unknown fixture');console.log(JSON.stringify(evaluateStrategy(fixture,input.commands)));
""", {'id': case_id, 'commands': commands})


def credentials():
    fd = sys.stdin.fileno()
    original = termios.tcgetattr(fd) if sys.stdin.isatty() else None
    if original:
        hidden = termios.tcgetattr(fd)
        hidden[3] &= ~termios.ECHO
        termios.tcsetattr(fd, termios.TCSANOW, hidden)
    print('Ready for Site QA JSON on stdin (hidden).', flush=True)
    try:
        value = json.loads(sys.stdin.readline())
    finally:
        if original:
            termios.tcsetattr(fd, termios.TCSANOW, original)
    parsed = urllib.parse.urlsplit(value['base'])
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ['', '/']:
        raise ValueError('Expected exact HTTPS Site origin')
    return value['base'].rstrip('/'), value['token']


class Runner:
    def __init__(self, args, specs, base, token):
        self.args, self.specs, self.base, self.token = args, specs, base, token
        self.output, self.lock = pathlib.Path(args.output).resolve(), threading.RLock()
        manifest = hashlib.sha256(json.dumps(specs, sort_keys=True).encode()).hexdigest()
        self.data = json.loads(self.output.read_text()) if self.output.exists() else {
            'version': VERSION, 'label': args.label, 'base': base, 'manifestHash': manifest,
            'replicates': args.replicates, 'forcedFirstMaxTokens': args.first_max_tokens, 'httpRequests': 0, 'potentialProviderCalls': 0,
            'sourceHashes': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
                             for p in ['src/engine.mjs', 'src/ai.mjs', 'test/fixtures/strategy-v2.mjs']},
            'cases': {}}
        for key, expected in [('version', VERSION), ('label', args.label), ('base', base),
                              ('manifestHash', manifest), ('replicates', args.replicates)]:
            if self.data.get(key) != expected:
                raise ValueError('Checkpoint mismatch: ' + key)
        if self.data.get('forcedFirstMaxTokens') != args.first_max_tokens:
            raise ValueError('Checkpoint mismatch: forcedFirstMaxTokens')

    def save(self):
        with self.lock:
            self.output.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.output.with_suffix(self.output.suffix + '.tmp')
            temporary.write_text(json.dumps(self.data, ensure_ascii=False, indent=2))
            temporary.replace(self.output)

    def call(self, path, body, paid=False):
        with self.lock:
            if self.data['httpRequests'] >= 250:
                raise RuntimeError('HTTP hard cap reached')
            if paid and self.data['potentialProviderCalls'] + 2 > self.args.max_provider_calls:
                raise RuntimeError('Potential provider-call hard cap reached')
            self.data['httpRequests'] += 1
            self.data['potentialProviderCalls'] += 2 if paid else 0
            self.save()
        request = urllib.request.Request(self.base + '/api/qa' + path,
                                         data=json.dumps(body).encode(),
                                         headers={'OAI-Sites-Authorization': 'Bearer ' + self.token,
                                                  'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=210) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:
                code = json.loads(error.read()).get('code', 'HTTP_ERROR')
            except (ValueError, UnicodeDecodeError):
                code = 'NON_JSON'
            raise RuntimeError(f'HTTP {error.code} {code}; no automatic retry') from None
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            raise RuntimeError('Uncertain request result: ' + type(error).__name__ + '; no automatic retry') from None

    def run_case(self, spec, replicate):
        key = f"{spec['id']}@{replicate}"
        with self.lock:
            record = self.data['cases'].setdefault(key, {'id': spec['id'], 'replicate': replicate,
                         'seat': spec['targetSeat'], 'criterion': spec['criterion'],
                         'description': spec['description'], 'creationId': str(uuid.uuid4())})
        if 'evaluation' in record or record.get('error'):
            return
        try:
            if 'decision' not in record:
                if record.get('pendingPaid'):
                    raise RuntimeError('Previous paid request is uncertain; inspect it manually, do not resample')
                if not record.get('game'):
                    game = self.call('/games', {'mode': 'observe', 'budget': .2, 'script': spec['script'],
                                               'requestId': record['creationId']})
                    record['game'] = {'id': game['id'], 'revision': game['revision']}
                    self.save()
                game = record['game']
                if not record.get('fixtureReady'):
                    if game['revision'] != 0:
                        raise RuntimeError('Unexpected initial game revision')
                    game = self.call('/games/' + game['id'] + '/fixture-step', {
                        'revision': game['revision'], 'commandId': str(uuid.uuid4()),
                        'commands': [entry['command'] for entry in spec['commands']]})
                    target = spec['target']
                    assert (game['revision'], game['phaseId'], game['day'], game['loop'], game['turn']) == (
                        target['revision'], target['phase'], target['day'], target['loop'], spec['targetSeat'])
                    assert 'secret' not in game and 'roles' not in game['script']
                    record['game'] = {'id': game['id'], 'revision': game['revision']}
                    record['fixtureReady'] = True
                    self.save()
                body = {'revision': record['game']['revision'], 'commandId': str(uuid.uuid4())}
                if self.args.first_max_tokens is not None:
                    body['qaFirstMaxTokens'] = self.args.first_max_tokens
                record['pendingPaid'] = body
                self.save()
                started = time.monotonic()
                result = self.call('/games/' + record['game']['id'] + '/ai-step', body, paid=True)
                record['latencySeconds'] = round(time.monotonic() - started, 3)
                decision = result.get('qaDecision')
                if not isinstance(decision, dict):
                    raise RuntimeError('QA decision receipt missing; cannot score private cards safely')
                record['decision'] = decision
                record.pop('pendingPaid', None)
                self.save()
            decision = record['decision']
            if decision.get('automatic'):
                raise RuntimeError('Automatic engine choice is not a model benchmark')
            if not isinstance(decision.get('commands'), list) or not decision['commands']:
                raise RuntimeError('No command in model receipt')
            record['evaluation'] = evaluate(spec['id'], decision['commands'])
            print(json.dumps({'case': key, **record['evaluation'], 'latencySeconds': record.get('latencySeconds'),
                              'spentEstimate': decision.get('spentEstimate')}, ensure_ascii=False), flush=True)
        except Exception as error:
            record['error'] = str(error) or type(error).__name__
            print(json.dumps({'case': key, 'error': record['error']}, ensure_ascii=False), flush=True)
        finally:
            self.save()

    def run(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.args.workers) as pool:
            work = [pool.submit(self.run_case, spec, replicate) for spec in self.specs
                    for replicate in range(1, self.args.replicates + 1)]
            for future in concurrent.futures.as_completed(work):
                future.result()
        records = list(self.data['cases'].values())
        results = [r for r in records if 'evaluation' in r]
        self.data['summary'] = {
            'scheduled': len(self.specs) * self.args.replicates, 'scored': len(results),
            'passed': sum(bool(r['evaluation']['passed']) for r in results),
            'legal': sum(bool(r['evaluation']['legal']) for r in results),
            'errors': sum(bool(r.get('error')) for r in records),
            'spentEstimate': sum(float(r.get('decision', {}).get('spentEstimate') or 0) for r in records),
            'repairAttempts': sum(int(r.get('decision', {}).get('repairAttempts') or 0) for r in records),
            'bySide': {side: {'scored': len(selected := [r for r in results if (r['seat'] == 'M') == (side == 'mastermind')]),
                              'passed': sum(bool(r['evaluation']['passed']) for r in selected)}
                       for side in ['mastermind', 'heroes']},
            'scope': 'One decision per legal fixture with fixed local suffix; not full-game win rate.'}
        self.save()
        print(json.dumps(self.data['summary'], ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label', default='candidate')
    parser.add_argument('--replicates', type=int, choices=[1, 2, 3], default=1)
    parser.add_argument('--workers', type=int, choices=[1, 2], default=2)
    parser.add_argument('--ids', nargs='*')
    parser.add_argument('--extra-inference', action='store_true', help='Include the separately held-out public-inference position')
    parser.add_argument('--output', default='reports/strategy-v2-qa.json')
    parser.add_argument('--max-provider-calls', type=int, default=64)
    parser.add_argument('--first-max-tokens', type=int, choices=[1, 64, 128], help='QA fault injection: deliberately limit the first request; report separately from ordinary play')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    specs = fixtures(args.extra_inference)
    if args.ids:
        unknown = set(args.ids) - {s['id'] for s in specs}
        if unknown:
            parser.error('Unknown fixture IDs: ' + ', '.join(sorted(unknown)))
        specs = [s for s in specs if s['id'] in args.ids]
    if args.dry_run:
        print(json.dumps([{'id': s['id'], 'seat': s['targetSeat'], 'prefixCommands': len(s['commands']),
                           'legalActions': s['legalActionCount'], 'criterion': s['criterion']} for s in specs], ensure_ascii=False, indent=2))
        return
    if len(specs) * args.replicates * 2 > args.max_provider_calls:
        parser.error('Requested suite exceeds the potential provider-call cap')
    base, token = credentials()
    Runner(args, specs, base, token).run()


if __name__ == '__main__':
    main()
