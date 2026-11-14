"""One fast, cheap JSON call to Claude for small side jobs (mapping claims to quotes, short tips)."""
import json
import logging

from .config import vali_env

logger = logging.getLogger('vali.llm')


def fast_model():
    return vali_env('VALI_FAST_MODEL', 'claude-haiku-5-5')


def make_fast_json(api_key):
    """A callable (system, user, schema) -> dict | None, or None when no key is configured."""
    if not api_key:
        return None
    import anthropic
    client = anthropic.Anthropic(api_key=api_key, timeout=20, max_retries=1)

    def ask(system, user, schema, max_tokens=4000):
        try:
            response = client.messages.create(
                model=fast_model(), max_tokens=max_tokens, system=system,
                messages=[{'role': 'user', 'content': user}],
                output_config={'effort': vali_env('VALI_FAST_EFFORT', 'medium'), 'format': {'type': 'json_schema', 'schema': schema}})
            text = next((b.text for b in response.content if b.type == 'text'), '')
            return json.loads(text) if text else None
        except Exception as exc:  # a side job never fails the errand
            logger.warning('fast llm call failed: %s %s', type(exc).__name__, str(exc)[:200])
            return None
    return ask
