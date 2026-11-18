"""Bounded real-provider checks for the structured script author.

Run from the repository root with --output pointing to a private checkpoint.
The Site origin and bypass credential enter through hidden stdin, never argv or
the checkpoint. A successful receipt is replayed to check idempotency. An
uncertain paid creation is not retried automatically, even across restarts.
These eight samples test validity and integration, not adversarial balance.
"""
import argparse
import concurrent.futures
import importlib.util
import json
import pathlib
import subprocess
import sys
import threading
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('live_v06_qa', ROOT / 'scripts/live-v06-qa.py')
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
# Reuse the existing authenticated transport and hidden-stdin handling, with
# smaller caps appropriate to this author-only suite.
legacy.MAX_POTENTIAL_PROVIDER_CALLS = 32
legacy.MAX_HTTP_REQUESTS = 160
CHECKPOINT_VERSION = 'structured-author-qa-2'
AUTHOR_VERSION = 'script-author-3'
RULESETS = ['FS', 'BTX', 'MZ', 'MC']

VALIDATE_JS = r"""
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateScript,publicScript,contentHash} from './src/content.mjs';
import {AUTHOR_VERSION,authoredScriptHash} from './src/author.mjs';
import {compileDesign} from './src/script-design.mjs';
import {probeScript} from './src/script-probe.mjs';
import {evaluateScriptQuality} from './src/script-quality.mjs';
const {script,setup}=JSON.parse(readFileSync(0,'utf8')),generation=script.generation;
assert.deepEqual(validateScript(script).errors,[]);
const quality=evaluateScriptQuality(script);
assert.equal(quality.accepted,true,JSON.stringify(quality.issues));
assert.equal(script.source,'ai');
assert.equal(script.ruleset,setup.ruleset);
assert.equal(script.days,setup.days);
assert.equal(script.loops,setup.loops);
assert.equal(script.incidents.length,setup.incidentCount);
assert.equal(script.seed,setup.seed);
assert.equal(script.communication,setup.communication??'between_loops_only');
assert.equal(script.settings.incidentVisibility,'public');
if(setup.includeAI)assert.ok(script.characters.includes('ai_character'));
assert.equal(generation.version,AUTHOR_VERSION);
assert.equal(generation.pipeline,'plan-compile-select');
const requestedTheme=String(setup.theme??'').trim().slice(0,300);
assert.equal(generation.theme,requestedTheme);
assert.equal(generation.captionSource,requestedTheme?'public-theme-model':'neutral-template');
assert.equal(generation.captionAttempts,requestedTheme?1:0);
assert.deepEqual(script.specialRules,[],'Atmosphere cannot introduce extra rules');
assert.ok(Object.keys(generation.plan).every(key=>['mainPlot','subPlots','characters','days','loops','incidentCount','settings'].includes(key)));
assert.equal(generation.contentHash,contentHash);
assert.equal(generation.scriptHash,authoredScriptHash(script));
const explicitPlan=['mainPlot','characters','days','loops','incidentCount'].every(key=>setup[key]!==undefined)&&Array.isArray(setup.subPlots)&&setup.subPlots.every(Boolean);
assert.equal(generation.planSource,explicitPlan?'user':'model');
if(setup.mainPlot)assert.equal(script.mainPlot,setup.mainPlot);
for(const [index,id]of (setup.subPlots||[]).entries())if(id)assert.equal(script.subPlots[index],id);
if(setup.characters)assert.deepEqual(script.characters,setup.characters);
assert.equal(generation.plan.mainPlot,script.mainPlot);
assert.deepEqual(generation.plan.subPlots,script.subPlots);
assert.deepEqual(generation.plan.characters,script.characters);
assert.equal(generation.plan.days,script.days);
assert.equal(generation.plan.loops,script.loops);
assert.equal(generation.plan.incidentCount,script.incidents.length);
for(const [key,value]of Object.entries(generation.plan.settings))assert.deepEqual(script.settings[key],value);
assert.ok(generation.candidateCount>=1&&generation.candidateCount<=6);
assert.ok(generation.compiledCandidateCount>=generation.candidateCount&&generation.compiledCandidateCount<=24);
assert.equal(generation.attemptedCandidateCount,24);
assert.match(generation.chosenId,/^candidate-([1-9]|1[0-9]|2[0-4])$/);
assert.ok(explicitPlan?generation.planAttempts===0:generation.planAttempts>=1&&generation.planAttempts<=2);
assert.ok(generation.selectionAttempts>=1&&generation.selectionAttempts<=2);
assert.ok(Number.isInteger(generation.usage.requests)&&generation.usage.requests>=1&&generation.usage.requests<=(requestedTheme?5:4));
assert.equal(generation.usage.requests,generation.captionAttempts+generation.planAttempts+generation.selectionAttempts);
assert.equal(generation.attempts,generation.usage.requests);
assert.ok(Number.isFinite(generation.usage.estimatedCost)&&generation.usage.estimatedCost>=0&&generation.usage.estimatedCost<=.12+1e-9);
assert.equal(generation.usage.unknownRequests,0);
assert.equal(generation.usage.rejectedRequests,0);
const compiled=compileDesign(script,generation.designGrounding.selection,{difficulty:script.difficulty});
assert.deepEqual(compiled.grounding,generation.designGrounding);
assert.deepEqual(compiled.design,script.privateDesign);
const probe=generation.probe;
assert.equal(probe.version,'engine-probe-1');
assert.equal(probe.scope,'private');
assert.ok(['completed','limited'].includes(probe.status));
assert.ok(probe.commands<=400&&probe.traces.length<=2);
assert.ok(probe.traces.every(t=>t.commands<=200&&!t.error));
const before=JSON.stringify(script),independentProbe=probeScript(script,{
 profiles:4,maxCommands:1600,maxCommandsPerTrace:800,maxMs:5000,seed:setup.seed+1000
});
assert.equal(JSON.stringify(script),before,'Independent probe mutated frozen script');
assert.ok(['completed','limited'].includes(independentProbe.status));
assert.ok(independentProbe.traces.every(t=>!t.error));
assert.equal(authoredScriptHash(script),generation.scriptHash);
console.log(JSON.stringify({valid:true,quality,publicScript:publicScript(script),independentProbe,
 plan:generation.plan,usage:generation.usage,candidateCount:generation.candidateCount,
 captionAttempts:generation.captionAttempts,planAttempts:generation.planAttempts,selectionAttempts:generation.selectionAttempts,
 chosenId:generation.chosenId,probe:generation.probe}));
"""


def validate_locally(script, setup):
    result = subprocess.run(
        ['node', '--input-type=module', '-e', VALIDATE_JS], cwd=ROOT,
        input=json.dumps({'script': script, 'setup': setup}), capture_output=True,
        text=True, timeout=30,
    )
    if result.returncode:
        raise legacy.QAError('Local validation failed: ' + result.stderr[-3000:])
    return json.loads(result.stdout)


class Runner(legacy.Runner):
    def __init__(self, args, base, token):
        self.args, self.base, self.token = args, base, token
        self.output = pathlib.Path(args.output).resolve()
        self.lock, self.paid_gate = threading.RLock(), threading.BoundedSemaphore(2)
        self.data = json.loads(self.output.read_text()) if self.output.exists() else {
            'version': CHECKPOINT_VERSION, 'authorVersion': AUTHOR_VERSION,
            'base': base, 'runId': str(uuid.uuid4()), 'potentialProviderCalls': 0,
            'httpRequests': 0, 'cases': {}, 'errors': [],
            'note': 'Eight bounded samples; independent probes do not prove adversarial balance.',
        }
        if (self.data.get('version') != CHECKPOINT_VERSION
                or self.data.get('authorVersion') != AUTHOR_VERSION
                or self.data.get('base') != base):
            raise legacy.QAError('Checkpoint belongs to a different suite, pipeline, or Site')

    def require_denied(self, path):
        try:
            self.call(path)
        except legacy.ApiError as error:
            assert error.status == 403, str(error)
            return {'status': error.status, 'code': error.code}
        raise AssertionError('Pre-terminal private information was exposed')

    def create_once(self, record, key, payload, paid=False):
        with self.lock:
            receipt = record.setdefault(key, {'request': {**payload, 'requestId': str(uuid.uuid4())}})
            if receipt.get('gameId'):
                return self.call('/games/' + receipt['gameId'])
            if receipt.get('sent'):
                raise legacy.QAError('Creation outcome is uncertain or failed. Inspect the saved exact receipt; this suite will not automatically submit it again or replace it.')
            receipt['sent'] = True
            self.save()
        maximum_calls = 5 if str(payload.get('setup', {}).get('theme', '')).strip() else 4
        game = self.call('/games', receipt['request'], paid=paid, potential_calls=maximum_calls)
        with self.lock:
            receipt['gameId'] = game['id']
            self.save()
        return game

    def case(self, ruleset, sample):
        key = f'{ruleset}-{sample}'
        with self.lock:
            record = self.data['cases'].setdefault(key, {'ruleset': ruleset, 'sample': sample})
            if record.get('passed'):
                print(json.dumps({'case': key, 'passed': True, 'resumed': True}), flush=True)
                return
            setup = record.setdefault('setup', {
                'generation': 'ai', 'ruleset': ruleset, 'lengthPreset': 'quick',
                'difficulty': 'standard', 'days': 3, 'loops': 2,
                'incidentCount': 3 if ruleset == 'MC' else 2,
                'incidentVisibility': 'public', 'characterPool': 'standard',
                'includeAI': ruleset in ['MZ', 'MC'],
                # Theme behavior has a separate two-sample suite. Keep this
                # mechanical matrix on the original two-request happy path.
                'theme': '',
                'seed': 261114200 + RULESETS.index(ruleset) * 10 + sample,
            })
            self.save()
        mastermind = self.create_once(record, 'mastermind', {'mode': 'mastermind', 'budget': .5, 'setup': setup}, paid=True)
        assert mastermind.get('mode') == 'mastermind'
        full = self.call('/games/' + mastermind['id'] + '/replay?full=1')
        assert full['perspective'] == 'M' and full['frames']
        script = full['script']
        with self.lock:
            record['authoredScript'] = script
            self.save()
        if not record.get('localValidation'):
            validated = validate_locally(script, setup)
            with self.lock:
                record['localValidation'] = validated
                self.save()
        validated = record['localValidation']
        # Repeating a confirmed receipt must recover the same saved script and
        # metadata, with no new generation ID or usage entry.
        if not record.get('creationIdempotent'):
            duplicate = self.call('/games', record['mastermind']['request'])
            assert duplicate['id'] == mastermind['id']
            assert duplicate['revision'] == mastermind['revision']
            again = self.call('/games/' + duplicate['id'] + '/replay?full=1')
            assert again['script'] == script
            with self.lock:
                record['creationIdempotent'] = True
                self.save()
        heroes = self.create_once(record, 'heroes', {'mode': 'heroes', 'budget': .5, 'script': script})
        assert heroes.get('mode') == 'heroes'
        legacy.check_public(heroes)
        assert heroes['script'] == validated['publicScript']
        public_replay = self.call('/games/' + heroes['id'] + '/replay')
        assert public_replay['perspective'] == 'public'
        assert public_replay['script'] == validated['publicScript']
        for frame in public_replay['frames']:
            legacy.check_public(frame['view'])
        denials = {
            'fullReplay': self.require_denied('/games/' + heroes['id'] + '/replay?full=1'),
            'review': self.require_denied('/games/' + heroes['id'] + '/review'),
        }
        with self.lock:
            record.update(publicProjectionPassed=True, publicReplayPassed=True,
                          preterminalDenials=denials, passed=True)
            record.pop('error', None)
            self.save()
        print(json.dumps({
            'case': key, 'passed': True, 'calls': validated['usage']['requests'],
            'estimatedCost': validated['usage']['estimatedCost'],
            'candidates': validated['candidateCount'], 'trialStatus': validated['probe']['status'],
            'independentTrialStatus': validated['independentProbe']['status'],
            'independentCommands': validated['independentProbe']['commands'],
        }, ensure_ascii=False), flush=True)

    def run(self):
        info = self.call('/info')
        assert info.get('authorVersion') == AUTHOR_VERSION, 'Deployed author pipeline is not current'
        assert info.get('configured') is True, 'DeepSeek is not configured'
        self.data['info'] = {k: info.get(k) for k in ['version', 'authorVersion', 'model', 'contentHash', 'authorBudget']}
        self.save()
        print(json.dumps({'authorVersion': AUTHOR_VERSION, 'configured': True, 'cases': 8}), flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(self.case, ruleset, sample): f'{ruleset}-{sample}'
                       for ruleset in RULESETS for sample in [1, 2]}
            for future in concurrent.futures.as_completed(futures):
                key = futures[future]
                try:
                    future.result()
                except Exception as error:
                    message = str(error) or type(error).__name__
                    with self.lock:
                        self.data['cases'].setdefault(key, {})['error'] = message
                        self.save()
                    print(json.dumps({'case': key, 'error': message}, ensure_ascii=False), flush=True)
        self.data['errors'] = [{'case': key, 'error': record['error']}
                               for key, record in self.data['cases'].items() if record.get('error')]
        self.data['allPassed'] = all(self.data['cases'].get(f'{r}-{s}', {}).get('passed')
                                     for r in RULESETS for s in [1, 2]) and not self.data['errors']
        self.data['summary'] = {
            'passed': sum(bool(record.get('passed')) for record in self.data['cases'].values()),
            'required': 8,
            'successfulAuthorRequests': sum(record.get('authoredScript', {}).get('generation', {}).get('usage', {}).get('requests', 0) for record in self.data['cases'].values()),
            'successfulAuthorCostEstimate': sum(record.get('authoredScript', {}).get('generation', {}).get('usage', {}).get('estimatedCost', 0) for record in self.data['cases'].values()),
            'note': 'Counts and costs cover successfully returned author metadata; a failed provider request may also have incurred usage.',
        }
        self.save()
        print(json.dumps(self.data['summary']), flush=True)
        print('GENERATION_QA_PASS' if self.data['allPassed'] else 'GENERATION_QA_FAIL', flush=True)
        return 0 if self.data['allPassed'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='Private checkpoint path; contains hidden script truth, never credentials')
    args = parser.parse_args()
    base, token = legacy.read_credentials()
    runner = Runner(args, base, token)
    try:
        return runner.run()
    except Exception as error:
        runner.data['errors'].append({'suite': 'generation', 'error': str(error) or type(error).__name__})
        runner.save()
        print(json.dumps({'error': str(error) or type(error).__name__}, ensure_ascii=False), flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
