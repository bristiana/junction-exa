"""Vali harness: run phrase suites against the live API and score every answer.

Usage:
    backend/.venv/bin/python scripts/harness/run.py --suite video
    backend/.venv/bin/python scripts/harness/run.py --suite all --grade --min 0.8
    backend/.venv/bin/python scripts/harness/run.py --suite judges --only kela --token-file /path/to/tok

Suites are JSON in scripts/harness/suites/: {"persona": "...", "cases": [{phrase, expected_modes?,
must_mention?, max_seconds?, lenient?}]}. "lenient" cases (one-word, refusals, nonsense) only need a
completed, non-empty answer. Without --token-file a fresh account is created (per-account daily spend cap).
Writes out/<timestamp>.json and latest.md, and diffs against the previous run. Exit 1 if pass rate < --min.
Keys are read from junction-exa/.env for --grade and are never printed.
"""
import argparse
import asyncio
import json
import re
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

HERE = Path(__file__).parent
OUT = HERE / 'out'
DEFAULT_API = 'https://bogdan-c-2206--vali-web.us-east.modal.run'
ENV_FILE = Path('/Users/bogdan/Developer/Hackathon/Junction2026/junction-exa/.env')
GRADE_MODEL = 'claude-haiku-5-5'
TERMINAL = {'completed', 'failed', 'cancelled'}
POLL = 2  # GET polls are not rate-limited (B7), so latency is measured to within 2 s
MAX_SECONDS = 180
REFUSAL = re.compile(r"\b(i can'?t help|i cannot help|i'm unable to|i am unable to|can'?t assist|cannot assist|sorry, but i)\b", re.I)
OFFICIAL_HOST = re.compile(r'(\.fi|\.gov|\.eu|\.gov\.\w+)$')
OFFICIAL_NOT_NEEDED = {'find', 'book', 'watch'}  # places and companies have no official source to cite
CRITERIA = ('useful', 'specific', 'next_step')


async def request(client, method, path, **kwargs):
    last = 'unreachable'
    for attempt in range(10):
        try:
            response = await client.request(method, path, **kwargs)
        except httpx.TransportError:  # a dropped connection or DNS blip: retry
            await asyncio.sleep(5)
            continue
        if response.status_code != 429:
            response.raise_for_status()
            return response.json()
        last = response.text[:100]
        await asyncio.sleep(20)
    raise RuntimeError('rate limited: ' + last)


async def run_task(client, phrase, limit):
    started = time.monotonic()
    task = await request(client, 'POST', '/v1/tasks', json={'task': phrase})
    while task['research']['status'] not in TERMINAL and time.monotonic() - started < limit:
        await asyncio.sleep(POLL)
        task = await request(client, 'GET', f'/v1/tasks/{task["id"]}')
    return task, time.monotonic() - started


def sources_of(output):
    """Numbered sources when the API sends them, else the unique cited URLs from grounding."""
    if output.get('sources'):
        return output['sources']
    urls = {c['url']: c for g in output.get('grounding') or [] for c in g.get('citations') or [] if c.get('url')}
    return [{'url': u, 'title': c.get('title'), 'domain': re.sub(r'^https?://(www\.)?([^/]+).*', r'\2', u)}
            for u, c in urls.items()]


def is_official(source):
    return bool(source.get('official')) or bool(OFFICIAL_HOST.search(source.get('domain') or ''))


def answer_text(output):
    structured = output.get('structured') or {}
    return (structured.get('answer') or output.get('text') or '').strip()


def measure(task, seconds):
    research = task['research']
    output = research.get('output') or {}
    structured = output.get('structured') or {}
    sources = sources_of(output)
    claims = [c for c in output.get('claims') or [] if not c.get('own')]  # Vali's own lines are not claims
    return {
        'status': research['status'], 'seconds': round(seconds), 'cost': research.get('cost'),
        'mode': task.get('mode'), 'answer': answer_text(output), 'error': research.get('error'),
        'sources': len(sources), 'source_list': [{'url': s['url'], 'title': s.get('title')} for s in sources][:8],
        'cited_share': round(sum(bool(c.get('sources')) for c in claims) / len(claims), 2) if claims else None,
        'official': any(is_official(s) for s in sources),
        'quotes': any(s.get('quote') for s in sources) if output.get('sources') else None,
        'missing_info': structured.get('missing_info') or [],
        'steps': len(structured.get('steps') or []), 'facts': len(structured.get('key_facts') or []),
    }


def failures(case, m):
    """Reasons this answer fails; empty means pass."""
    if m['status'] != 'completed':
        return [f"status {m['status']}" + (f": {m['error']}" if m['error'] else '')]
    if not m['answer']:
        return ['empty answer']
    if case.get('lenient'):
        return []
    text = (m['answer'] + ' ' + json.dumps(m['source_list'])).lower()
    found = []
    if REFUSAL.search(m['answer'][:300]):
        found.append('refusal')
    if m['seconds'] > case.get('max_seconds', MAX_SECONDS):
        found.append(f"slow {m['seconds']}s")
    if case.get('expected_modes') and m['mode'] not in case['expected_modes']:
        found.append(f"mode {m['mode']}")
    found += [f'missing "{k}"' for k in case.get('must_mention', []) if k.lower() not in text]
    if m['mode'] == 'watch':
        return found
    if not m['sources']:
        found.append('no sources')
    elif not m['official'] and m['mode'] not in OFFICIAL_NOT_NEEDED:
        found.append('no official source')
    if m['cited_share'] is not None and m['cited_share'] < 0.5:
        found.append(f"only {m['cited_share']:.0%} claims cited")
    if len(m['missing_info']) > 3:
        found.append(f"{len(m['missing_info'])} missing_info questions")
    return found


def load_anthropic_key():
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith('ANTHROPIC_API_KEY='):
            return line.split('=', 1)[1].strip().strip('"\'')
    raise SystemExit('ANTHROPIC_API_KEY not found in ' + str(ENV_FILE))


async def grade(llm, persona, case, m):
    prompt = (f'A user, {persona}, typed this into an assistant: "{case["phrase"]}"\n\nAnswer given:\n{m["answer"][:3000]}\n\n'
              f'Sources: {json.dumps(m["source_list"][:5])}\n\nScore 1-5 (5 best): useful = directly useful to this person; '
              'specific = specific and current, not generic; next_step = gives a clear next step. '
              'Reply with only JSON: {"useful":n,"specific":n,"next_step":n,"reason":"one line"}')
    reply = await llm.messages.create(model=GRADE_MODEL, max_tokens=2000, messages=[{'role': 'user', 'content': prompt}])
    return json.loads(re.search(r'\{.*\}', ''.join(b.text for b in reply.content if b.type == 'text'), re.S).group(0))


async def run_case(client, llm, sem, persona, case):
    async with sem:
        try:
            task, seconds = await run_task(client, case['phrase'], case.get('max_seconds', MAX_SECONDS) + 60)
            m = measure(task, seconds)
        except Exception as exc:  # one bad case must not stop the run
            m = {'status': 'error', 'seconds': 0, 'cost': None, 'mode': None, 'answer': '', 'error': str(exc)[:150],
                 'sources': 0, 'source_list': [], 'cited_share': None, 'official': False, 'quotes': None,
                 'missing_info': [], 'steps': 0, 'facts': 0}
        if llm and m['answer']:
            try:
                m['grade'] = await grade(llm, persona, case, m)
            except Exception as exc:
                m['grade_error'] = str(exc)[:100]
        m['phrase'], m['fails'] = case['phrase'], failures(case, m)
        m['pass'] = not m['fails']
        print(f"{'PASS' if m['pass'] else 'FAIL'} {m['mode'] or '-':6} {m['seconds']:>4}s src={m['sources']:<2} {case['phrase'][:60]}"
              + ('' if m['pass'] else f"  <- {'; '.join(m['fails'])}"), flush=True)
        return m


def load_cases(suite, only):
    names = [p.stem for p in sorted((HERE / 'suites').glob('*.json'))] if suite == 'all' else [suite]
    cases = []
    for name in names:
        data = json.loads((HERE / 'suites' / f'{name}.json').read_text())
        cases += [{**c, 'suite': name, 'persona': data['persona']} for c in data['cases']]
    return [c for c in cases if not only or only.lower() in c['phrase'].lower()]


def grade_total(m):
    g = m.get('grade')
    return sum(g[k] for k in CRITERIA) if g else None


def diff_against(previous, rows):
    """Cases whose pass state or grade moved since the previous run."""
    old = {r['phrase']: r for r in previous}
    better, worse = [], []
    for r in rows:
        p = old.get(r['phrase'])
        if not p:
            continue
        delta = (r['pass'] - p['pass']) or ((grade_total(r) or 0) - (grade_total(p) or 0)) // 2
        (better if delta > 0 else worse if delta < 0 else []).append(r['phrase'])
    return better, worse


def percentile(values, q):
    values = sorted(values)
    return values[min(len(values) - 1, int(q * len(values)))] if values else 0


def scorecard(rows, stamp, args, diff):
    done = [r for r in rows if r['status'] == 'completed']
    cited = [r['cited_share'] for r in done if r['cited_share'] is not None]
    grades = [grade_total(r) for r in rows if grade_total(r)]
    secs = [r['seconds'] for r in done]
    lines = [f'# Vali harness scorecard', '', f'Run {stamp}, suite `{args.suite}`, {len(rows)} cases, api {args.api}', '',
             f'- Pass rate: {sum(r["pass"] for r in rows)}/{len(rows)} ({sum(r["pass"] for r in rows) / len(rows):.0%})',
             f'- Completed: {len(done)}/{len(rows)}',
             f'- Seconds: median {statistics.median(secs) if secs else 0:.0f}, p90 {percentile(secs, 0.9)}',
             f'- With sources: {sum(r["sources"] > 0 for r in done)}/{len(done)}; official source: {sum(r["official"] for r in done)}/{len(done)}',
             f'- Claim citation share (mean, when the API reports claims): {f"{statistics.mean(cited):.0%}" if cited else "n/a"}',
             f'- Quotes present: {sum(bool(r["quotes"]) for r in done)}/{len(done)}',
             f'- Cost: total ${sum(r["cost"] or 0 for r in rows):.2f}, mean ${sum(r["cost"] or 0 for r in rows) / len(rows):.3f}',
             f'- LLM grade (useful+specific+next step, max 15): {f"mean {statistics.mean(grades):.1f} over {len(grades)}" if grades else "not run"}']
    better, worse = diff
    if better is not None:
        lines += ['', f'## Against previous run', f'- Better ({len(better)}): ' + '; '.join(better[:10]),
                  f'- Worse ({len(worse)}): ' + '; '.join(worse[:10])]
    lines += ['', '## Worst 10', '', '| Phrase | Mode | s | Src | Why |', '|---|---|---|---|---|']
    for r in sorted(rows, key=lambda r: (r['pass'], grade_total(r) or 99))[:10]:
        why = '; '.join(r['fails']) or (r.get('grade') or {}).get('reason', '')
        lines.append(f"| {r['phrase'][:60].replace('|', '/')} | {r['mode'] or '-'} | {r['seconds']} | {r['sources']} | {why.replace('|', '/')[:140]} |")
    return '\n'.join(lines) + '\n'


async def make_token(client, token_file):
    if token_file:
        return Path(token_file).read_text().strip()
    return (await request(client, 'POST', '/v1/users'))['token']


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--suite', default='video', help='suite name or all')
    parser.add_argument('--only', help='substring of the phrase')
    parser.add_argument('--api', default=DEFAULT_API)
    parser.add_argument('--token-file')
    parser.add_argument('--concurrency', type=int, default=4)
    parser.add_argument('--grade', action='store_true', help='LLM grade each answer 1-5')
    parser.add_argument('--min', type=float, default=0.0, help='exit 1 if the pass rate is below this (0-1)')
    args = parser.parse_args()
    cases = load_cases(args.suite, args.only)
    if not cases:
        raise SystemExit('no cases match')
    llm = None
    if args.grade:
        import anthropic
        llm = anthropic.AsyncAnthropic(api_key=load_anthropic_key())
    sem = asyncio.Semaphore(args.concurrency)
    async with httpx.AsyncClient(base_url=args.api.rstrip('/'), timeout=60) as client:
        client.headers['Authorization'] = 'Bearer ' + await make_token(client, args.token_file)
        rows = await asyncio.gather(*[run_case(client, llm, sem, c['persona'], c) for c in cases])
    for row, case in zip(rows, cases):
        row['suite'] = case['suite']
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    previous = sorted(OUT.glob('2*.json'))
    diff = diff_against(json.loads(previous[-1].read_text())['rows'], rows) if previous else (None, None)
    OUT.mkdir(exist_ok=True)
    (OUT / f'{stamp}.json').write_text(json.dumps({'stamp': stamp, 'suite': args.suite, 'rows': rows}, indent=1, ensure_ascii=False))
    card = scorecard(rows, stamp, args, diff)
    (HERE / 'latest.md').write_text(card)
    print('\n' + card)
    rate = sum(r['pass'] for r in rows) / len(rows)
    raise SystemExit(1 if rate < args.min else 0)


if __name__ == '__main__':
    asyncio.run(main())
