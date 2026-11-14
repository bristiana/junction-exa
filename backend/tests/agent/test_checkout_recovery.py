"""Shop checkout regressions (Allas Sea Pool, 14 Nov 2026): a frame detached by a navigation, a guest
option labelled "I want to buy tickets", a password box beside it, and a contact form with a missing field."""
import copy
import json
import re
from types import SimpleNamespace as NS
from unittest.mock import Mock

import pytest
from playwright.sync_api import Error as PlaywrightError

from vali_agent import AgentHooks, run_browser_agent
from vali_agent.browser import Browser, is_navigation_error
from vali_agent.guard import is_final_submit, is_native_radio
from vali_agent.jev import Jev
from vali_agent.scope import permitted_profile, with_name_parts
from vali_agent.web import ExaTools

FAKE = {'full_name': 'Test Person', 'email': 'test@example.com'}
DETACHED = 'Frame.frame_element: Frame has been detached.'
GUEST = 'As a guest I want to buy tickets without logging in or registering.'


@pytest.fixture
def browser():
    instance = Browser()
    yield instance
    instance.close()


def ref(snapshot, label):
    return next(re.match(r'\[(e\d+)\]', line)[1] for line in snapshot.splitlines()
                if line.startswith('[e') and label in line)


# Frames that go away under the reader.

def test_navigation_errors_are_recognized():
    assert is_navigation_error(PlaywrightError(DETACHED))
    assert is_navigation_error(PlaywrightError('Execution context was destroyed, most likely because of a navigation'))
    assert not is_navigation_error(PlaywrightError('Element is not visible'))
    assert not is_navigation_error(PlaywrightError('Element is not visible\nCall log:\n  - waiting for scheduled navigations to finish'))
    assert not is_navigation_error(ValueError(DETACHED))


def _frame(captured=None, error=None, detached=False):
    frame = Mock()
    frame.is_detached.return_value = detached
    if error:
        frame.frame_element.side_effect = PlaywrightError(error)
    else:
        frame.frame_element.return_value.is_visible.return_value = True
    frame.evaluate.return_value = captured
    return frame


def _fake_browser(main, *children):
    browser = Browser.__new__(Browser)
    browser.page = NS(main_frame=main, frames=[main, *children], url='https://shop.example/address')
    browser._refs = {}
    browser._status = {}
    browser.recover = Mock()
    return browser


def test_snapshot_skips_a_child_frame_that_detached():
    main = _frame({'lines': ['[e1] input[text] "First name" value=""'], 'text': 'Customer details', 'title': 'Checkout'})
    gone = _frame(error=DETACHED)
    browser = _fake_browser(main, gone)
    snapshot = browser.snapshot()
    assert '[e1] input[text] "First name"' in snapshot and 'Title: Checkout' in snapshot
    gone.evaluate.assert_not_called()
    browser.recover.assert_not_called()
    assert browser.blockers() == []  # main.evaluate returns the same dict; no blocker kind in it


def test_snapshot_skips_a_child_frame_detaching_during_capture():
    main = _frame({'lines': [], 'text': 'Customer details', 'title': 'Checkout'})
    child = _frame()
    child.evaluate.side_effect = PlaywrightError('Frame.evaluate: Frame was detached')
    assert 'Customer details' in _fake_browser(main, child).snapshot()


def test_snapshot_rereads_when_the_main_frame_navigates():
    main = _frame()
    main.evaluate.side_effect = [PlaywrightError('Execution context was destroyed, most likely because of a navigation'),
                                 {'lines': ['[e1] button "Next" type=button'], 'text': 'Visit time', 'title': 'Address'}]
    browser = _fake_browser(main)
    assert '[e1] button "Next"' in browser.snapshot()
    browser.recover.assert_called_once()
    assert browser._refs == {'e1': main}


def test_other_errors_are_not_swallowed():
    main = _frame()
    main.evaluate.side_effect = PlaywrightError('Something else broke')
    browser = _fake_browser(main)
    with pytest.raises(PlaywrightError):
        browser.snapshot()
    browser.recover.assert_not_called()


def test_real_navigation_from_a_page_with_frames(browser, local_site):
    browser.goto(local_site + '/widget_frames.html')
    browser.snapshot()
    browser.page.evaluate("url => setTimeout(() => location.href = url, 0)", local_site + '/allas_address.html')
    browser.page.wait_for_url('**/allas_address.html')
    assert 'Customer details' in browser.snapshot()


def test_agent_reads_the_new_page_when_a_frame_detaches(local_site):
    """The production trace: Next navigates to the address page and the read after it raised "Frame has been detached"."""
    steps = []

    class Navigating(Browser):
        def click(self, ref, approved=False):
            super().click(ref, approved)
            if not getattr(self, 'tripped', False):
                self.tripped = True
                self.page.goto(self.page.url.rsplit('/', 1)[0] + '/widget_frames.html')
                raise PlaywrightError(DETACHED)

    def after(messages):
        result = messages[-1]['content'][0]
        assert not result['is_error']
        assert 'page changed while acting' in result['content'] and 'Host action' in result['content']
        return 'fail', {'reason': 'done checking'}

    from unittest.mock import patch
    llm = Scripted([lambda m: ('click', {'ref': ref(text_of(m), 'Returning customer'), 'target': 'Returning customer'}), after])
    with patch('vali_agent.agent.Browser', Navigating):
        run_browser_agent('Open the page', local_site + '/allas_address.html', {}, hooks(steps), llm,
                          exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert 'Page changed; read it again' in steps
    assert not any(s.startswith('Action refused') for s in steps)


# The guest choice and the login heuristic.

def test_native_radio_is_recognized_from_its_own_tag_only():
    assert is_native_radio(f'<input type="radio" name="contact_mode" value="guest"> {GUEST}')
    assert is_native_radio("<input TYPE='Radio' value=guest>")
    assert not is_native_radio('<input type="submit" value=" type=radio">')
    assert not is_native_radio('<button type="radio">Pay</button>')
    assert not is_native_radio('<label><input type="radio"> Pay now</label>')
    assert is_final_submit(f'<input type="radio" value="guest"> {GUEST}')  # the word guard alone would block it


def test_guest_radio_beside_a_password_box_is_not_a_login_wall(browser, local_site):
    for query in ('', '?hidden=1'):
        browser.goto(local_site + '/allas_address.html' + query)
        assert browser.blockers() == [], query
    # Without a guest path the same page is a real wall.
    browser.goto(local_site + '/allas_address.html')
    browser.page.evaluate("() => document.querySelector('[value=guest]').closest('label').remove()")
    assert browser.blockers() == ['login']


def test_guest_radio_is_picked_without_approval_but_payment_still_needs_it(browser, local_site):
    browser.goto(local_site + '/allas_address.html')
    snapshot = browser.snapshot()
    browser.click(ref(snapshot, 'As a guest'))
    assert browser.page.locator('[value=guest]').is_checked()
    browser.check(ref(snapshot, 'Returning customer'), True)
    browser.check(ref(browser.snapshot(), 'As a guest'), True)
    assert browser.page.locator('[value=guest]').is_checked()
    snapshot = browser.snapshot()
    assert 'First name' in snapshot and 'Password' not in snapshot
    with pytest.raises(ValueError, match='request_approval'):
        browser.click(ref(snapshot, 'Continue to payment method'))
    assert browser.page.locator('body').get_attribute('data-submitted') is None
    assert browser.missing_required() == ['First name', 'Last name', 'Email', 'Phone']


def test_terms_checkbox_stays_guarded(browser, local_site):
    browser.goto(local_site + '/allas_address.html')
    browser.page.set_content('<label><input type="checkbox" required> I confirm the booking</label>')
    with pytest.raises(ValueError, match='request_approval'):
        browser.check(ref(browser.snapshot(), 'I confirm the booking'), True)


# The whole step, as the production run should have gone.

class Scripted:
    def __init__(self, calls):
        self.calls, self.turn, self.received = iter(calls), 0, []

    def next(self, system, tools, messages):
        self.received.append(copy.deepcopy((system, messages)))
        call = next(self.calls)
        if callable(call):
            call = call(messages)
        self.turn += 1
        name, args = call
        return NS(content=[NS(type='tool_use', id=f't{self.turn}', name=name, input=args)], stop_reason='tool_use')


def hooks(steps, approvals=None):
    def approve(summary, filled):
        if approvals is not None:
            approvals.append((summary, filled))
        return False  # never approve: nothing is submitted
    return AgentHooks(lambda text, jpeg: steps.append(text), approve, lambda: False)


def text_of(messages):
    content = messages[-1]['content']
    if isinstance(content, str):
        return content
    return '\n'.join(part.get('content') or part.get('text') or '' for part in content if isinstance(part, dict))


def test_guest_checkout_with_a_missing_field_ends_in_approval(local_site):
    steps, approvals, browsers = [], [], []

    class Recorded(Browser):
        def close(self):
            browsers.append({'values': self.page.locator('#guest input').evaluate_all('els => els.map(e => e.value)'),
                             'submitted': self.page.locator('body').get_attribute('data-submitted')})
            super().close()

    def pushed_back(messages):
        result = messages[-1]['content'][0]
        assert result['is_error'] and 'not a login wall' in result['content']
        assert 'Page unchanged' in result['content']
        return 'click', {'ref': ref(text_of(messages[:1]), 'As a guest'), 'target': 'As a guest'}

    def fill(label, text):
        def call(messages):
            assert not messages[-1]['content'][0]['is_error'], messages[-1]['content'][0]['content']
            return 'type_text', {'ref': ref(text_of(messages), f'"{label}"'), 'text': text}
        return call

    def submit(messages):
        return 'click', {'ref': ref(text_of(messages), 'Continue to payment method'), 'target': 'Continue'}

    def approval(messages):
        assert 'Call request_approval first' in messages[-1]['content'][0]['content']
        return 'request_approval', {'summary': '2 tickets Sat 21 Nov 18:00, guest checkout. Missing: Phone',
                                    'filled': [{'label': 'First name', 'value': '{{first_name}}', 'source': None},
                                               {'label': 'Last name', 'value': '{{last_name}}', 'source': None},
                                               {'label': 'Email', 'value': '{{email}}', 'source': None}]}

    llm = Scripted([('fail', {'reason': 'needs login: finish by hand at ' + local_site + '/allas_address.html'}),
                    pushed_back, fill('First name', '{{first_name}}'), fill('Last name', '{{last_name}}'),
                    fill('Email', '{{email}}'), submit, approval])
    from unittest.mock import patch
    with patch('vali_agent.agent.Browser', Recorded):
        result = run_browser_agent('Book 2 Allas tickets; check out as a guest with my {{name}} and {{email}}',
                                   local_site + '/allas_address.html', FAKE, hooks(steps, approvals), llm,
                                   exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'stopped', (result, steps)
    assert browsers[0] == {'values': ['Test', 'Person', 'test@example.com', ''], 'submitted': None}
    summary, filled = approvals[0]
    assert summary.endswith('Still empty (required): Phone.')
    assert [f['value'] for f in filled] == ['{{first_name}}', '{{last_name}}', '{{email}}']
    system = llm.received[0][0]
    assert 'not a login wall' in system and 'Missing: Phone' in system
    assert '{{first_name}}' in system and '{{last_name}}' in system
    for received in llm.received:
        for value in ('Test Person', 'test@example.com', 'Person'):
            assert value not in json.dumps(received[1], default=str)


def test_a_second_needs_login_is_accepted(local_site):
    llm = Scripted([('fail', {'reason': 'needs login: finish by hand'}), ('fail', {'reason': 'needs login: finish by hand'})])
    result = run_browser_agent('Book tickets', local_site + '/allas_address.html', {}, hooks([]), llm,
                               exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'failed' and result.result.startswith('needs login')


def test_a_real_login_wall_fails_at_once(local_site):
    llm = Scripted([('fail', {'reason': 'needs login: finish by hand'})])
    result = run_browser_agent('Book tickets', local_site + '/login.html', {}, hooks([]), llm,
                               exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'failed' and result.result == 'needs login: finish by hand at ' + local_site + '/login.html'


# The name, whole or split.

@pytest.mark.parametrize('profile,expected', [
    ({'full_name': 'Test Person'}, {'name': 'Test Person', 'first_name': 'Test', 'last_name': 'Person'}),
    ({'name': 'Anna Maria Virtanen'}, {'first_name': 'Anna Maria', 'last_name': 'Virtanen'}),
    ({'first_name': 'Aino', 'last_name': 'Virtanen'}, {'name': 'Aino Virtanen'}),
    ({'name': 'Test Person', 'first_name': 'Own'}, {'first_name': 'Own', 'last_name': 'Person'}),
])
def test_name_parts(profile, expected):
    assert with_name_parts(profile).items() >= expected.items()


def test_single_word_name_is_not_split():
    assert 'last_name' not in with_name_parts({'name': 'Madonna'})


def test_name_scope_is_still_the_goal():
    profile = with_name_parts(FAKE)
    assert permitted_profile('Buy two tickets', profile) == {}
    assert set(permitted_profile('Check out with my {{name}}', profile)) == {'name', 'full_name', 'first_name', 'last_name'}
    assert set(permitted_profile('Send it to {{email}}', profile)) == {'email'}
