"""Bounded isolated Sites QA. Read {base, token} from hidden stdin; never save credentials."""
import concurrent.futures
import json
import pathlib
import sys
import termios
import urllib.error
import urllib.request
import uuid

fd = sys.stdin.fileno()
old = termios.tcgetattr(fd)
hidden = termios.tcgetattr(fd)
hidden[3] &= ~termios.ECHO
termios.tcsetattr(fd, termios.TCSANOW, hidden)
print('Ready for Site QA JSON on stdin (hidden).', flush=True)
try:
    config = json.loads(sys.stdin.readline())
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)


def call(path, body=None):
    request = urllib.request.Request(
        config['base'] + '/api/qa' + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'OAI-Sites-Authorization': 'Bearer ' + config['token'], 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=115) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        payload = json.loads(error.read())
        raise RuntimeError(str(error.code) + ' ' + payload.get('code', '') + ' ' + payload.get('error', '')) from None


def check_public(view, visibility):
    assert 'secret' not in view and 'pending' not in view
    assert isinstance(view['extraGauge'], int) and view['extraGauge'] >= 0
    assert not any(k in view['script'] for k in ['roles', 'mainPlot', 'subPlots'])
    for event in view['script']['incidents']:
        assert 'culprit' not in event
        assert ('type' in event) == (visibility == 'public')


def scenario(visibility):
    setup = dict(ruleset='MC', seed=141126 if visibility == 'hidden' else 141127,
                 title='MC isolated QA ' + visibility, days=3, loops=2, mainPlot='strychnine',
                 subPlots=['isolated_psycho', 'tricky_twins'], includeAI=True, characterPool='all',
                 incidentCount=3, incidentVisibility=visibility)
    game = call('/games', dict(mode='observe', budget=.5, setup=setup))
    phases = set()
    frames = steps = 0
    maximum_gauge = 0
    assert 'ai_character' in game['script']['characters']
    print(json.dumps(dict(visibility=visibility, created=True)), flush=True)
    while not game['winner'] and steps < 200:
        check_public(game, visibility)
        phases.add(game['phaseId'])
        revision = game['revision']
        game = call('/games/' + game['id'] + '/ai-step', dict(revision=revision, commandId=str(uuid.uuid4())))
        assert game['revision'] > revision and not game['busy']
        check_public(game, visibility)
        for frame in game.get('transitionFrames', []):
            check_public(frame, visibility)
            maximum_gauge = max(maximum_gauge, frame['extraGauge'])
        maximum_gauge = max(maximum_gauge, game['extraGauge'])
        frames += len(game.get('transitionFrames', []))
        steps += 1
        if steps % 5 == 0:
            print(json.dumps(dict(visibility=visibility, steps=steps, phase=game['phaseId'], day=game['day'], loop=game['loop'])), flush=True)
    assert game['winner'], 'No terminal outcome'
    replay = call('/games/' + game['id'] + '/replay')
    for frame in replay['frames']:
        check_public(frame['view'], visibility)
    usage = call('/games/' + game['id'] + '/usage')
    result = dict(visibility=visibility, steps=steps, winner=game['winner'], providerCalls=len(usage),
                  spentEstimate=game['spent'], transitionFrames=frames, replayFrames=len(replay['frames']),
                  maximumGauge=maximum_gauge, phases=sorted(phases))
    print(json.dumps(result), flush=True)
    return result


info = call('/info')
assert info['version'] == '0.5.0' and info['configured']
print(json.dumps(dict(version=info['version'], aiConfigured=True)), flush=True)
results = []
errors = []
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    futures = {executor.submit(scenario, visibility): visibility for visibility in ['hidden', 'public']}
    for future in concurrent.futures.as_completed(futures):
        try:
            results.append(future.result())
        except Exception as error:
            errors.append(dict(visibility=futures[future], error=str(error)))
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'reports/mc-live-qa.json')
out.write_text(json.dumps(dict(version=info['version'], results=results, errors=errors), indent=2))
print('LIVE_QA_FAIL' if errors else 'LIVE_QA_PASS', flush=True)
sys.exit(1 if errors else 0)
