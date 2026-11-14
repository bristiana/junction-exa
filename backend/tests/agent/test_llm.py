from types import SimpleNamespace as NS
import anthropic
import httpx
import pytest
from vali_agent.llm import ClaudeLLM


def adapter(monkeypatch, create):
    monkeypatch.setattr(anthropic, 'Anthropic', lambda: NS(beta=NS(messages=NS(create=create))))
    monkeypatch.setattr('vali_agent.llm.time.sleep', lambda _:None)
    return ClaudeLLM()


def test_exact_api_arguments(monkeypatch):
    seen = []
    model = adapter(monkeypatch, lambda **kwargs: seen.append(kwargs) or 'response')
    for key in ('VALI_MODEL', 'VALI_EFFORT', 'HOIDA_MODEL', 'HOIDA_EFFORT'):
        monkeypatch.delenv(key, raising=False)
    assert model.next('system', [], []) == 'response'
    assert seen == [dict(model='claude-opus-5-5', max_tokens=16000, system='system', tools=[], messages=[],
                         output_config={'effort':'low'},cache_control={'type':'ephemeral'},
                         betas=['server-side-fallback-2026-07-01'],fallbacks='default')]


def test_sdk_keyword_fallback(monkeypatch):
    seen = []
    def create(**kwargs):
        for key in ('fallbacks','cache_control'):
            if key in kwargs:
                raise TypeError(f"unexpected keyword argument '{key}'")
        seen.append(kwargs)
        return 'response'
    assert adapter(monkeypatch, create).next('system', [], []) == 'response'
    assert seen[0]['extra_body'] == {'fallbacks':'default','cache_control':{'type':'ephemeral'}}


@pytest.mark.parametrize('status,retry', [(429,True),(503,True),(400,False)])
def test_status_retry(monkeypatch,status,retry):
    seen = []
    request = httpx.Request('POST','http://127.0.0.1/messages')
    response = httpx.Response(status,request=request)
    cls = anthropic.RateLimitError if status == 429 else anthropic.APIStatusError
    def create(**kwargs):
        seen.append(kwargs)
        raise cls('test error',response=response,body=None)
    with pytest.raises(cls):
        adapter(monkeypatch,create).next('system',[],[])
    assert len(seen) == (4 if retry else 1)


def test_connection_retry(monkeypatch):
    seen = []
    def create(**kwargs):
        seen.append(kwargs)
        raise anthropic.APIConnectionError(request=httpx.Request('POST','http://127.0.0.1/messages'))
    with pytest.raises(anthropic.APIConnectionError):
        adapter(monkeypatch,create).next('system',[],[])
    assert len(seen) == 4
