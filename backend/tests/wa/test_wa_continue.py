"""A stopped run picks up where it stopped: Continue button after stop, 'continue' typed or tapped."""
import asyncio

from fastapi import HTTPException

from vali_wa.flow import WhatsAppFlow
from vali_wa.parse import parse_command
from vali_wa.render import continue_buttons, render_execution_update
from vali_wa.webhook import IncomingMessage

NUMBER = "+358401234567"


class FakeApi:
    def __init__(self):
        self.out = []

    async def mark_read(self, message_id):
        pass

    async def send_text(self, to, body, reply_to=None):
        self.out.append(("text", body))

    async def send_buttons(self, to, body, buttons):
        self.out.append(("buttons", body, buttons))

    async def send_reaction(self, to, message_id, emoji):
        self.out.append(("reaction", emoji))


def make(task, resume_result=None, resume_error=None):
    api, calls = FakeApi(), []

    def resume(tid):
        calls.append(("resume", tid))
        if resume_error:
            raise resume_error
        return resume_result

    def stop(tid):
        calls.append(("stop", tid))
        return {**task, "execution": {**task["execution"], "status": "stopped"}}

    flow = WhatsAppFlow(api=api, find_user_by_number=lambda n: "u_test", link_number=lambda c, n: None,
                        create_task=lambda *a, **k: task, get_active_task=lambda u: task,
                        execute=lambda *a: None, approve=lambda *a: None, stop=stop, resume=resume)
    return flow, api, calls


def run_task(status, steps=()):
    return {"id": "t_sauna", "task": "Book a sauna", "source": "whatsapp",
            "research": {"status": "completed", "output": {"structured": {"actions": []}}},
            "execution": {"status": status, "steps": [{"text": s} for s in steps]}}


def test_parse_continue_words():
    for word in ["continue", "Continue!", "jatka", "resume", "continuă"]:
        assert parse_command(word).kind == "continue"


def test_stop_offers_a_continue_button():
    task = run_task("running", ["Opened kulttuurisauna.fi"])
    flow, api, calls = make(task)
    asyncio.run(flow.handle(IncomingMessage(NUMBER, "m1", "text", text="stop")))
    assert ("stop", "t_sauna") in calls
    assert ("buttons", "Stopped. Nothing was sent.", [("continue:t_sauna", "Continue")]) in api.out
    assert ("reaction", "✋") in api.out


def test_tap_and_type_continue():
    task = run_task("stopped", ["Asked you: Which email should I book under?"])
    flow, api, calls = make(task, resume_result=run_task("starting"))
    asyncio.run(flow.handle(IncomingMessage(NUMBER, "m2", "interactive", reply_id="continue:t_sauna")))
    assert calls[-1] == ("resume", "t_sauna")
    assert ("text", "Picking up where it stopped.") in api.out and ("reaction", "🔁") in api.out
    flow, api, calls = make(task, resume_result=run_task("starting"))
    asyncio.run(flow.handle(IncomingMessage(NUMBER, "m3", "text", text="continue")))
    assert calls[-1] == ("resume", "t_sauna")


def test_continue_with_nothing_stopped():
    task = run_task("done")
    flow, api, calls = make(task, resume_error=HTTPException(409, "Nothing to continue"))
    asyncio.run(flow.handle(IncomingMessage(NUMBER, "m4", "text", text="continue")))
    assert calls[-1] == ("resume", None)
    assert any("nothing to continue" in o[1].lower() for o in api.out if o[0] == "text")


def test_render_stopped_with_and_without_buttons():
    task = run_task("stopped")
    assert render_execution_update(task, buttons=True) == ["Stopped. Nothing was sent."]
    assert "*continue*" in render_execution_update(task)[0]
    assert continue_buttons(task) == [("continue:t_sauna", "Continue")]
    assert continue_buttons(run_task("running")) == []
