"""No network: scripted model, fake browser, fake screencast."""
import base64
import copy
import threading
from types import SimpleNamespace as NS
from unittest.mock import Mock
import pytest
from vali_agent.agent import run_browser_agent
from vali_agent.hooks import AgentHooks
from vali_agent.jev import Jev
from vali_agent.live import Screencast
from vali_agent.web import ExaTools


class Script:
    def __init__(self, calls):
        self.calls = iter(calls)
        self.received = []

    def next(self, system, tools, messages):
        self.received.append(copy.deepcopy((system, messages)))
        name, args = next(self.calls)
        return NS(content=[NS(type='tool_use', id=str(len(self.received)), name=name, input=args)], stop_reason='tool_use')


@pytest.mark.parametrize('fill_fails', [False, True])
def test_capture_stops_before_personal_substitution(monkeypatch, fill_fails):
    events = []
    class Browser:
        current_url = 'https://example.com'
        page = NS(frames=[])
        def __init__(self, **kwargs): pass
        def goto(self, url): pass
        def snapshot(self): return '[e1] input[email] "Email"'
        def blockers(self): return []
        def personal_field(self, ref): pass
        def screenshot_jpeg(self, **kwargs):
            events.append('screenshot')
            assert 'fill' not in events
            return b'jpeg'
        def type(self, ref, text):
            assert events[-1] == 'closed'
            assert text == 'secret@example.com'
            events.append('fill')
            if fill_fails:
                raise ValueError('Failed after inserting value')
        def close(self): pass
    class Cast:
        def __init__(self, page, on_frame): self.page = page
        def push(self, jpeg): pass
        def close(self): events.append('closed')
    monkeypatch.setattr('vali_agent.agent.Browser', Browser)
    monkeypatch.setattr('vali_agent.agent.Screencast', Cast)
    model = Script([('type_text', {'ref': 'e1', 'text': '{{email}}'}),
                    ('look', {}), ('finish', {'result': 'Prepared'})])
    frames = []
    hooks = AgentHooks(lambda text, jpeg: frames.append(jpeg), lambda *args: True, lambda: False,
                       on_frame=lambda jpeg: None)
    result = run_browser_agent('Fill email', 'https://example.com', {'email': 'secret@example.com'},
                               hooks, model, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'done'
    assert events == ['screenshot', 'closed', 'fill']
    assert frames[0] == b'jpeg' and all(frame is None for frame in frames[1:])
    assert 'Images paused' in str(model.received[-1])
    assert 'secret@example.com' not in str(model.received)


def test_closed_screencast_rejects_late_frames_and_manual_push():
    cast = Screencast.__new__(Screencast)
    cast.cdp = Mock()
    cast._closed = True
    cast._lock = threading.Lock()
    cast._latest = None
    cast._wake = threading.Event()
    cast._frame({'sessionId': 1, 'data': base64.b64encode(b'private').decode()})
    cast.push(b'private')
    assert cast._latest is None
    assert not cast._wake.is_set()
