"""Task pushes must reach WhatsApp from inside a running event loop (the Playwright sandbox)."""
import asyncio

from vali_api.wa_channel import run_outside_loop


def test_runs_without_a_loop():
    seen = []

    async def send():
        seen.append('sent')
    run_outside_loop(send)
    assert seen == ['sent']


def test_runs_inside_a_running_loop():
    seen = []

    async def send():
        seen.append('sent')

    async def sandbox():  # like Playwright's sync API: a loop is running in this thread
        run_outside_loop(send)
    asyncio.run(sandbox())
    assert seen == ['sent']
