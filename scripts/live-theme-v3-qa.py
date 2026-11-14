"""Two bounded, resumable real-provider checks for visible theme authoring.

Run from the repository root:
  python scripts/live-theme-v3-qa.py --output /private/theme-v3-report.json
  python scripts/live-theme-v3-qa.py --output /private/theme-v3-report.json --fixed-title '雪停之后'

The Site origin and QA credential enter as one hidden stdin JSON line, using
the existing QA transport. The credential never enters argv or the report. No paid
creation is retried after an uncertain result. Each draft shares the server's
$0.12 / 180-second author allowance across caption, plan and selection.
Keyword checks are a smoke test: review the saved original title/intro for
coherence, atmosphere and absence of implied rules or private-truth clues.
"""
import argparse
import importlib.util
import json
import pathlib
import sys
import threading
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('live_generation_qa', ROOT / 'scripts/live-generation-qa.py')
generation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generation)
legacy = generation.legacy
legacy.MAX_POTENTIAL_PROVIDER_CALLS = 10  # Two drafts, at most five requests each.
legacy.MAX_HTTP_REQUESTS = 64
CHECKPOINT_VERSION = 'theme-author-qa-1'
AUTHOR_VERSION = 'script-author-3'
THEMES = [
    {'id': 'rain-tram', 'theme': '雨夜的末班电车',
     'keywordGroups': [['雨'], ['电车', '末班', '站台', '车窗']]},
    {'id': 'snow-theatre', 'theme': '初雪中的旧剧院',
     'keywordGroups': [['雪'], ['剧院', '舞台', '幕布', '戏', '观众']]},
]


class Runner(generation.Runner):
    def __init__(self, args, base, token):
        self.args, self.base, self.token = args, base, token
        self.output = pathlib.Path(args.output).resolve()
        self.lock, self.paid_gate = threading.RLock(), threading.BoundedSemaphore(1)
        self.data = json.loads(self.output.read_text()) if self.output.exists() else {
            'version': CHECKPOINT_VERSION, 'authorVersion': AUTHOR_VERSION,
            'base': base, 'fixedTitle': args.fixed_title, 'runId': str(uuid.uuid4()),
            'potentialProviderCalls': 0, 'httpRequests': 0, 'cases': {}, 'errors': [],
            'limits': {'drafts': 2, 'authorBudgetPerDraft': .12,
                       'authorDeadlineMsPerDraft': 180000, 'providerRequests': 10},
            'manualReviewRequired': True,
            'note': 'Keyword matches and bounded engine probes do not prove thematic quality or game balance.',
        }
        if (self.data.get('version') != CHECKPOINT_VERSION
                or self.data.get('authorVersion') != AUTHOR_VERSION
                or self.data.get('base') != base
                or self.data.get('fixedTitle') != args.fixed_title):
            raise legacy.QAError('Checkpoint belongs to a different theme suite, Site, or fixed title')

    def case(self, theme, index):
        key = theme['id']
        record = self.data['cases'].setdefault(key, {})
        if record.get('passed'):
            print(json.dumps({'case': key, 'passed': True, 'resumed': True}), flush=True)
            return
        setup = record.setdefault('setup', {
            'generation': 'ai', 'ruleset': 'FS', 'lengthPreset': 'quick',
            'difficulty': 'standard', 'days': 3, 'loops': 2, 'incidentCount': 2,
            'incidentVisibility': 'public', 'characterPool': 'standard',
            'communication': 'between_loops_only', 'theme': theme['theme'],
            'seed': 261114301 + index,
            **({'title': self.args.fixed_title} if index == 1 and self.args.fixed_title else {}),
        })
        self.save()
        mastermind = self.create_once(record, 'mastermind', {'mode': 'mastermind', 'budget': .5, 'setup': setup}, paid=True)
        assert mastermind.get('mode') == 'mastermind'
        full = self.call('/games/' + mastermind['id'] + '/replay?full=1')
        assert full['perspective'] == 'M' and full['frames']
        script = full['script']
        # Preserve the original result before assertions, including failures,
        # so review or resume never needs another paid generation.
        record['authoredScript'] = script
        record['publicCopy'] = {key: script.get(key) for key in ['title', 'intro']}
        self.save()
        validated = generation.validate_locally(script, setup)
        assert validated['captionAttempts'] == 1
        assert 1 <= validated['planAttempts'] <= 2
        assert 1 <= validated['selectionAttempts'] <= 2
        assert 3 <= validated['usage']['requests'] <= 5
        assert isinstance(script.get('title'), str) and script['title'].strip()
        assert isinstance(script.get('intro'), str) and script['intro'].strip()
        if setup.get('title'):
            assert script['title'] == setup['title'], 'Explicit user title was replaced'
        # A fixed title may be unrelated: the introduction still needs to carry
        # both central motifs from the requested theme.
        visible_copy = script['intro'] if setup.get('title') else script['title'] + '\n' + script['intro']
        hits = [[word for word in group if word in visible_copy] for group in theme['keywordGroups']]
        record.update(localValidation=validated, keywordMatches=hits)
        self.save()
        assert all(hits), 'Requested theme motifs are missing from the visible copy'
        heroes = self.create_once(record, 'heroes', {'mode': 'heroes', 'budget': .5, 'script': script})
        legacy.check_public(heroes)
        assert heroes['script'] == validated['publicScript']
        assert all(heroes['script'][field] == script[field] for field in ['title', 'intro'])
        public_replay = self.call('/games/' + heroes['id'] + '/replay')
        assert public_replay['perspective'] == 'public'
        assert public_replay['script'] == validated['publicScript']
        for frame in public_replay['frames']:
            legacy.check_public(frame['view'])
        denials = {
            'fullReplay': self.require_denied('/games/' + heroes['id'] + '/replay?full=1'),
            'review': self.require_denied('/games/' + heroes['id'] + '/review'),
        }
        record.update(publicProjectionPassed=True, publicReplayPassed=True,
                      preterminalDenials=denials, passed=True)
        record.pop('error', None)
        self.save()
        print(json.dumps({'case': key, 'passed': True, 'publicCopy': record['publicCopy'],
                          'keywordMatches': hits, 'calls': validated['usage']['requests'],
                          'estimatedCost': validated['usage']['estimatedCost']}, ensure_ascii=False), flush=True)

    def run(self):
        info = self.call('/info')
        assert info.get('authorVersion') == AUTHOR_VERSION, 'Deployed author pipeline is not current'
        assert info.get('configured') is True, 'DeepSeek is not configured'
        assert info.get('authorBudget') == .12, 'Unexpected server author budget'
        self.data['info'] = {key: info.get(key) for key in ['version', 'authorVersion', 'model', 'contentHash', 'authorBudget']}
        self.save()
        for index, theme in enumerate(THEMES):
            try:
                self.case(theme, index)
            except Exception as error:
                message = str(error) or type(error).__name__
                self.data['cases'].setdefault(theme['id'], {})['error'] = message
                self.save()
                print(json.dumps({'case': theme['id'], 'error': message}, ensure_ascii=False), flush=True)
        records = [self.data['cases'].get(theme['id'], {}) for theme in THEMES]
        self.data['errors'] = [{'case': theme['id'], 'error': record['error']}
                               for theme, record in zip(THEMES, records) if record.get('error')]
        if all(record.get('passed') for record in records):
            copies = [record['publicCopy'] for record in records]
            if copies[0]['title'] == copies[1]['title'] or copies[0]['intro'] == copies[1]['intro']:
                self.data['errors'].append({'suite': 'theme', 'error': 'Distinct themes produced identical title or intro'})
        self.data['allPassed'] = all(record.get('passed') for record in records) and not self.data['errors']
        usages = [record.get('authoredScript', {}).get('generation', {}).get('usage', {}) for record in records]
        self.data['summary'] = {
            'passed': sum(bool(record.get('passed')) for record in records), 'required': 2,
            'successfulAuthorRequests': sum(usage.get('requests', 0) for usage in usages),
            'successfulAuthorCostEstimate': sum(usage.get('estimatedCost', 0) for usage in usages),
            'manualReviewRequired': True,
            'note': 'Successful metadata only; an unsuccessful provider request may also incur usage.',
        }
        self.save()
        print(json.dumps({'report': str(self.output), 'allPassed': self.data['allPassed'],
                          **self.data['summary']}, ensure_ascii=False), flush=True)
        return 0 if self.data['allPassed'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', required=True, help='Private JSON report; includes hidden script truth, never credentials')
    parser.add_argument('--fixed-title', default='', help='Optional exact title to preserve in the second draft')
    args = parser.parse_args()
    if args.fixed_title and (not args.fixed_title.strip() or len(args.fixed_title) > 120):
        parser.error('--fixed-title must contain 1–120 characters')
    args.fixed_title = args.fixed_title.strip()
    base, token = legacy.read_credentials()
    runner = Runner(args, base, token)
    try:
        return runner.run()
    except Exception as error:
        message = str(error) or type(error).__name__
        runner.data['errors'].append({'suite': 'theme', 'error': message})
        runner.save()
        print(json.dumps({'error': message}, ensure_ascii=False), flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
