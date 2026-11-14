import copy
from types import SimpleNamespace as NS
import pytest
from vali_agent import AgentHooks, run_browser_agent
from vali_agent.browser import Browser
from vali_agent.guard import is_final_submit
from vali_agent.privacy import mask, substitute
from vali_agent.agent import TOOLS

PROFILE = {'name': 'Test Person', 'email': 'test@example.com', 'phone': '+358401234567'}


class ScriptedLLM:
    def __init__(self, calls):
        self.calls = iter(calls)
        self.received = []
        self.turn = 0

    def next(self, system, tools, messages):
        self.received.append(copy.deepcopy((system, tools, messages)))
        call = next(self.calls)
        if callable(call):
            call = call(messages)
        self.turn += 1
        name, args = call
        return NS(content=[NS(type='tool_use', id=f't{self.turn}', name=name, input=args)], stop_reason='tool_use')


def hooks(approved=True, stop=lambda: False):
    return AgentHooks(lambda text, jpeg: None, lambda summary, filled: approved, stop)


def test_claim_privacy_and_approval(local_site, monkeypatch):
    instances = []
    class InspectBrowser(Browser):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            instances.append(self)
        def close(self):
            self.values = self.page.locator('input,textarea').evaluate_all('(els)=>els.map(el=>el.value)')
            self.events = self.page.locator('body').get_attribute('data-input-event'), self.page.locator('body').get_attribute('data-change-event')
            self.checked = self.page.locator('[name=terms]').is_checked()
            self.radio = self.page.locator('[name=contact]:checked').input_value()
            super().close()
    monkeypatch.setattr('vali_agent.agent.Browser', InspectBrowser)
    calls = [
        ('type_text', {'ref': 'e1', 'text': '{{name}}'}),
        ('type_text', {'ref': 'e2', 'text': '{{email}}'}),
        ('type_text', {'ref': 'e3', 'text': '{{phone}}'}),
        ('select_option', {'ref': 'e4', 'option': 'Refund'}),
        ('set_checkbox', {'ref': 'e5', 'checked': True}),
        ('set_checkbox', {'ref': 'e7', 'checked': True}),
        ('type_text', {'ref': 'e8', 'text': 'Please process this claim'}),
        ('click', {'ref': 'e9'}),
    ]
    def approve(messages):
        assert messages[-1]['content'][0]['is_error']
        assert 'Call request_approval first' in messages[-1]['content'][0]['content']
        assert 'Reference FC-1234' not in messages[-1]['content'][0]['content']
        return 'request_approval', {'summary': 'Submit claim for {{name}}', 'filled': [{'label':'Email','value':'{{email}}'}]}
    calls += [approve, ('click', {'ref': 'e9'}), ('click', {'ref': 'e9'})]
    def finish(messages):
        assert messages[-1]['content'][0]['is_error']
        assert any('Reference FC-1234' in str(message['content']) for message in messages)
        return 'finish', {'result':'Claim submitted, reference FC-1234'}
    calls.append(finish)
    llm = ScriptedLLM(calls)
    result = run_browser_agent('Fill name, email and phone in the contact fields', local_site+'/claim.html', PROFILE, hooks(), llm)
    assert result.status == 'done', result
    assert 'FC-1234' in result.result
    assert all(value in instances[0].values for value in PROFILE.values())
    assert instances[0].events == ('yes','yes')
    assert instances[0].checked and instances[0].radio == 'email'
    for received in llm.received:
        for value in PROFILE.values():
            assert value.casefold() not in repr(received).casefold()


def test_login(local_site):
    def fail(messages):
        assert 'BLOCKER: needs login' in messages[0]['content']
        return 'fail', {'reason':'needs login: finish by hand at '+local_site+'/login.html'}
    result = run_browser_agent('Fill form',local_site+'/login.html',{},hooks(),ScriptedLLM([fail]))
    assert result.status == 'failed'
    assert result.final_url in result.result


def test_should_stop(local_site):
    result = run_browser_agent('Stop', local_site+'/claim.html',{},hooks(stop=lambda:True),ScriptedLLM([]))
    assert result.status == 'stopped' and result.steps == 0


def test_cookie_banner(local_site):
    result = run_browser_agent('Dismiss optional cookies',local_site+'/cookies.html',{},hooks(),ScriptedLLM([
        ('click', {'ref':'e1'}), ('finish', {'result':'Optional cookies rejected'})]))
    assert result.status == 'done'


@pytest.mark.parametrize('text', ['Submit claim','SEND','Pay now','Confirm booking','Book','Reserve','Place order','Complete','Finish','Lähetä','Maksa','Vahvista','Varaa','Tilaa','Jatka maksamaan'])
def test_final_submit(text):
    assert is_final_submit(text)


@pytest.mark.parametrize('text', ['Next page','Reject optional cookies','Full name','Select country', '<button type="submit">Continue</button>', '<input type=submit value=Continue>'])
def test_not_final_submit(text):
    assert not is_final_submit(text)


def test_privacy():
    assert substitute('{{name}} / {{email}}', PROFILE) == 'Test Person / test@example.com'
    assert mask('TEST PERSON test@example.com +358401234567', PROFILE) == '{{name}} {{email}} {{phone}}'
    with pytest.raises(ValueError):
        substitute('{{missing}}', PROFILE)


def test_public_fields_are_not_masked():
    profile = PROFILE | {'city': 'Helsinki', 'country': 'Finland'}
    assert mask('City of Helsinki, Finland: Test Person', profile) == 'City of Helsinki, Finland: {{name}}'
    assert substitute('{{city}}', profile) == 'Helsinki'


def test_strict_schemas():
    for tool in TOOLS:
        schema = tool['input_schema']
        assert tool['strict'] and schema['additionalProperties'] is False
        assert set(schema['properties']) == set(schema['required'])


def test_keyboard_submit_guard(local_site):
    browser = Browser()
    try:
        browser.goto(local_site+'/claim.html')
        browser.snapshot()
        browser.page.locator('[name=name]').focus()
        with pytest.raises(ValueError, match='request_approval'):
            browser.press('Enter')
    finally:
        browser.close()


def test_approval_denied(local_site):
    result = run_browser_agent('Claim',local_site+'/claim.html',PROFILE,hooks(approved=False),ScriptedLLM([
        ('request_approval', {'summary':'Submit for {{name}}','filled':[]}),
        ('finish', {'result':'Should never run'})]))
    assert result.status == 'stopped' and result.steps == 1


def test_stop_between_tools(local_site):
    stopped = []
    callbacks = AgentHooks(lambda text, jpeg: stopped.append(text), lambda summary, filled: True,
                           lambda: len(stopped) >= 2)
    result = run_browser_agent('Read',local_site+'/claim.html',{},callbacks,ScriptedLLM([
        ('read_page', {}), ('finish', {'result':'Must not run'})]))
    assert result.status == 'stopped' and result.steps == 1


def test_invalid_input_is_tool_error(local_site):
    def finish(messages):
        assert messages[-1]['content'][0]['is_error']
        assert 'missing or unknown keys' in messages[-1]['content'][0]['content']
        return 'finish', {'result':'Checked input validation'}
    result = run_browser_agent('Read',local_site+'/claim.html',{},hooks(),ScriptedLLM([
        ('type_text', {'ref':'e1'}), finish]))
    assert result.status == 'done'


def test_approval_invalidated_by_edit(local_site):
    def finish(messages):
        assert messages[-1]['content'][0]['is_error']
        assert 'Call request_approval first' in messages[-1]['content'][0]['content']
        return 'finish', {'result':'Prepared only'}
    result = run_browser_agent('Prepare',local_site+'/claim.html',PROFILE,hooks(),ScriptedLLM([
        ('request_approval', {'summary':'Submit claim','filled':[]}),
        ('type_text', {'ref':'e1','text':'{{name}}'}),
        ('click', {'ref':'e9'}), finish]))
    assert result.status == 'done'


def test_image_redaction(local_site, monkeypatch):
    browser = Browser()
    try:
        browser.goto(local_site+'/claim.html')
        browser.snapshot()
        browser.type('e1',PROFILE['name'])
        original = browser.page.screenshot
        seen = []
        def capture(**kwargs):
            seen.append(browser.page.locator('[name=name]').get_attribute('data-vali-private'))
            assert kwargs['mask']
            return original(**kwargs)
        monkeypatch.setattr(browser.page, 'screenshot', capture)
        jpeg = browser.screenshot_jpeg(profile=PROFILE)
        assert jpeg.startswith(b'\xff\xd8')
        assert seen == ['1']
        assert browser.page.locator('[name=name]').input_value() == PROFILE['name']
        assert browser.page.locator('[data-vali-private]').count() == 0
    finally:
        browser.close()


def test_final_picture_masks_every_field(local_site, monkeypatch):
    browser = Browser()
    try:
        browser.goto(local_site+'/claim.html')
        browser.snapshot()
        browser.type('e3', '+358 40 123 4567')  # the page's own format: no profile value matches it
        original = browser.page.screenshot
        seen = []
        def capture(**kwargs):
            seen.append(sorted(el.get_attribute('name') or '' for el in browser.page.locator('[data-vali-private]').all()))
            return original(**kwargs)
        monkeypatch.setattr(browser.page, 'screenshot', capture)
        assert browser.screenshot_jpeg(profile=PROFILE, all_fields=True).startswith(b'\xff\xd8')
        assert seen == [['details', 'email', 'kind', 'name', 'phone']]  # radios and the checkbox stay visible
        browser.page.set_content('<iframe srcdoc="<input name=x>"></iframe>')
        browser.page.wait_for_timeout(100)
        assert browser.screenshot_jpeg(profile=PROFILE, all_fields=True) is None
    finally:
        browser.close()


@pytest.mark.parametrize('markup,expected', [
    ('<div>Please solve the CAPTCHA</div>', 'captcha'),
    ('<input autocomplete="cc-number">', 'payment'),
    ('<iframe title="hcaptcha" src="about:blank"></iframe>', 'captcha'),
])
def test_additional_blockers(markup, expected):
    browser = Browser()
    try:
        browser.page.set_content(markup)
        assert expected in browser.blockers()
    finally:
        browser.close()
