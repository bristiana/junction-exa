"""WhatsApp: the next-errand button, the two situation questions, and "my situation"."""
import asyncio

from vali_wa.flow import WhatsAppFlow
from vali_wa.render import render_result, render_situation, result_buttons
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


def task_with_next():
    return {"id": "t1", "task": "How do I open a bank account?", "mode": "check", "source": "whatsapp",
            "research": {"status": "completed", "output": {"text": "Basic account first.", "grounding": [], "structured": {
                "answer": "Open a basic account first.", "actions": [], "key_facts": [], "next_errand": "Register my address at DVV"}}}}


def make():
    api, created, saved = FakeApi(), [], {}
    task = task_with_next()

    def create(user, text, source=None):
        created.append(text)
        return {**task, "id": "t2", "task": text}

    flow = WhatsAppFlow(api=api, find_user_by_number=lambda n: {"id": "u1"}, link_number=lambda c, n: None,
                        create_task=create, get_active_task=lambda u: task, execute=lambda *a: None,
                        approve=lambda *a: None, stop=lambda *a: None,
                        get_situation=lambda user: dict(saved) or None,
                        set_situation=lambda user, patch: saved.update(patch))
    return flow, api, created, saved


def test_next_button_and_line():
    buttons = result_buttons(task_with_next())
    assert ("next:t1", "Do the next step") in buttons and all(len(title) <= 20 for _, title in buttons)
    assert "Next for you: Register my address at DVV" in "\n".join(render_result(task_with_next(), buttons=True))
    assert render_situation({"citizenship": "eu", "country": "Romania", "student": True, "school": "Aalto"})[0] == \
        "Your situation: EU citizen from Romania, student at Aalto. I answer for that."


def test_tapping_next_starts_that_errand():
    flow, api, created, saved = make()
    asyncio.run(flow.handle(IncomingMessage(NUMBER, "m1", "interactive", reply_id="next:t1")))
    assert created == ["Register my address at DVV"] and ("reaction", "👀") in api.out


def test_situation_buttons_then_my_situation():
    flow, api, created, saved = make()
    asyncio.run(flow.handle(IncomingMessage(NUMBER, "m2", "interactive", reply_id="sit:eu")))
    assert saved == {"citizenship": "eu"}
    assert ("buttons", "Are you a student here?", [("sit:student", "Student"), ("sit:not_student", "Not a student")]) in api.out
    asyncio.run(flow.handle(IncomingMessage(NUMBER, "m3", "interactive", reply_id="sit:student")))
    assert saved == {"citizenship": "eu", "student": True}
    asyncio.run(flow.handle(IncomingMessage(NUMBER, "m4", "text", text="my situation")))
    assert ("text", "Your situation: EU citizen, student. I answer for that.") in api.out
