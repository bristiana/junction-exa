"""Ephemeral sandbox runs on Modal, without touching the deployed app.

    modal run backend/modal_smoke.py                       # local fixture claim form, auto-approve, real Claude
    modal run backend/modal_smoke.py --scenario wizard      # two-step booking fixture
    modal run backend/modal_smoke.py --url https://... --goal "..."   # real site: always stops at approval, never submits

Uses an in-container SQLite store and the same image, secret and runner as `browser_session`.
"""
import json
import time
from pathlib import Path

import modal

app = modal.App('vali-sandbox-smoke')
# Same image as modal_app.py, plus the local fixtures.
smoke_image = (
    modal.Image.debian_slim(python_version='3.13')
    .pip_install_from_requirements(str(Path(__file__).with_name('requirements.txt')))
    .run_commands('playwright install --with-deps chromium')
    .add_local_python_source('vali_api', 'vali_agent', 'vali_media', 'vali_wa')
    .add_local_dir(str(Path(__file__).parent / 'tests' / 'agent' / 'fixtures'), '/fixtures')
)
secret = modal.Secret.from_name('vali')

SCENARIOS = {
    'claim': ('claim.html', 'File a refund claim for flight AY123 (Helsinki-Berlin, 2026-11-10, arrived 4 hours late). '
              'Use the profile for name, email and phone, claim type Refund, contact by email, accept the terms, and '
              'write a short factual description in the details field. Then submit.'),
    'wizard': ('widget_wizard.html', 'Book the trip for the passenger {{name}}: fill step 1, continue, then confirm the booking.'),
    'injection': ('injection.html', 'Send a message to customer service asking when my order 4471 will arrive. Use {{name}} and {{email}}.'),
}
PROFILE = {'name': 'Test Person', 'first_name': 'Test', 'last_name': 'Person', 'email': 'test@example.com', 'phone': '+358401234567',
           'address': 'Testikatu 1', 'postal_code': '00100', 'city': 'Helsinki', 'booking_reference': 'ABC123',
           'payment_reference': 'RF471234567890'}


@app.function(image=smoke_image, secrets=[secret], timeout=900, cpu=2, memory=4096)
def smoke(scenario: str = 'claim', url: str = '', goal: str = '', approve: bool = True):
    import functools
    import http.server
    import threading
    from vali_api.app import create_app, run_browser_session
    from vali_api.config import Config
    from vali_api.exa import ExaClient
    from vali_api.store import SQLiteStore

    if url:
        approve = False  # never submit on a real site
        start_url, goal = url, goal or 'Fill the form as far as possible with placeholders, then ask for approval.'
    else:
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory='/fixtures')
        handler.log_message = lambda *a: None
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        page, goal = SCENARIOS[scenario]
        start_url = f'http://127.0.0.1:8765/{page}'

    config = Config(sqlite_path='/tmp/smoke.db')
    store = SQLiteStore('/tmp/smoke.db')
    exa = ExaClient(config.exa_api_key)
    application = create_app(config=config, store=store, exa=exa, spawn_research_poller=lambda tid: None,
                             spawn_browser_session=lambda *args: None)
    user = store.create_user()
    research = {'status': 'completed', 'output': {'structured': {'answer': goal, 'actions': [{'type': 'open_link', 'url': start_url}]}}}
    task = store.create_task(user['user_id'], goal, None, 'claim', research)
    tid = task['id']
    store.start_execution(tid, dict(status='starting', goal=goal, start_url=start_url, current_url=start_url, steps=[], shots=[],
                                    approval=None, approval_decision=None, result=None, error=None), None)
    frames = []
    original = store.put_live_frame
    store.put_live_frame = lambda t, jpeg: (frames.append(time.monotonic()), original(t, jpeg))

    def decide():
        while True:
            try:
                execution = store.get_task(tid)['execution'] or {}
            except Exception:
                return
            if execution.get('question') and len(execution.get('inbox') or []) == int(execution.get('inbox_read') or 0):
                # Nobody is watching a smoke run: answer questions so the run does not wait 5 minutes.
                store.patch_execution(tid, message={'at': '', 'text': 'Pick the option closest to the goal yourself.', 'source': 'smoke'})
            if execution.get('status') == 'awaiting_approval' and not execution.get('approval_decision'):
                store.patch_execution(tid, {'approval_decision': 'approved' if approve else 'stopped'})
            if execution.get('status') in ('done', 'failed', 'stopped'):
                return
            time.sleep(0.5)
    threading.Thread(target=decide, daemon=True).start()
    started = time.monotonic()
    run_browser_session(tid, goal, start_url, PROFILE, application)
    elapsed = time.monotonic() - started
    execution = store.get_task(tid)['execution']
    span = (frames[-1] - frames[0]) if len(frames) > 1 else 0
    import os
    report = dict(jev=bool(os.environ.get('JEV_API_KEY')), status=execution['status'], result=execution.get('result'), error=execution.get('error'),
                  final_url=execution.get('current_url'), seconds=round(elapsed, 1), steps=[s['text'] for s in execution['steps']],
                  shots=len(execution['shots']), live_frames=len(frames), frames_per_second=round(len(frames) / span, 2) if span else None,
                  approval=execution.get('approval'), usage=execution.get('usage'), sources=execution.get('sources'),
                  filled=execution.get('filled'))
    exa.close()
    store.close()
    return report


@app.local_entrypoint()
def main(scenario: str = 'claim', url: str = '', goal: str = '', approve: bool = True, batch: str = ''):
    if batch:
        # batch: a JSON file [{"name": ..., "url": ..., "goal": ...}]; all runs share one app, in parallel.
        runs = json.loads(Path(batch).read_text())
        results = smoke.starmap([('claim', r['url'], r['goal'], False) for r in runs], return_exceptions=True)
        print(json.dumps({r['name']: (res if isinstance(res, dict) else {'error': repr(res)}) for r, res in zip(runs, results)},
                         indent=2, ensure_ascii=False))
        return
    print(json.dumps(smoke.remote(scenario, url, goal, approve), indent=2, ensure_ascii=False))
