"""Bounded, resumable owner-private QA. Credentials enter through hidden stdin only.

Examples (run from the repository root):
  python scripts/live-v06-qa.py --suite author
  python scripts/live-v06-qa.py --suite play
  python scripts/live-v06-qa.py --suite tactics
All suites share the report checkpoint. A failed paid step is never silently retried.
"""
import argparse
import concurrent.futures
import json
import pathlib
import subprocess
import sys
import termios
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid

VERSION = '0.6.0'
MAX_POTENTIAL_PROVIDER_CALLS = 360  # Author: up to four; gameplay decision: up to two.
MAX_HTTP_REQUESTS = 2500
MAX_GAME_STEPS = 240
ROOT = pathlib.Path(__file__).resolve().parents[1]


class QAError(RuntimeError):
    pass


class ApiError(QAError):
    def __init__(self, status, code, message=''):
        self.status, self.code = status, code
        super().__init__(f'{status} {code}: {message[:240]}')


def read_credentials():
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd) if sys.stdin.isatty() else None
    if old:
        hidden = termios.tcgetattr(fd)
        hidden[3] &= ~termios.ECHO
        termios.tcsetattr(fd, termios.TCSANOW, hidden)
    print('Ready for Site QA JSON on stdin (hidden).', flush=True)
    try:
        value = json.loads(sys.stdin.readline())
    finally:
        if old:
            termios.tcsetattr(fd, termios.TCSANOW, old)
    parsed = urllib.parse.urlsplit(value['base'])
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise QAError('Provide the exact HTTPS Site origin without credentials or query parameters')
    return value['base'].rstrip('/'), value['token']


def check_public(view):
    assert 'secret' not in view and 'pending' not in view and 'privateDesign' not in view
    script = view['script']
    if script['ruleset'] == 'MC':
        assert 'extraGauge' in view, 'MC public view is missing the EX gauge'
    assert isinstance(view.get('extraGauge', 0), int) and view.get('extraGauge', 0) >= 0
    assert not any(k in script for k in ['roles', 'mainPlot', 'subPlots', 'privateDesign', 'seed', 'generation'])
    assert script.get('settings', {}).get('incidentVisibility') == 'public'
    for event in script['incidents']:
        assert 'culprit' not in event and isinstance(event.get('type'), str)
    for frame in view.get('transitionFrames', []):
        check_public(frame)


def load_tactics():
    source = """
import {tacticalFixtures} from './test/fixtures/tactics.mjs';
import {applyCommand,turn,legalActions} from './src/engine.mjs';
const quiet=s=>{
 const options=legalActions(s),a=options.find(a=>a.command.type==='place'&&a.command.card==='goodwill_1#0'&&['hospital','shrine','school','city'].includes(a.command.target))
 ||options.find(a=>a.command.type==='pass')||options.find(a=>a.command.type==='refusal'&&!a.command.refuse)||options[0];
 return applyCommand(s,turn(s),a.command);
};
const finish=s=>{const {day,loop}=s;for(let n=0;n<80&&s.day===day&&s.loop===loop&&!['over','between','guess'].includes(s.phase);n++)s=quiet(s);return s;};
console.log(JSON.stringify(tacticalFixtures().map(({state,...f})=>({...f,
 target:{revision:state.revision,phase:state.phase,day:state.day,loop:state.loop},
 winningCommands:f.id==='btx-rescue-movement'?legalActions(state).filter(a=>a.command.type==='place'&&a.command.card.startsWith('move_')).filter(a=>{const end=finish(applyCommand(state,turn(state),a.command));return end.board.idol.alive&&end.loop===state.loop&&end.day===state.day+1;}).map(a=>a.command):[]
}))));
"""
    completed = subprocess.run(['node', '--input-type=module', '-e', source], cwd=ROOT, check=True, capture_output=True, text=True, timeout=30)
    return json.loads(completed.stdout)


class Runner:
    def __init__(self, args, base, token):
        self.args, self.base, self.token = args, base, token
        self.output = pathlib.Path(args.output).resolve()
        self.lock, self.paid_gate = threading.RLock(), threading.BoundedSemaphore(2)
        self.data = json.loads(self.output.read_text()) if self.output.exists() else {
            'version': VERSION, 'base': base, 'runId': str(uuid.uuid4()), 'potentialProviderCalls': 0,
            'httpRequests': 0, 'author': {}, 'play': {}, 'tactics': {}, 'errors': []}
        if self.data.get('version') != VERSION or self.data.get('base') != base:
            raise QAError('Checkpoint belongs to a different version or Site')

    def save(self):
        with self.lock:
            self.output.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.output.with_suffix(self.output.suffix + '.tmp')
            temporary.write_text(json.dumps(self.data, ensure_ascii=False, indent=2))
            temporary.replace(self.output)

    def call(self, path, body=None, paid=False, potential_calls=2):
        with self.lock:
            if self.data['httpRequests'] >= MAX_HTTP_REQUESTS:
                raise QAError('HTTP request hard cap reached')
            if paid and self.data['potentialProviderCalls'] + potential_calls > MAX_POTENTIAL_PROVIDER_CALLS:
                raise QAError('Potential provider call hard cap reached')
            self.data['httpRequests'] += 1
            if paid:
                self.data['potentialProviderCalls'] += potential_calls
            self.save()
        request = urllib.request.Request(
            self.base + '/api/qa' + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={'OAI-Sites-Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'},
        )
        # The Worker may finish a bounded author repair before returning.
        with self.paid_gate:
            try:
                with urllib.request.urlopen(request, timeout=210) as response:
                    result = json.load(response)
            except urllib.error.HTTPError as error:
                try:
                    payload = json.loads(error.read())
                except (ValueError, UnicodeDecodeError):
                    raise ApiError(error.code, 'NON_JSON', 'Response was not JSON') from None
                raise ApiError(error.code, payload.get('code', 'HTTP_ERROR'), str(payload.get('error', ''))) from None
            except (urllib.error.URLError, TimeoutError, ValueError) as error:
                # No transport retry: the server may have applied or billed the request.
                raise QAError('Request result uncertain; inspect the saved request before any retry (' + type(error).__name__ + ')') from None
        return result

    def expect_denied(self, path, body=None, code='GAME_NOT_OVER'):
        try:
            self.call(path, body)
        except ApiError as error:
            assert error.status == 403 and error.code == code, str(error)
        else:
            raise AssertionError('Pre-terminal private review was exposed')

    def create(self, section, key, payload):
        with self.lock:
            record = self.data[section].setdefault(key, {})
            if record.get('error') and self.args.retry_failed and (not record.get('gameId') or section == 'tactics'):
                previous = {k: v for k, v in record.items() if k not in ['creation', 'pendingStep', 'previousAttempts']}
                history = record.get('previousAttempts', []) + [previous]
                record.clear()
                record['previousAttempts'] = history
            existing_id = record.get('gameId')
            if not existing_id and 'creation' not in record:
                record['creation'] = {**payload, 'requestId': str(uuid.uuid4())}
            first = not record.get('creationSent')
            record['creationSent'] = True
            self.save()
        game = self.call('/games/' + existing_id) if existing_id else self.call('/games', record['creation'], paid=first and payload.get('setup', {}).get('generation') == 'ai', potential_calls=4)
        # Persist the committed game before any assertion. A QA assertion failure
        # must be resumable without making another authored game.
        with self.lock:
            record['gameId'] = game['id']
            self.save()
        check_public(game)
        if record.get('creationIdempotent'):
            record.pop('error', None)
            self.save()
            return game, record
        # The exact receipt must return the same game without authoring again.
        duplicate = self.call('/games', record['creation'])
        assert duplicate['id'] == game['id'] and duplicate['revision'] == game['revision']
        assert duplicate['script'] == game['script']
        if not game.get('winner'):
            self.expect_denied('/games/' + game['id'] + '/review')
            self.expect_denied('/games/' + game['id'] + '/feedback', {'rating': 'interesting'})
        record['creationIdempotent'] = True
        record.pop('error', None)
        self.save()
        return game, record

    def step(self, game, record, route, command=None):
        if record.get('pendingStep'):
            pending = record['pendingStep']
            current = self.call('/games/' + game['id'])
            if current['revision'] > pending['revision']:
                record.pop('pendingStep')
                record['steps'] = record.get('steps', 0) + 1
                self.save()
                return current
            if not self.args.retry_failed:
                raise QAError('Previous step is uncertain or failed; no automatic paid retry. Inspect it before --retry-failed.')
            record.pop('pendingStep')
        body = {'revision': game['revision'], 'commandId': str(uuid.uuid4())}
        if command is not None:
            body['command'] = command
        record['pendingStep'] = {**body, 'route': route}
        self.save()
        result = self.call('/games/' + game['id'] + '/' + route, body, paid=route == 'ai-step')
        assert result['revision'] > game['revision'] and not result['busy']
        check_public(result)
        record.pop('pendingStep')
        record['steps'] = record.get('steps', 0) + 1
        record['transitionFrames'] = record.get('transitionFrames', 0) + len(result.get('transitionFrames', []))
        record['maximumGauge'] = max(record.get('maximumGauge', 0), result.get('extraGauge', 0), *(f.get('extraGauge', 0) for f in result.get('transitionFrames', [])))
        self.save()
        return result

    def terminal_checks(self, game, record):
        assert game.get('winner'), 'Game did not reach a terminal outcome'
        check_public(game)
        replay = self.call('/games/' + game['id'] + '/replay')
        for frame in replay['frames']:
            check_public(frame['view'])
        assert replay['frames'][-1]['view']['winner'] == game['winner']
        review = self.call('/games/' + game['id'] + '/review')
        assert review['title'] == game['script']['title'] and review['alternatives']
        revision = game['revision']
        self.call('/games/' + game['id'] + '/feedback', {'rating': 'interesting'})
        assert self.call('/games/' + game['id'] + '/review')['feedback']['rating'] == 'interesting'
        reloaded = self.call('/games/' + game['id'])
        assert reloaded['revision'] == revision
        usage = self.call('/games/' + game['id'] + '/usage')
        record.update(winner=game['winner'], providerCalls=len(usage), spentEstimate=game['spent'], replayFrames=len(replay['frames']), reviewAvailable=True, feedbackPersisted=True, feedbackDidNotAdvance=True, complete=True,
                      reviewSummary=review.get('summary'), qualitySummary=review.get('quality'), designSummary={k: review.get('design', {}).get(k) for k in ['premise', 'threatPlan', 'counterplay', 'cluePlan', 'loopPlan'] if review.get('design', {}).get(k)})
        full = self.call('/games/' + game['id'] + '/replay?full=1')
        assert full['perspective'] == 'M'
        record['authoredScript'] = full['script']
        record.pop('error', None)
        assert game['spent'] <= .5 + 1e-9
        self.save()

    def author(self, ruleset):
        setup = {'generation': 'ai', 'ruleset': ruleset, 'lengthPreset': 'quick', 'difficulty': 'standard', 'days': 3, 'loops': 2,
                 'incidentCount': 3 if ruleset == 'MC' else 2, 'incidentVisibility': 'public', 'characterPool': 'standard',
                 'includeAI': ruleset in ['MZ', 'MC'], 'theme': '雨停之后的旧街', 'seed': 26111400 + ['FS', 'BTX', 'MZ', 'MC'].index(ruleset)}
        if ruleset == 'MC' and self.args.mc_constrained:
            setup.update(mainPlot='tightrope_plan', subPlots=['isolated_psycho', 'master_detective'],
                         characters=['ai_character', 'police', 'office_worker', 'doctor', 'boy_student', 'shrine_maiden', 'girl_student', 'patient'])
        game, record = self.create('author', ruleset, {'mode': 'observe', 'budget': .5, 'setup': setup})
        assert game['script']['ruleset'] == ruleset and game['script'].get('source') == 'ai'
        assert game['script']['days'] == 3 and game['script']['loops'] == 2
        assert len(game['script']['incidents']) == setup['incidentCount']
        if setup['includeAI']:
            assert 'ai_character' in game['script']['characters']
        record.update(passed=True, title=game['script']['title'], ruleset=ruleset, publicSchedule=game['script']['incidents'])
        self.save()
        print(json.dumps({'suite': 'author', 'ruleset': ruleset, 'passed': True}, ensure_ascii=False), flush=True)

    def play(self, ruleset):
        author = self.data['author'].get(ruleset)
        if not author or not author.get('passed'):
            raise QAError('Run the author suite successfully for ' + ruleset + ' first')
        record = self.data['play'].setdefault(ruleset, {'gameId': author['gameId'], 'controller': 'ai' if ruleset in ['FS', 'MC'] and not self.args.bot_only else 'bot'})
        if record.get('complete'):
            return
        game = self.call('/games/' + record['gameId'])
        while not game['winner'] and record.get('steps', 0) < MAX_GAME_STEPS:
            game = self.step(game, record, 'ai-step' if record['controller'] == 'ai' else 'bot-step')
            if record['steps'] % 5 == 0:
                print(json.dumps({'suite': 'play', 'ruleset': ruleset, 'steps': record['steps'], 'day': game['day'], 'loop': game['loop'], 'phase': game['phaseId']}), flush=True)
        self.terminal_checks(game, record)
        print(json.dumps({'suite': 'play', 'ruleset': ruleset, 'complete': True, 'providerCalls': record['providerCalls'], 'winner': game['winner']}), flush=True)

    def tactic(self, spec):
        key = spec['id']
        game, record = self.create('tactics', key, {'mode': 'observe', 'budget': .5, 'script': spec['script']})
        if record.get('complete'):
            assert record.get('tacticPassed'), record.get('tacticFailure', 'Previous tactical decision failed')
            return
        if not record.get('modelDecisionDone'):
            if not record.get('fixtureReady'):
                # fixture-step executes exactly one engine command, with no automatic skip.
                for index in range(game['revision'], len(spec['commands'])):
                    game = self.step(game, record, 'fixture-step', spec['commands'][index]['command'])
                    assert game['revision'] == index + 1
                assert game['revision'] == spec['target']['revision'] and game['phaseId'] == spec['target']['phase']
                assert game['day'] == spec['target']['day'] and game['loop'] == spec['target']['loop']
                record['fixtureReady'] = True
                record['targetRevision'] = game['revision']
                record['targetLogLength'] = len(game['log'])
                self.save()
            game = self.step(game, record, 'ai-step')
            record['modelDecisionDone'] = True
            record['modelDecisionRevision'] = game['revision']
            self.save()
        if 'tacticPassed' not in record:
            try:
                if key == 'mc-silver-bullet':
                    new_log = game['log'][record['targetLogLength']:]
                    chosen = any(e.get('type') == 'ability' and e.get('who') == 'ai_character' and '第 3 日' in e.get('text', '') for e in new_log)
                    assert chosen, 'Real model did not select the available silver-bullet ability'
                    while not game['winner'] and game['day'] == spec['target']['day'] and record.get('steps', 0) < MAX_GAME_STEPS:
                        game = self.step(game, record, 'bot-step')
                    assert game['winner'] == 'heroes', 'Silver-bullet choice did not lead to the expected win'
                elif key == 'btx-rescue-movement':
                    while not game['winner'] and game['day'] == spec['target']['day'] and game['loop'] == spec['target']['loop'] and record.get('steps', 0) < MAX_GAME_STEPS:
                        game = self.step(game, record, 'bot-step')
                    reveal = next((e for e in game['log'][record['targetLogLength']:] if e.get('type') == 'cards' and e.get('day') == spec['target']['day'] and e.get('loop') == spec['target']['loop']), None)
                    assert reveal, 'The real model card never became publicly revealed'
                    card = next((p for p in reveal.get('cards', []) if p.get('seat') == spec['targetSeat']), None)
                    assert card, 'Could not identify the real model seat in the revealed cards'
                    picked = {'type': 'place', 'card': card['card'], 'target': card['target']}
                    record['modelChoice'] = picked
                    assert picked in spec['winningCommands'], 'The real model did not choose a movement that independently rescues the key person'
                    record['standaloneRescueVerified'] = True
                    assert game['board']['idol']['alive'] and game['loop'] == spec['target']['loop'], 'The key person was not rescued through this night'
                    assert game['day'] > spec['target']['day'] or game['winner'] == 'heroes'
                    assert not any(e.get('type') == 'death' and e.get('who') == 'idol' for e in game['log'][record['targetLogLength']:])
                record['tacticPassed'] = True
            except AssertionError as error:
                # Finish using the local bot to unlock accounting even when the
                # real model made a poor decision. Do not misreport this as success.
                record['tacticPassed'] = False
                record['tacticFailure'] = str(error)
            self.save()
        while not game['winner'] and record.get('steps', 0) < MAX_GAME_STEPS:
            game = self.step(game, record, 'bot-step')
        self.terminal_checks(game, record)
        assert record['providerCalls'] >= 1, 'Tactical case did not make a real provider request'
        assert record['tacticPassed'], record.get('tacticFailure', 'Tactical decision failed')
        print(json.dumps({'suite': 'tactics', 'case': key, 'passed': True, 'providerCalls': record['providerCalls']}), flush=True)

    def parallel(self, section, items, action, key=lambda x: x):
        failures = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = {executor.submit(action, item): key(item) for item in items}
            for future in concurrent.futures.as_completed(futures):
                item = futures[future]
                try:
                    future.result()
                except Exception as error:
                    entry = {'suite': section, 'case': item, 'error': str(error) or type(error).__name__}
                    failures.append(entry)
                    self.data[section].setdefault(item, {})['error'] = entry['error']
                    print(json.dumps(entry, ensure_ascii=False), flush=True)
                self.save()
        return failures

    def run(self):
        info = self.call('/info')
        assert info['version'] == VERSION and info['configured'], 'Wrong version or missing model configuration'
        print(json.dumps({'version': info['version'], 'aiConfigured': True, 'suite': self.args.suite}), flush=True)
        errors = []
        if self.args.suite in ['author', 'all']:
            errors += self.parallel('author', self.args.rulesets, self.author)
        if self.args.suite in ['play', 'all']:
            ready = [r for r in self.args.rulesets if self.data['author'].get(r, {}).get('passed')]
            if self.args.suite == 'play' and len(ready) != len(self.args.rulesets):
                raise QAError('Some author cases are missing; run --suite author first')
            errors += self.parallel('play', ready, self.play)
        if self.args.suite in ['tactics', 'all']:
            errors += self.parallel('tactics', load_tactics(), self.tactic, key=lambda x: x['id'])
        self.data['errors'] = [{'suite': section, 'case': key, 'error': record['error']}
                               for section in ['author', 'play', 'tactics']
                               for key, record in self.data[section].items() if record.get('error')]
        self.data['lastSuite'] = self.args.suite
        self.data['lastSuitePassed'] = not errors
        self.data['allRequiredPassed'] = (all(self.data['author'].get(r, {}).get('passed') and self.data['play'].get(r, {}).get('complete') for r in ['FS', 'BTX', 'MZ', 'MC'])
                                          and all(self.data['tactics'].get(k, {}).get('tacticPassed') and self.data['tactics'].get(k, {}).get('complete') for k in ['mc-silver-bullet', 'btx-rescue-movement'])
                                          and not self.data['errors'])
        self.save()
        print('LIVE_QA_FAIL' if errors else 'LIVE_QA_PASS', flush=True)
        return 1 if errors else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', choices=['author', 'play', 'tactics', 'all'], default='all')
    parser.add_argument('--output', default=str(ROOT / 'reports/v06-live-qa.json'))
    parser.add_argument('--rulesets', choices=['FS', 'BTX', 'MZ', 'MC'], nargs='+', default=['FS', 'BTX', 'MZ', 'MC'])
    parser.add_argument('--retry-failed', action='store_true', help='Explicitly allow retrying a previously failed paid operation after inspecting its state')
    parser.add_argument('--bot-only', action='store_true', help='Finish newly authored scripts with offline bots; does not count as a real-model full-game test')
    parser.add_argument('--mc-constrained', action='store_true', help='Test advanced MC rule/cast constraints; does not count as unconstrained generation success')
    args = parser.parse_args()
    base, token = read_credentials()
    runner = Runner(args, base, token)
    try:
        return runner.run()
    except Exception as error:
        runner.data['errors'].append({'suite': args.suite, 'error': str(error) or type(error).__name__})
        runner.save()
        print(json.dumps({'suite': args.suite, 'error': str(error) or type(error).__name__}, ensure_ascii=False), flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
