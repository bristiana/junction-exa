"""Seed the demo account with finished, research-only errands (see docs/DEMO.md, "Before the demo").

Usage:
    backend/.venv/bin/python scripts/demo_seed.py --token-file /path/to/tok [--api URL] [--dry-run]

Creates a find errand, the EU261 claim errand and the letter.png letter, waits for each to finish and
prints one line per errand: id, mode, status, seconds. Research only: it never calls /execute or approve.
The token is read from --token-file (or GOLDEN_TOKEN) and is never printed.
"""
import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import httpx  # noqa: E402
import golden  # noqa: E402

FIXTURE = Path(__file__).with_name('fixtures') / 'letter.png'
ERRANDS = [
    ('find', 'Find a sauna in Helsinki open tonight for 6 people'),
    ('claim', 'My Finnair flight from Helsinki to Barcelona last Tuesday landed 4 hours late. What can I get?'),
    ('letter', f'upload {FIXTURE.name} to /v1/letters'),
]


async def seed(api, token, kind, text):
    errand = golden.Errand(kind)
    status = 'error'
    async with httpx.AsyncClient(base_url=api, headers={'Authorization': f'Bearer {token}'}, timeout=120) as client:
        try:
            if kind == 'letter':
                task = (await golden.call(client, 'POST', '/v1/letters',
                                          files={'file': (FIXTURE.name, FIXTURE.read_bytes(), 'image/png')})).json()
                errand.task_id, errand.mode = task['id'], task.get('mode', '-')
            else:
                task = await golden.create(client, errand, text)
            task = await asyncio.wait_for(golden.wait_research(client, errand, task), golden.TIMEOUT)
            status = task['research']['status']
        except asyncio.TimeoutError:
            status = 'timeout'
        except golden.Fail as exc:
            status = str(exc).replace(token, '***')[:120]
        except Exception as exc:
            status = f'{type(exc).__name__}'
    print(f'{errand.task_id or "-"}  mode={errand.mode:<6} status={status}  {time.monotonic() - errand.started:.1f}s',
          flush=True)
    return status == 'completed'


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--api', default=golden.DEFAULT_API)
    parser.add_argument('--token-file')
    parser.add_argument('--dry-run', action='store_true', help='print what would be created and exit')
    args = parser.parse_args()
    api = args.api.rstrip('/')
    if args.dry_run:
        for kind, text in ERRANDS:
            print(f'would create {kind}: {text}  (POST {api}{"/v1/letters" if kind == "letter" else "/v1/tasks"})')
        return 0
    token = os.environ.get('GOLDEN_TOKEN', '').strip()
    if args.token_file:
        token = Path(args.token_file).read_text().strip()
    if not token:
        parser.error('set GOLDEN_TOKEN or pass --token-file')
    results = await asyncio.gather(*(seed(api, token, k, t) for k, t in ERRANDS))
    return 0 if all(results) else 1


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
