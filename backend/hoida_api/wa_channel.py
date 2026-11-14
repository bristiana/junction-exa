"""Graph client lifetime and best-effort worker notifications for Vali."""
import asyncio

from hoida_wa.api import GraphAPIClient


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

    async def mark_read(self, message_id):
        # A failed receipt must never discard an errand.
        try:
            return await self._call('mark_read', message_id)
        except Exception:
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
            for body in renderer(task):
                await application.state.whatsapp_api.send_text(user['wa_number'], body)
        asyncio.run(send())
    except Exception:
        pass
