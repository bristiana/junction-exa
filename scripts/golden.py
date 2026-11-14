"""Golden errands: three live runs against the deployed Vali API.

Usage:
    backend/.venv/bin/python scripts/golden.py --token-file /path/to/tok
    GOLDEN_TOKEN=... backend/.venv/bin/python scripts/golden.py [--api URL] [--only find,claim,execute]

Errands (run in parallel, 4 minutes each):
    find     "Find a sauna in Helsinki open tonight for 6 people" ends completed with cited results.
    claim    "My Finnair flight HEL-BCN was 4 hours late, what can I get?" routes to claim and ends with research content.
    execute  a task targeting the httpbin.org test order form (an echo service): research, /execute, wait for
             awaiting_approval (live.jpg must return a JPEG meanwhile), approve, wait for done.
             Approval is only ever sent when the start and current URL are on httpbin.org.

Prints one line per errand (PASS/FAIL, mode, seconds, cost, reason). Exit code 1 if any errand fails.
The token is read from GOLDEN_TOKEN or --token-file and is never printed.
"""
import argparse
import asyncio
import os
import sys
import time
from urllib.parse import urlsplit

import httpx

DEFAULT_API = 'https://bogdan-c-2206--hoida-web.us-east.modal.run'
TIMEOUT = 240
POLL = 3
TERMINAL = {'completed', 'failed', 'cancelled'}
EXEC_END = {'done', 'failed', 'stopped'}
SAFE_HOST = 'httpbin.org'
FORM_URL = 'https://httpbin.org/forms/post'
# Test data only: httpbin echoes the order back and keeps nothing.
TEST_PROFILE = {'name': 'Aino Virtanen', 'first_name': 'Aino', 'last_name': 'Virtanen',
                'email': 'test@example.com', 'phone': '+358401234567'}
EXEC_TASK = ('Order a medium pizza with bacon and cheese, delivery at 19:00, on the httpbin test order form '
             f'at {FORM_URL}. Use my name, phone and email, and write "ring the bell" as delivery instructions.')
EXEC_GOAL = ('Fill the httpbin test order form: customer name {{name}}, telephone {{phone}}, email {{email}}, '
             'size Medium, toppings Bacon and Extra Cheese, preferred delivery time 19:00, delivery instructions '
             '"ring the bell". Then ask for approval and submit the order once.')


class Fail(Exception):
    pass


class Errand:
    def __init__(self, name):
        self.name, self.mode, self.cost, self.task_id = name, '-', None, None
        self.started = time.monotonic()

    def add_cost(self, value):
        if isinstance(value, (int, float)):
            self.cost = (self.cost or 0) + value


async def call(client, method, path, **kwargs):
    response = await client.request(method, path, **kwargs)
    if response.status_code >= 400:
        detail = response.text[:200].replace('\n', ' ')
        raise Fail(f'{method} {path.split("?")[0]} -> HTTP {response.status_code}: {detail}')
    return response


async def create(client, errand, text, **extra):
    task = (await call(client, 'POST', '/v1/tasks', json={'task': text, **extra})).json()
    errand.task_id, errand.mode = task['id'], task.get('mode', '-')
    return task


async def wait_research(client, errand, task):
    while task['research']['status'] not in TERMINAL:
        await asyncio.sleep(POLL)
        task = (await call(client, 'GET', f'/v1/tasks/{task["id"]}')).json()
    research = task['research']
    errand.add_cost(research.get('cost'))
    if research['status'] != 'completed':
        raise Fail(f'research {research["status"]}: {research.get("error") or research.get("stop_reason") or "no error"}')
    return task


def citations(output):
    return [c for g in (output or {}).get('grounding') or [] for c in g.get('citations') or [] if c.get('url')]


async def find(client, errand):
    task = await create(client, errand, 'Find a sauna in Helsinki open tonight for 6 people')
    if errand.mode != 'find':
        raise Fail(f'routed to {errand.mode}, expected find')
    output = (await wait_research(client, errand, task))['research'].get('output') or {}
    cited = citations(output)
    if not cited:
        raise Fail('completed without citations')
    options = len((output.get('structured') or {}).get('actions') or [])
    return f'{options} options, {len(cited)} citations'


async def claim(client, errand):
    task = await create(client, errand, 'My Finnair flight HEL-BCN was 4 hours late, what can I get?')
    if errand.mode != 'claim':
        raise Fail(f'routed to {errand.mode}, expected claim')
    output = (await wait_research(client, errand, task))['research'].get('output') or {}
    answer = ((output.get('structured') or {}).get('answer') or output.get('text') or '').strip()
    if not answer:
        raise Fail('completed without an answer')
    return f'answer {len(answer)} chars, {len(citations(output))} citations'


def on_safe_host(url):
    return (urlsplit(url or '').hostname or '').lower() == SAFE_HOST


async def live_frame(client, tid, token):
    try:
        response = await client.get(f'/v1/tasks/{tid}/live.jpg', params={'t': token})
    except httpx.HTTPError:
        return False
    return (response.status_code == 200 and response.headers.get('content-type', '').startswith('image/')
            and response.content[:3] == b'\xff\xd8\xff')


async def execute(client, errand, token):
    task = await create(client, errand, EXEC_TASK, page={'url': FORM_URL, 'title': 'httpbin test order form'})
    task = await wait_research(client, errand, task)
    tid = task['id']
    task = (await call(client, 'POST', f'/v1/tasks/{tid}/execute',
                       json={'start_url': FORM_URL, 'goal': EXEC_GOAL, 'profile': TEST_PROFILE})).json()
    if not on_safe_host((task.get('execution') or {}).get('start_url')):
        raise Fail('execution start_url is not httpbin.org')
    frames = approved = 0
    try:
        while True:
            execution = task.get('execution') or {}
            status = execution.get('status')
            if status in {'running', 'awaiting_approval', 'submitting'} and await live_frame(client, tid, token):
                frames += 1
            if status == 'awaiting_approval' and not approved:
                if not frames:
                    raise Fail('awaiting_approval but live.jpg never returned an image')
                if not (on_safe_host(execution.get('start_url')) and on_safe_host(execution.get('current_url'))):
                    raise Fail(f'approval requested off httpbin.org: {execution.get("current_url")}')
                task = (await call(client, 'POST', f'/v1/tasks/{tid}/approve')).json()
                approved = 1
                continue
            if status in EXEC_END:
                break
            await asyncio.sleep(POLL)
            task = (await call(client, 'GET', f'/v1/tasks/{tid}')).json()
    except BaseException:
        # Never leave a browser waiting for approval behind a failed or timed-out run.
        try:
            await client.post(f'/v1/tasks/{tid}/stop')
        except Exception:
            pass
        raise
    usage = execution.get('usage') or {}
    errand.add_cost(usage.get('claude_cost_usd'))
    errand.add_cost(usage.get('exa_cost_usd'))
    steps = len(execution.get('steps') or [])
    if status != 'done':
        raise Fail(f'execution {status} after {steps} steps: {execution.get("error") or execution.get("result") or "no error"}')
    if not approved:
        raise Fail('done without passing the approval gate')
    return f'done after approval, {steps} steps, {frames} live frames'


async def run(name, fn, api, token):
    errand = Errand(name)
    headers = {'Authorization': f'Bearer {token}'}
    async with httpx.AsyncClient(base_url=api, headers=headers, timeout=60) as client:
        try:
            args = (client, errand, token) if fn is execute else (client, errand)
            reason, ok = await asyncio.wait_for(fn(*args), TIMEOUT), True
        except asyncio.TimeoutError:
            reason, ok = f'timed out after {TIMEOUT} s', False
        except Fail as exc:
            reason, ok = str(exc), False
        except Exception as exc:
            reason, ok = f'{type(exc).__name__}: {exc}', False
    reason = reason.replace(token, '***')
    seconds = time.monotonic() - errand.started
    cost = f'${errand.cost:.3f}' if errand.cost is not None else '-'
    print(f'{"PASS" if ok else "FAIL"}  {name:<8} mode={errand.mode:<6} {seconds:6.1f}s  cost={cost:<7} '
          f'{errand.task_id or "-"}  {reason}', flush=True)
    return ok


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--api', default=DEFAULT_API)
    parser.add_argument('--token-file')
    parser.add_argument('--only', default='find,claim,execute', help='comma-separated errands to run')
    args = parser.parse_args()
    token = os.environ.get('GOLDEN_TOKEN', '').strip()
    if not token and args.token_file:
        with open(args.token_file) as f:
            token = f.read().strip()
    if not token:
        parser.error('set GOLDEN_TOKEN or pass --token-file')
    errands = {'find': find, 'claim': claim, 'execute': execute}
    names = [n.strip() for n in args.only.split(',') if n.strip()]
    unknown = [n for n in names if n not in errands]
    if unknown:
        parser.error(f'unknown errands: {", ".join(unknown)}')
    results = await asyncio.gather(*(run(n, errands[n], args.api.rstrip('/'), token) for n in names))
    print(f'{sum(results)}/{len(results)} passed', flush=True)
    return 0 if all(results) else 1


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
