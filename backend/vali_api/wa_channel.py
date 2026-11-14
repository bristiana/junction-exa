"""Graph client lifetime and best-effort worker notifications for Vali."""
import asyncio
import threading
import logging

from vali_wa.api import GraphAPIClient, GraphAPIError
from vali_wa.render import render_nothing_new, render_result, render_watch_update, result_buttons, split_messages

from .monitors import watch_criteria

logger = logging.getLogger("vali.whatsapp")


def log_failure(operation, exc, *, task_id=None, message_id=None):
    # Exception strings and tracebacks can contain provider bodies or credentials.
    logger.warning("%s task_id=%s message_id=%s error_type=%s status_code=%s code=%s",
                   operation, task_id, message_id, type(exc).__name__,
                   exc.status_code if isinstance(exc, GraphAPIError) else None,
                   exc.code if isinstance(exc, GraphAPIError) else None)


class ChannelAPI:
    """Use a fresh client per operation: workers have independent event loops."""
    def __init__(self, config):
        self.config = config

    async def _call(self, method, *args, **kwargs):
        if not self.config.whatsapp_token or not self.config.whatsapp_phone_number_id:
            return None
        async with GraphAPIClient(self.config.whatsapp_phone_number_id, self.config.whatsapp_token) as client:
            return await getattr(client, method)(*args, **kwargs)

    async def send_text(self, to, body, reply_to=None):
        return await self._call('send_text', to, body, reply_to=reply_to)

    async def upload_media(self, data, mime_type='image/jpeg'):
        return await self._call('upload_media', data, mime_type)

    async def send_image(self, to, link=None, caption=None, *, media_id=None):
        return await self._call('send_image', to, link, caption, media_id=media_id)

    async def send_buttons(self, to, body, buttons):
        return await self._call('send_buttons', to, body, buttons)

    async def mark_read(self, message_id):
        # A failed receipt must never discard an errand.
        try:
            return await self._call('mark_read', message_id)
        except Exception as exc:
            log_failure("read receipt failed", exc, message_id=message_id)
            return None

    async def send_reaction(self, to, message_id, emoji):
        # A reaction is decoration: a failure never stops the reply.
        try:
            return await self._call('send_reaction', to, message_id, emoji)
        except Exception as exc:
            log_failure("reaction failed", exc, message_id=message_id)
            return None

    async def get_media_url(self, media_id):
        return await self._call('get_media_url', media_id)

    async def download_media(self, url):
        return await self._call('download_media', url)


def push_task(application, task_id, renderer):
    """Called after a successful state transition, never fail the worker on send."""
    try:
        task = application.state.store.get_task(task_id)
        if task['source'] != 'whatsapp' and (task.get('execution') or {}).get('channel') != 'whatsapp':
            return
        user = application.state.store.get_user(task['user_id'])
        if not user.get('wa_number'):
            return

        async def send():
            api, number = application.state.whatsapp_api, user['wa_number']
            execution = task.get('execution') or {}
            question = execution.get('question') if execution.get('status') in {'starting', 'running'} else None
            text = question.get('text', '') if isinstance(question, dict) else str(question or '')
            if text and text != execution.get('wa_question_sent'):
                for body in split_messages(text):
                    await api.send_text(number, body)
                application.state.store.patch_execution(task_id, {'wa_question_sent': text})
                return
            if question:
                return
            bodies = renderer(task)
            if execution.get('status') == 'awaiting_approval':
                if hasattr(api, 'upload_media') and hasattr(api, 'send_image'):
                    try:
                        jpeg = application.state.store.get_live_frame(task_id)
                        if jpeg:
                            media_id = await api.upload_media(jpeg, 'image/jpeg')
                            if media_id:
                                caption = '\n'.join(bodies)
                                await api.send_image(number, media_id=media_id, caption=caption[:1024])
                                bodies = split_messages(caption[1024:])
                    except Exception as exc:
                        log_failure('approval image failed', exc, task_id=task_id)
                for body in bodies:
                    await api.send_text(number, body)
                if hasattr(api, 'send_buttons'):
                    try:
                        await api.send_buttons(number, 'Submit this errand?',
                                               [(f'approve:{task_id}', 'Approve'), (f'stop:{task_id}', 'Stop')])
                    except Exception as exc:
                        log_failure('approval buttons failed', exc, task_id=task_id)
                return
            buttons = result_buttons(task) if renderer is render_result and hasattr(api, 'send_buttons') else []
            if buttons:
                # The answer's actions as tap-to-choose buttons; the last part of the answer carries them.
                parts = render_result(task, buttons=True)
                last = parts.pop() if len(parts[-1]) <= 1024 else 'What next?'
                for body in parts:
                    await api.send_text(number, body)
                try:
                    await api.send_buttons(number, last, buttons)
                    return
                except Exception as exc:
                    log_failure('result buttons failed', exc, task_id=task_id)
                    replies = '\n'.join(f'Reply {i + 1} to {title}' for i, (_, title) in enumerate(buttons))
                    bodies = split_messages(('' if last == 'What next?' else last + '\n\n') + replies)
            for body in bodies:
                await api.send_text(number, body)
        run_outside_loop(send)
    except Exception as exc:
        log_failure("task notification failed", exc, task_id=task_id)


def run_outside_loop(make_coroutine, timeout=60):
    """asyncio.run cannot start inside a running loop, and the browser sandbox (Playwright) runs one in this
    thread: there the send gets its own thread."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(make_coroutine())
    errors = []

    def worker():
        try:
            asyncio.run(make_coroutine())
        except Exception as exc:
            errors.append(exc)
    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    thread.join(timeout)
    if errors:
        raise errors[0]


async def push_watch_update(application, watch, update):
    """A new watch finding (None: a requested check found nothing new), sent once to the owner's linked number;
    never fails the delivery."""
    try:
        store = application.state.store
        number = (store.get_user(watch['user_id']) or {}).get('wa_number')
        if not number:
            return
        task = store.get_task(watch['task_id']) if watch.get('task_id') else None
        lang = (task or {}).get('lang') or 'en'
        bodies = render_watch_update(watch_criteria(watch['query']), update, lang) if update else render_nothing_new(lang)
        for body in bodies:
            await application.state.whatsapp_api.send_text(number, body)
    except Exception as exc:
        log_failure("watch notification failed", exc, task_id=watch.get('task_id'))
