"""Channel orchestration with sync or async injected task/media functions.

handle returns the outgoing Graph API message payloads, excluding read receipts.
execute receives a zero-based action index. Callback results may be updated tasks
or None; None gets a short acknowledgement. Callbacks must enforce task ownership
and make final approval atomic in their task store.
"""

import inspect

from .parse import parse_command
from .render import (render_ack, render_check, render_error, render_execution_update, render_help,
                     render_link_failed, render_link_paused, render_linked, render_result)


async def _call(callback, *args, **kwargs):
    result = callback(*args, **kwargs)
    return await result if inspect.isawaitable(result) else result


class WhatsAppFlow:
    def __init__(self, *, api, find_user_by_number, link_number, create_task,
                 get_active_task, execute, approve, stop, transcribe=None, read_letter=None, message=None,
                 check=None):
        self.api = api
        self.find_user_by_number = find_user_by_number
        self.link_number = link_number
        self.create_task = create_task
        self.get_active_task = get_active_task
        self.execute = execute
        self.approve = approve
        self.stop = stop
        self.transcribe = transcribe
        self.read_letter = read_letter
        self.message = message
        self.check = check  # check(user): triggers the newest live watch, returns its language or None

    async def handle(self, msg):
        # Read receipts also apply to unknown senders and unsupported media.
        await self.api.mark_read(msg.message_id)
        bodies = await self._handle(msg)
        sent = []
        for body in bodies:
            await self.api.send_text(msg.from_number, body, reply_to=msg.message_id)
            sent.append({"messaging_product": "whatsapp", "to": msg.from_number,
                         "type": "text", "text": {"body": body},
                         "context": {"message_id": msg.message_id}})
        return sent

    async def _handle(self, msg):
        text = (msg.reply_id or msg.text or "") if msg.kind in {"text", "interactive"} else ""
        command = parse_command(text)
        if command.kind == "link":
            user = await _call(self.link_number, command.code, msg.from_number)
            if user == "paused":  # too many wrong codes from all numbers
                return render_link_paused()
            return render_linked() if user else render_link_failed()
        user = await _call(self.find_user_by_number, msg.from_number)
        if not user:
            return render_help()
        if msg.kind in {"audio", "image"}:
            reader = self.transcribe if msg.kind == "audio" else self.read_letter
            if reader is None:
                return render_error("Voice notes are not available. Please send your errand in text."
                                    if msg.kind == "audio" else "Letter reading is not available. Please describe the letter in text.")
            if not msg.media_id:
                return render_error("This message has no downloadable media. Please send it again.")
            url = await self.api.get_media_url(msg.media_id)
            data = await self.api.download_media(url)
            args = (data, msg.mime_type) if msg.kind == "audio" else (data, msg.mime_type, msg.caption)
            text = await _call(reader, *args)
            if not text or not text.strip():
                return render_error("I could not read that message. Please describe the errand in text.")
            # Media content is errand text, never an implicit approval or pairing command.
            task = await _call(self.create_task, user, text, source="whatsapp")
            return render_ack(task)
        if msg.kind not in {"text", "interactive"}:
            return render_error("Please send your errand as text, a voice note, or a photo of a letter.")
        task = await _call(self.get_active_task, user)
        execution = (task or {}).get("execution") or {}
        if msg.kind == "interactive" and msg.reply_id and ":" in msg.reply_id:
            action, tid = msg.reply_id.split(":", 1)
            if not task or tid != task["id"] or action not in {"approve", "stop"}:
                return render_error("That button is no longer active. Reply *status* for the current errand.")
            command = parse_command(action)
        # Short answers (yes, a number, etc.) belong to an outstanding question.
        if self.message and task and msg.kind == "text" and text.strip() and (
                execution.get("status") in {"starting", "running"} or execution.get("question")) and (
                command.kind not in {"stop", "status"} or (
                    execution.get("question") and text.strip().casefold() in {"no", "nu", "ei"})):
            await _call(self.message, task["id"], text)
            return render_error("Message passed to your running errand.")
        if command.kind == "help":
            return render_help()
        if command.kind == "check" and self.check:
            lang = await _call(self.check, user)
            return render_check(lang) if lang else render_error("You have no live watch to check. Send me something to watch first.")
        if command.kind in {"choose", "approve", "stop", "status"}:
            if not task:
                return render_error("No active errand. Send me an errand to get started.")
            execution = task.get("execution") or {}
            if command.kind == "status":
                return render_execution_update(task) if execution else render_result(task)
            if command.kind == "choose":
                actions = (((task.get("research") or {}).get("output") or {}).get("structured") or {}).get("actions") or []
                if command.n > len(actions):
                    return render_error("That action is not available. Reply *status* to see your choices.")
                if execution.get("status") in {"starting", "running", "awaiting_approval", "submitting"}:
                    return render_error("This errand is already in progress. Reply *status* for an update.")
                updated = await _call(self.execute, task["id"], command.n - 1)
            elif command.kind == "approve":
                if execution.get("status") != "awaiting_approval":
                    return render_error("There is no submission awaiting your approval.")
                updated = await _call(self.approve, task["id"])
            else:
                if execution.get("status") not in {"starting", "running", "awaiting_approval", "submitting"}:
                    return render_error("There is no running execution to stop.")
                updated = await _call(self.stop, task["id"])
            if isinstance(updated, dict) and updated.get("execution"):
                return render_execution_update(updated)
            return render_error({"choose": "Starting your chosen action.", "approve": "Approval received.",
                                 "stop": "Stop requested."}[command.kind])
        if not text.strip():
            return render_help()
        if self.message and task and execution.get("status") in {"starting", "running", "awaiting_approval", "submitting"}:
            await _call(self.message, task["id"], command.text)
            return render_error("Message passed to your running errand.")
        task = await _call(self.create_task, user, command.text, source="whatsapp")
        return render_ack(task)
