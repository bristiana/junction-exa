"""Pair inbound numbers and send plain text replies through the messaging API."""
import re
import httpx


def handle_whatsapp_message(store, from_number, text_or_none, media_id_or_none):
    match = re.fullmatch(r'link\s+(\d{6})', (text_or_none or '').strip(), flags=re.I)
    if match:
        if store.link_number(match.group(1), from_number):
            return 'Vali linked. Your tasks are now shared.'
        return 'That pairing code is invalid or expired. Request a new code.'
    return 'Send link followed by the six-digit code shown in Vali.'


def send_whatsapp_message(config, to, body, transport=None):
    with httpx.Client(transport=transport, timeout=30) as client:
        response = client.post(
            f'https://graph.facebook.com/v21.0/{config.whatsapp_phone_number_id}/messages',
            headers={'Authorization': f'Bearer {config.whatsapp_token}'},
            json={'messaging_product': 'whatsapp', 'to': to, 'type': 'text', 'text': {'body': body}})
        response.raise_for_status()
        return response.json()
