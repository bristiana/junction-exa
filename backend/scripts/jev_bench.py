"""How well does Jev pick the element to click? Run: JEV_API_KEY=... python backend/scripts/jev_bench.py

For each local fixture and intent, the snapshot's element lines are the options; Jev chooses one
(asked twice, reversed order). Prints top-1 accuracy, mean confidence and latency.
"""
import functools
import http.server
import re
import statistics
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vali_agent.browser import Browser  # noqa: E402
from vali_agent.jev import Jev  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / 'tests' / 'agent' / 'fixtures'
CASES = [  # (fixture, intent, regex the chosen line must match)
    ('claim.html', 'Type the email address', r'input\[email\]'),
    ('claim.html', 'Choose the claim type', r'select'),
    ('claim.html', 'Agree to the terms', r'Accept terms'),
    ('claim.html', 'Prefer to be contacted by phone', r'Phone contact'),
    ('claim.html', 'Write the description of what happened', r'textarea'),
    ('claim.html', 'Send the claim', r'Submit claim'),
    ('widget_wizard.html', 'Go to the next step of the booking', r'Next'),
    ('widget_dropdowns.html', 'Open the list of options', r'combobox|select'),
    ('widget_dates.html', 'Pick the date', r'date|calendar|Choose'),
    ('consent_fi.html', 'Refuse optional cookies', r'Vain välttämättömät'),
    ('consent_fi.html', 'Enter my name', r'Nimi'),
    ('form_mentions.html', 'Type the feedback message', r'textarea'),
    ('form_mentions.html', 'Send the feedback', r'Lähetä'),
]


def main():
    jev = Jev()
    if not jev.enabled:
        sys.exit('Set JEV_API_KEY')
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(FIXTURES))
    handler.log_message = lambda *a: None
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    browser = Browser()
    hits, confidences, latencies = 0, [], []
    try:
        for page, intent, expected in CASES:
            browser.goto(f'http://127.0.0.1:{server.server_port}/{page}')
            snapshot = browser.snapshot()
            lines = [line for line in snapshot.split('\nText: ')[0].splitlines() if line.startswith('[e')]
            options = {line.split(']')[0][1:]: line.split('] ', 1)[1][:200] for line in lines}
            state = f'A web page. Page text: {snapshot.split("Text: ", 1)[-1][:1500]}'
            started = time.monotonic()
            ref, p = jev.choose(state, f'Which element should be used to do this: {intent}?', options)
            latencies.append(time.monotonic() - started)
            ok = bool(ref and re.search(expected, options.get(ref, '')))
            hits += ok
            confidences.append(p)
            print(f"{'OK ' if ok else 'BAD'} {p:.2f} {page:22} {intent:40} -> {ref} {options.get(ref, '')[:60]}")
    finally:
        browser.close()
        server.shutdown()
    print(f'\naccuracy {hits}/{len(CASES)} = {hits / len(CASES):.0%}, mean confidence {statistics.mean(confidences):.2f}, '
          f'latency median {statistics.median(latencies):.2f}s max {max(latencies):.2f}s, calls {jev.calls}')


if __name__ == '__main__':
    main()
