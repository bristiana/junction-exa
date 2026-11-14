"""Model interface and official SDK adapter."""
from vali_api.config import vali_env
import time
from typing import Any, Protocol
import anthropic


class LLM(Protocol):
    def next(self, system: str, tools: list[dict], messages: list[dict]) -> Any: ...


class ClaudeLLM:
    def __init__(self):
        self.client = anthropic.Anthropic()

    def next(self, system, tools, messages):
        kwargs = dict(model=vali_env('VALI_MODEL', 'claude-opus-5-5'),
                      max_tokens=16000, system=system, tools=tools, messages=messages,
                      output_config={'effort': vali_env('VALI_EFFORT', 'low')},
                      cache_control={'type': 'ephemeral'},
                      betas=['server-side-fallback-2026-07-01'], fallbacks='default')
        retries = 0
        while True:
            try:
                return self.client.beta.messages.create(**kwargs)
            except TypeError as exc:
                # Older SDK signatures can forward these API fields in the body.
                unsupported = [key for key in ('fallbacks', 'cache_control')
                               if key in str(exc) and key in kwargs]
                if not unsupported:
                    raise
                body = kwargs.setdefault('extra_body', {})
                for key in unsupported:
                    body[key] = kwargs.pop(key)
            except anthropic.RateLimitError:
                if retries >= 3:
                    raise
                time.sleep(2 ** retries)
                retries += 1
            except anthropic.APIStatusError as exc:
                if exc.status_code < 500 or retries >= 3:
                    raise
                time.sleep(2 ** retries)
                retries += 1
            except anthropic.APIConnectionError:
                if retries >= 3:
                    raise
                time.sleep(2 ** retries)
                retries += 1
