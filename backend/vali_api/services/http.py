"""Bounded, credential-free public API requests; failures never expose responses."""
import httpx

TIMEOUT = 5.0


def request_json(method, url, *, transport=None, **kwargs):
    try:
        with httpx.Client(timeout=TIMEOUT, transport=transport) as client:
            response = client.request(method, url, **kwargs)
            response.raise_for_status()
            payload = response.json()
            return payload if isinstance(payload, dict) else None
    except (httpx.HTTPError, ValueError):
        return None
