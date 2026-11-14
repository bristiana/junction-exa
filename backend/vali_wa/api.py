"""Async Graph API client. The caller owns credentials and closes the client."""

import httpx


class GraphAPIError(Exception):
    def __init__(self, status_code: int, code: int | None = None):
        self.status_code = status_code
        self.code = code
        super().__init__(f"Vali messaging request failed (HTTP {status_code})")


class GraphAPITransportError(GraphAPIError):
    def __init__(self):
        super().__init__(0)


class GraphAPIClient:
    BASE_URL = "https://graph.facebook.com/v21.0"

    def __init__(self, phone_number_id: str, token: str, *, transport=None, timeout=30.0):
        self.phone_number_id = phone_number_id
        self._client = httpx.AsyncClient(
            transport=transport, timeout=timeout,
            headers={"Authorization": f"Bearer {token}"}, follow_redirects=False,
        )

    async def aclose(self):
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.aclose()

    async def _request(self, method, url, **kwargs):
        for attempt in range(2):
            try:
                response = await self._client.request(method, url, **kwargs)
            except httpx.RequestError:
                raise GraphAPITransportError() from None
            if 500 <= response.status_code <= 599 and attempt == 0:
                continue
            if response.is_error or response.is_redirect:
                try:
                    code = response.json().get("error", {}).get("code")
                except (ValueError, AttributeError):
                    code = None
                raise GraphAPIError(response.status_code, code)
            return response

    async def _send(self, payload):
        response = await self._request(
            "POST", f"{self.BASE_URL}/{self.phone_number_id}/messages", json=payload)
        return response.json()

    async def send_text(self, to, body, reply_to=None):
        if not body or len(body) > 4096:
            raise ValueError("Text must contain 1–4096 characters")
        payload = {"messaging_product": "whatsapp", "to": to, "type": "text",
                   "text": {"body": body}}
        if reply_to:
            payload["context"] = {"message_id": reply_to}
        return await self._send(payload)

    async def upload_media(self, data, mime_type='image/jpeg'):
        response = await self._request(
            "POST", f"{self.BASE_URL}/{self.phone_number_id}/media",
            data={"messaging_product": "whatsapp", "type": mime_type},
            files={"file": ("screenshot.jpg", data, mime_type)})
        return response.json()["id"]

    async def send_image(self, to, link=None, caption=None, *, media_id=None):
        image = {"id": media_id} if media_id else {"link": link}
        if caption is not None:
            image["caption"] = caption
        return await self._send({"messaging_product": "whatsapp", "to": to,
                                 "type": "image", "image": image})

    async def send_document(self, to, link, filename, caption=None):
        document = {"link": link, "filename": filename[:240] or "document.pdf"}
        if caption:
            document["caption"] = caption[:1024]
        return await self._send({"messaging_product": "whatsapp", "to": to, "type": "document", "document": document})

    async def send_buttons(self, to, body, buttons, image=None):
        if not 1 <= len(buttons) <= 3:
            raise ValueError("Provide 1–3 buttons")
        if len({id_ for id_, _ in buttons}) != len(buttons):
            raise ValueError("Button IDs must be unique")
        if not body or len(body) > 1024 or any(
                not id_ or len(id_) > 256 or not title or len(title) > 20
                for id_, title in buttons):
            raise ValueError("Invalid interactive message length")
        interactive = {"type": "button", "body": {"text": body}, "action": {"buttons": [
            {"type": "reply", "reply": {"id": id_, "title": title}} for id_, title in buttons]}}
        if image:
            interactive["header"] = {"type": "image", "image": {"link": image}}
        return await self._send({"messaging_product": "whatsapp", "to": to, "type": "interactive",
                                 "interactive": interactive})

    async def send_reaction(self, to, message_id, emoji):
        return await self._send({"messaging_product": "whatsapp", "recipient_type": "individual", "to": to,
                                 "type": "reaction", "reaction": {"message_id": message_id, "emoji": emoji}})

    async def mark_read(self, message_id):
        return await self._send({"messaging_product": "whatsapp", "status": "read",
                                 "message_id": message_id})

    async def get_media_url(self, media_id):
        response = await self._request("GET", f"{self.BASE_URL}/{media_id}")
        return response.json()["url"]

    async def download_media(self, url):
        response = await self._request("GET", url)
        return response.content
