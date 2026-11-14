"""Live eval: run the errands in errands.json against the deployed Vali API and write scorecard.md.

Usage:
    backend/.venv/bin/python scripts/evals/run.py --token-file /path/to/tok
    GOLDEN_TOKEN=... backend/.venv/bin/python scripts/evals/run.py [--only find-sauna,book-sauna] [--new-user]

Each errand: create the task, check the routed mode, wait for research and check its pass rules.
Errands with "execute" start the sandbox and wait for awaiting_approval; then the run calls /stop.
It never approves: nothing is submitted, paid or booked. Questions from the sandbox get the errand's
"reply" (or a generic one). Only fake test data is sent. The token is never printed.

--new-user creates a fresh test user first (each user has a daily research spend cap).
"""
import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx

HERE = Path(__file__).parent
DEFAULT_API = 'https://bogdan-c-2206--vali-web.us-east.modal.run'
RESEARCH_TIMEOUT = 300
EXEC_TIMEOUT = 480
POLL = 10  # the API allows 300 requests per 10 minutes per IP
PARALLEL = 4
TERMINAL = {'completed', 'failed', 'cancelled'}
EXEC_END = {'done', 'failed', 'stopped'}
DEFAULT_REPLY = 'Choose the first available option that fits the errand.'
# Fake test profile only.
TEST_PROFILE = {'name': 'Aino Virtanen', 'first_name': 'Aino', 'last_name': 'Virtanen', 'email': 'test@example.com',
                'phone': '+358401234567', 'address': 'Testikatu 1 A 2', 'postal_code': '00100', 'city': 'Helsinki',
                'country': 'Finland'}


class Fail(Exception):
    pass


def citations(output):
    return [c['url'] for g in (output or {}).get('grounding') or [] for c in g.get('citations') or [] if c.get('url')]


def host_matches(url, domains):
    host = (urlsplit(url or '').hostname or '').lower()
    return any(host == d or host.endswith('.' + d) for d in domains)


def check_research(rules, research):
    """Return the first failed pass rule as text, or None when every rule holds."""
    output = research.get('output') or {}
    structured = output.get('structured') or {}
    answer = (structured.get('answer') or output.get('text') or '').strip()
    actions = structured.get('actions') or []
    cited = citations(output)
    urls = cited + [a['url'] for a in actions if a.get('url')]
    if rules.get('watch'):
        return None if research.get('watch_id') else 'no watch created'
    if len(cited) < rules.get('citations', 0):
        return f'{len(cited)} citations, want {rules["citations"]}'
    if len(answer) < rules.get('answer_min', 1):
        return f'answer too short ({len(answer)} chars)'
    if rules.get('answer_any') and not any(w.lower() in answer.lower() for w in rules['answer_any']):
        return f'answer lacks any of {rules["answer_any"]}: {answer[:120]!r}'
    if len(actions) < rules.get('options', 0):
        return f'{len(actions)} options, want {rules["options"]}'
    with_url = [a for a in actions if (a.get('url') or '').startswith('http')]
    want_urls = max(rules.get('option_urls', 0), rules.get('action_urls', 0))
    if len(with_url) < want_urls:
        return f'{len(with_url)} actions with a link, want {want_urls}'
    if rules.get('domains_any') and not any(host_matches(u, rules['domains_any']) for u in urls):
        return f'no source on {rules["domains_any"]}'
    emails = [a for a in actions if a.get('type') == 'email' and (a.get('body') or '').strip()]
    if len(emails) < rules.get('email', 0):
        return 'no email draft with a body'
    return None


def exa_calls(task):
    """Count Exa calls by kind: research (search / agent and its searches) and in-sandbox lookups."""
    research = task.get('research') or {}
    kinds = {}
    if research.get('kind') == 'search':
        kinds['search'] = 1
    elif research.get('kind') == 'agent':
        kinds['agent'] = 1
        searches = sum(1 for p in research.get('progress') or [] if p.get('kind') == 'search')
        if searches:
            kinds['agent_searches'] = searches
    elif research.get('kind') == 'monitor':
        kinds['monitor'] = 0 if research.get('monitor_stubbed') else 1
    for step in (task.get('execution') or {}).get('steps') or []:
        text = step.get('text') or ''
        if text.startswith('Searched the web with Exa'):
            kinds['sandbox_search'] = kinds.get('sandbox_search', 0) + 1
        elif text.startswith('Read with Exa'):
            kinds['sandbox_read'] = kinds.get('sandbox_read', 0) + 1
    return kinds


def start_target(errand, task):
    """Pick the sandbox start: the errand's URL, else the first researched action with a link."""
    spec = errand['execute']
    if spec.get('start_url'):
        return {'start_url': spec['start_url']}
    actions = ((task['research'].get('output') or {}).get('structured') or {}).get('actions') or []
    for kind in ('open_link', None):
        for i, action in enumerate(actions):
            if (action.get('url') or '').startswith('http') and kind in (None, action.get('type')):
                return {'action_index': i}
    raise Fail('research gave no link to start the sandbox from')


def is_handoff(execution):
    text = ' '.join(str(execution.get(k) or '') for k in ('result', 'error')).lower()
    return execution.get('status') == 'failed' and 'finish by hand' in text and any(
        w in text for w in ('login', 'captcha', 'payment'))


class Run:
    def __init__(self, errand):
        self.errand, self.started = errand, time.monotonic()
        self.ok, self.reason, self.task, self.mode, self.cost = False, '', None, '-', 0.0
        self.outcome = ''

    def row(self):
        task = self.task or {}
        kinds = exa_calls(task) if task else {}
        return dict(id=self.errand['id'], site=self.errand.get('site', ''), ok=self.ok, mode=self.mode,
                    expected='/'.join(self.errand['mode']), seconds=round(time.monotonic() - self.started),
                    cost=round(self.cost, 3), exa=kinds, exa_total=sum(kinds.values()), reason=self.reason,
                    outcome=self.outcome, task_id=task.get('id', '-'), detail=detail(task))


def detail(task):
    """What the research and sandbox produced, for reading failures (written with --json only)."""
    output = (task.get('research') or {}).get('output') or {}
    structured = output.get('structured') or {}
    execution = task.get('execution') or {}
    return dict(answer=(structured.get('answer') or output.get('text') or '')[:600],
                actions=[{k: a.get(k) for k in ('type', 'label', 'url', 'to')} for a in structured.get('actions') or []],
                citations=citations(output)[:8], start_url=execution.get('start_url'),
                final_url=execution.get('current_url'), steps=[s.get('text') for s in execution.get('steps') or []],
                approval=execution.get('approval'), usage=execution.get('usage'))


async def call(client, method, path, **kwargs):
    for wait in (15, 30, 60, 60, 0):
        response = await client.request(method, path, **kwargs)
        if response.status_code != 429 or not wait:
            break
        await asyncio.sleep(wait)  # rate limited: back off instead of failing the errand
    if response.status_code >= 400:
        raise Fail(f'{method} {path.split("?")[0]} -> HTTP {response.status_code}: {response.text[:160]}')
    return response.json()


async def get_task(client, tid):
    return await call(client, 'GET', f'/v1/tasks/{tid}')


async def wait_research(client, run):
    deadline = time.monotonic() + RESEARCH_TIMEOUT
    while run.task['research']['status'] not in TERMINAL:
        if time.monotonic() > deadline:
            raise Fail(f'research timed out after {RESEARCH_TIMEOUT} s')
        await asyncio.sleep(POLL)
        run.task = await get_task(client, run.task['id'])
    research = run.task['research']
    run.cost += float(research.get('cost') or 0)
    if research['status'] != 'completed':
        raise Fail(f'research {research["status"]}: {research.get("error") or research.get("stop_reason")}')


async def drive_execution(client, run):
    """Start the sandbox, answer its questions, stop at the approval gate. Returns the outcome."""
    spec, tid = run.errand['execute'], run.task['id']
    body = {'goal': spec.get('goal'), 'profile': TEST_PROFILE, **start_target(run.errand, run.task)}
    run.task = await call(client, 'POST', f'/v1/tasks/{tid}/execute', json=body)
    deadline, answered = time.monotonic() + EXEC_TIMEOUT, set()
    try:
        while True:
            execution = run.task.get('execution') or {}
            status = execution.get('status')
            question = (execution.get('question') or {}).get('text')
            if question and question not in answered:
                answered.add(question)
                await call(client, 'POST', f'/v1/tasks/{tid}/messages', json={'text': spec.get('reply') or DEFAULT_REPLY})
            if status == 'awaiting_approval':
                filled = len((execution.get('approval') or {}).get('filled') or [])
                return f'approval with {filled} values'
            if status in EXEC_END:
                return 'handoff' if is_handoff(execution) else status
            if time.monotonic() > deadline:
                return 'timeout'
            await asyncio.sleep(POLL)
            run.task = await get_task(client, tid)
    finally:
        # Never leave a browser waiting: stop at the gate, on errors and on timeout.
        try:
            if (run.task.get('execution') or {}).get('status') not in EXEC_END:
                await call(client, 'POST', f'/v1/tasks/{tid}/stop')
            run.task = await get_task(client, tid)
        except Exception:
            pass
        usage = (run.task.get('execution') or {}).get('usage') or {}
        run.cost += float(usage.get('claude_cost_usd') or 0) + float(usage.get('exa_cost_usd') or 0)


async def run_errand(api, token, errand, gate):
    run = Run(errand)
    async with gate, httpx.AsyncClient(base_url=api, headers={'Authorization': f'Bearer {token}'}, timeout=120) as client:
        run.started = time.monotonic()
        try:
            body = {'task': errand['text'], **({'page': errand['page']} if errand.get('page') else {})}
            run.task = await call(client, 'POST', '/v1/tasks', json=body)
            run.mode = run.task.get('mode', '-')
            await wait_research(client, run)
            failed = check_research(errand.get('pass') or {}, run.task['research'])
            if failed:
                raise Fail(failed)
            if errand.get('execute'):
                run.outcome = await drive_execution(client, run)
                kind = 'approval' if run.outcome.startswith('approval') else run.outcome
                if kind not in errand['execute'].get('accept', ['approval']):
                    execution = run.task.get('execution') or {}
                    raise Fail(f'sandbox {run.outcome} after {len(execution.get("steps") or [])} steps: '
                               f'{execution.get("error") or execution.get("result") or "no reason"}')
            if run.mode not in errand['mode']:
                raise Fail(f'routed to {run.mode}, want {"/".join(errand["mode"])}')
            run.ok, run.reason = True, run.outcome or 'research ok'
        except Fail as exc:
            run.reason = str(exc)
        except Exception as exc:
            run.reason = f'{type(exc).__name__}: {exc}'
    run.reason = run.reason.replace(token, '***').replace('\n', ' ')[:300]
    row = run.row()
    print(f'{"PASS" if row["ok"] else "FAIL"}  {row["id"]:<20} mode={row["mode"]:<6} {row["seconds"]:4d}s '
          f'${row["cost"]:.3f}  exa={row["exa_total"]}  {row["task_id"]}  {row["reason"]}', flush=True)
    return row


def scorecard(rows, api):
    passed, cost = sum(r['ok'] for r in rows), sum(r['cost'] for r in rows)
    lines = [f'# Vali eval scorecard', '',
             f'{datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")} · {api} · '
             f'**{passed}/{len(rows)} passed** · ${cost:.2f} total · errands in `errands.json`', '',
             '| # | Errand | Site | Pass | Mode (want) | s | Cost | Exa calls | Result / failure | Task |',
             '|---|---|---|---|---|---|---|---|---|---|']
    for i, r in enumerate(rows, 1):
        exa = ', '.join(f'{k} {v}' for k, v in r['exa'].items()) or '-'
        reason = r['reason'].replace('|', '/')
        lines.append(f'| {i} | {r["id"]} | {r["site"]} | {"PASS" if r["ok"] else "FAIL"} | {r["mode"]} ({r["expected"]}) '
                     f'| {r["seconds"]} | ${r["cost"]:.3f} | {exa} | {reason} | `{r["task_id"]}` |')
    return '\n'.join(lines) + '\n'


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--api', default=DEFAULT_API)
    parser.add_argument('--token-file')
    parser.add_argument('--new-user', action='store_true', help='create a fresh test user for this run')
    parser.add_argument('--only', help='comma-separated errand ids')
    parser.add_argument('--out', default=str(HERE / 'scorecard.md'))
    parser.add_argument('--json', help='also write the raw rows to this file')
    parser.add_argument('--save-token', help='with --new-user: write the new token here (to look at its tasks later)')
    args = parser.parse_args()
    api = args.api.rstrip('/')
    errands = json.loads((HERE / 'errands.json').read_text())['errands']
    if args.only:
        wanted = {x.strip() for x in args.only.split(',')}
        errands = [e for e in errands if e['id'] in wanted]
    token = os.environ.get('GOLDEN_TOKEN', '').strip()
    if not token and args.token_file:
        token = Path(args.token_file).read_text().strip()
    if args.new_user:
        async with httpx.AsyncClient(base_url=api, timeout=120) as client:
            token = (await call(client, 'POST', '/v1/users'))['token']
        if args.save_token:
            Path(args.save_token).write_text(token)
    if not token:
        parser.error('set GOLDEN_TOKEN, pass --token-file or --new-user')
    gate = asyncio.Semaphore(PARALLEL)
    rows = await asyncio.gather(*(run_errand(api, token, e, gate) for e in errands))
    Path(args.out).write_text(scorecard(rows, api))
    if args.json:
        Path(args.json).write_text(json.dumps(rows, indent=2))
    print(f'{sum(r["ok"] for r in rows)}/{len(rows)} passed, ${sum(r["cost"] for r in rows):.2f}; wrote {args.out}')
    return 0 if all(r['ok'] for r in rows) else 1


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
