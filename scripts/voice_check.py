"""Voice check: prove the ElevenLabs call track end to end without a microphone.

Usage:
    backend/.venv/bin/python scripts/voice_check.py --token-file /path/to/tok [--api URL] [--direct-only] [--turns 8]

Keys come from the environment or the repo .env (ELEVENLABS_API_KEY, VALI_ELEVENLABS_AGENT_ID, VALI_VOICE_TOOL_SECRET);
the bearer token from VALI_TOKEN or --token-file. None of them are printed.

1. session     POST /v1/voice/session as the Mac app does, keep dynamic_variables.secret__vali_session.
2. simulate    An ElevenLabs simulation test (POST /v1/convai/agent-testing/create, then /agents/{agent}/run-tests,
               polled at /test-invocations/{id}, then deleted) with a simulated user who asks for a public sauna
               in Helsinki open on Saturday evening, then for the status. approve is mocked; other tools run for real. Passes when the real webhooks ran
               (create_errand and errand_status or list_errands returned non-error results), a new voice errand exists,
               and the agent never spoke an errand id.
3. direct      Calls each tool webhook the way ElevenLabs does (X-Vali-Tool-Secret, X-Vali-Session, JSON body):
               create_errand (only when the simulation did not create one), list_errands, errand_status,
               approval_summary (errand with nothing to approve) and stop. Checks each reply is short and speakable.
Never calls approve. Prints PASS/FAIL per step, the transcript and the errand id. Exit code 1 on any FAIL.
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_API = 'https://bogdan-c-2206--vali-web.us-east.modal.run'
ELEVEN = 'https://api.elevenlabs.io/v1/convai'
ERRAND = 'Find me a public sauna in Helsinki open on Saturday evening.'
USER_PROMPT = f"""You are testing a voice assistant called Vali. Speak in short sentences, like a real caller.
1. Your first request is exactly: "{ERRAND}"
2. After Vali's first reply, whatever it says, ask: "What's the status of my sauna errand?"
3. If it is still researching, ask for the status once more.
4. After Vali has told you the status, say "Thanks, that's all. Goodbye." and end.
Never give any personal details. Never approve, submit or confirm anything."""
ID_RE = re.compile(r'\bt_[0-9a-f]{6,}\b')
PII_RES = {'email': re.compile(r'[\w.+-]+@[\w-]+\.[\w.]+'), 'phone': re.compile(r'\+?\d[\d \-]{8,}\d'),
           'identity code': re.compile(r'\b\d{6}[-+A]\d{3}[0-9A-Y]\b'), 'url': re.compile(r'https?://')}
SPOKEN_LIMIT = 600
results = []


def step(name, ok, detail=''):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f'  - {detail}' if detail else ''), flush=True)


def load_env():
    env = {}
    for path in (ROOT / 'backend' / '.env', ROOT / '.env'):
        if path.exists():
            for line in path.read_text().splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    key, value = line.split('=', 1)
                    env[key.strip()] = value.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if v})
    return env


def leaks(text, user_id=''):
    found = [name for name, pattern in PII_RES.items() if pattern.search(text)]
    if user_id and user_id in text:
        found.append('user id')
    return found


def speakable(text, user_id):
    """Problems with a tool reply as heard by the agent (ids are allowed there; the agent is told to hide them)."""
    problems = leaks(ID_RE.sub('', text), user_id)
    if not text or len(text) > SPOKEN_LIMIT:
        problems.append(f'length {len(text)}')
    if re.search(r'[*#`\[\]{}<>|]', text):
        problems.append('markup')
    return problems


def vali_tasks(api, token):
    r = api.get('/v1/tasks', headers={'Authorization': 'Bearer ' + token})
    r.raise_for_status()
    body = r.json()
    return body if isinstance(body, list) else body.get('tasks', [])


def tool_ids_by_name(eleven, agent_id):
    agent = eleven.get(f'/agents/{agent_id}').raise_for_status().json()
    ids = agent['conversation_config']['agent']['prompt'].get('tool_ids') or []
    return {eleven.get(f'/tools/{tid}').raise_for_status().json()['tool_config']['name']: tid for tid in ids}


def simulate(eleven, agent_id, session_var, turns):
    """One simulation test run (the old simulate-conversation endpoint was removed on 31 Oct 2026).

    Real webhooks run (fallback call_real_tool); approve is always mocked so nothing can be submitted.
    The test holds the session token, so it is deleted afterwards. Returns (status_code, run or error text).
    """
    tools = tool_ids_by_name(eleven, agent_id)
    blocked = [tools[name] for name in ('approve',) if name in tools]
    test = {'name': 'vali voice_check ' + time.strftime('%Y-%m-%d %H:%M:%S'), 'type': 'simulation',
            'simulation_scenario': USER_PROMPT, 'simulation_max_turns': turns,
            'success_conditions': ['The agent started an errand with a tool, then reported its status from a tool '
                                   'result, and never read an errand id like t_123 aloud.'],
            'dynamic_variables': {'secret__vali_session': session_var},
            'tool_mock_config': {'mocking_strategy': 'selected', 'mocked_tool_ids': blocked,
                                 'fallback_strategy': 'call_real_tool'},
            'tool_mock_overrides': {tid: [{'mock_result': 'Not approved: approval is disabled in this test.'}]
                                    for tid in blocked}}
    r = eleven.post('/agent-testing/create', json=test)
    if r.status_code != 200:
        return r.status_code, r.text[:300]
    test_id = r.json()['id']
    try:
        r = eleven.post(f'/agents/{agent_id}/run-tests', json={'tests': [{'test_id': test_id}]})
        if r.status_code != 200:
            return r.status_code, r.text[:300]
        invocation = r.json()
        deadline = time.time() + 300
        while any(run['status'] == 'pending' for run in invocation['test_runs']) and time.time() < deadline:
            time.sleep(5)
            invocation = eleven.get(f"/test-invocations/{invocation['id']}").raise_for_status().json()
        return 200, invocation['test_runs'][0]
    finally:
        eleven.delete(f'/agent-testing/{test_id}')


def print_transcript(turns):
    print('--- transcript ---')
    for turn in turns:
        if turn.get('message'):
            print(f"{turn['role']:>5}: {turn['message']}")
        for call in turn.get('tool_calls') or []:
            print(f"   -> {call.get('tool_name')}({call.get('params_as_json')})")
        for res in turn.get('tool_results') or []:
            value = str(res.get('result_value'))[:300]
            print(f"   <- {res.get('tool_name')} error={res.get('is_error')} {value}")
    print('------------------')


def run_simulation(eleven, agent_id, session_var, turns, user_id, before_ids, api, token):
    """Returns the id of the errand the simulation created, or None."""
    code, run = simulate(eleven, agent_id, session_var, turns)
    if code != 200:
        step('simulate: test run', False, f'HTTP {code} {run}')
        return None
    convo = run.get('agent_responses') or (run.get('test_info') or {}).get('chat_history') or []
    verdict = run.get('condition_result') or {}
    step('simulate: test run', run['status'] in {'passed', 'failed'}, f"status {run['status']}, {len(convo)} messages")
    print('evaluator:', verdict.get('result'), '-', ((verdict.get('rationale') or {}).get('summary') or '')[:300])
    print_transcript(convo)
    tool_results = [res for turn in convo for res in (turn.get('tool_results') or [])]
    by_name = {}
    for res in tool_results:
        by_name.setdefault(res.get('tool_name'), []).append(res)
    mocked = [res for res in tool_results
              if str(res.get('result_value')).strip() in {'Tool Called.', ''} or 'test mode' in str(res.get('result_value'))]
    step('simulate: webhooks executed for real', bool(tool_results) and not mocked,
         f'{len(tool_results)} results, {len(mocked)} mocked' if tool_results else 'agent called no tools')
    created = by_name.get('create_errand') or []
    step('simulate: create_errand ok', any(not res.get('is_error') and 'id t_' in str(res.get('result_value')) for res in created),
         str(created[0].get('result_value'))[:160] if created else 'not called')
    status = (by_name.get('errand_status') or []) + (by_name.get('list_errands') or [])
    step('simulate: status tool ok', any(not res.get('is_error') and "can't find" not in str(res.get('result_value')) for res in status),
         'not called' if not status else f'{len(status)} call(s)')
    spoken_ids = [t['message'] for t in convo if t['role'] == 'agent' and ID_RE.search(t.get('message') or '')]
    step('simulate: agent never reads ids aloud', not spoken_ids, spoken_ids[0][:120] if spoken_ids else '')
    agent_leaks = sorted({leak for t in convo if t['role'] == 'agent' for leak in leaks(t.get('message') or '', user_id)})
    step('simulate: no personal data or urls spoken', not agent_leaks, ', '.join(agent_leaks))
    new = [t for t in vali_tasks(api, token) if t['id'] not in before_ids and t.get('source', 'voice') == 'voice']
    step('simulate: errand stored for this user', bool(new), new[0]['id'] if new else 'no new errand')
    return new[0]['id'] if new else None


def call_tool(api, secret, session_var, name, body):
    r = api.post(f'/v1/voice/tools/{name}', json=body,
                 headers={'X-Vali-Tool-Secret': secret, 'X-Vali-Session': session_var, 'Content-Type': 'application/json'})
    return r.status_code, (r.json().get('result', '') if r.headers.get('content-type', '').startswith('application/json') else r.text)


def run_direct(api, secret, session_var, user_id, errand_id):
    def check(name, body, expect=None):
        code, text = call_tool(api, secret, session_var, name, body)
        problems = [] if code == 200 else [f'HTTP {code}']
        problems += speakable(text, user_id)
        if expect and not re.search(expect, text):
            problems.append(f'expected /{expect}/')
        step(f'direct: {name}', not problems, '; '.join(problems) or text[:200])
        return text

    if not errand_id:
        text = check('create_errand', {'text': ERRAND}, r'\(id t_')
        match = ID_RE.search(text)
        errand_id = match.group(0) if match else None
    if not errand_id:
        step('direct: errand id', False, 'no errand to check')
        return None
    check('list_errands', {'limit': 5}, re.escape(errand_id))
    status = check('errand_status', {'id': errand_id})
    for _ in range(6):  # agent research can take a minute
        if 'Still researching' not in status:
            break
        time.sleep(15)
        status = check('errand_status', {'id': errand_id})
    check('approval_summary', {'id': errand_id}, r'^Nothing is waiting for your OK')
    code, text = call_tool(api, 'wrong-secret', session_var, 'list_errands', {})
    step('direct: wrong tool secret rejected', code == 401, f'HTTP {code}')
    code, text = call_tool(api, secret, session_var[:-4] + '0000', 'list_errands', {})
    step('direct: forged session rejected', code == 401, f'HTTP {code}')
    check('stop', {'id': errand_id}, r'^Stopped\.')  # always with an id, never the "current" errand
    return errand_id


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--api', default=DEFAULT_API)
    parser.add_argument('--token-file')
    parser.add_argument('--direct-only', action='store_true')
    parser.add_argument('--turns', type=int, default=8)
    args = parser.parse_args()
    env = load_env()
    token = env.get('VALI_TOKEN') or (Path(args.token_file).read_text().strip() if args.token_file else '')
    key, agent_id, secret = (env.get(k, '') for k in ('ELEVENLABS_API_KEY', 'VALI_ELEVENLABS_AGENT_ID', 'VALI_VOICE_TOOL_SECRET'))
    missing = [n for n, v in (('token', token), ('ELEVENLABS_API_KEY', key), ('VALI_ELEVENLABS_AGENT_ID', agent_id),
                              ('VALI_VOICE_TOOL_SECRET', secret)) if not v]
    if missing:
        sys.exit('Missing: ' + ', '.join(missing))
    with httpx.Client(base_url=args.api.rstrip('/'), timeout=90) as api, \
            httpx.Client(base_url=ELEVEN, headers={'xi-api-key': key}, timeout=90) as eleven:
        me = api.get('/v1/me', headers={'Authorization': 'Bearer ' + token})
        user_id = (me.json().get('id') or (me.json().get('user') or {}).get('id') or '') if me.status_code == 200 else ''
        r = api.post('/v1/voice/session?connection=webrtc', json={}, headers={'Authorization': 'Bearer ' + token})
        session_var = (r.json().get('dynamic_variables') or {}).get('secret__vali_session', '') if r.status_code == 200 else ''
        step('session: POST /v1/voice/session', bool(session_var) and r.headers.get('cache-control') == 'no-store',
             f'HTTP {r.status_code}, keys {sorted(r.json()) if r.status_code == 200 else "-"}')
        if not session_var:
            sys.exit(1)
        errand_id = None
        if not args.direct_only:
            before = {t['id'] for t in vali_tasks(api, token)}
            errand_id = run_simulation(eleven, agent_id, session_var, args.turns, user_id, before, api, token)
        errand_id = run_direct(api, secret, session_var, user_id, errand_id)
        if errand_id:
            task = api.get(f'/v1/tasks/{errand_id}', headers={'Authorization': 'Bearer ' + token}).json()
            print(f"errand id: {errand_id}  source={task.get('source')} research={task['research']['status']} "
                  f"cost=${task['research'].get('cost')}")
    print(f'{results.count(True)} passed, {results.count(False)} failed')
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()
