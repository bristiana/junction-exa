"""Exa and Jev inside the loop, live view, consent, usage and mid-run messages."""
import json
import time
from types import SimpleNamespace as NS

import httpx

from hoida_agent import AgentHooks, run_browser_agent
from hoida_agent.browser import Browser
from hoida_agent.jev import Jev, final_submit_probability
from hoida_agent.live import Screencast, dismiss_cookie_banner, mark_private
from hoida_agent.web import ExaTools

PROFILE = {'name': 'Test Person', 'email': 'test@example.com', 'phone': '+358401234567'}


class Scripted:
    """Fake model: each call is (tool, args) or a function of the messages; reports token usage."""

    def __init__(self, calls):
        self.calls, self.turn, self.received = iter(calls), 0, []

    def next(self, system, tools, messages):
        self.received.append((system, [t['name'] for t in tools], json.dumps(messages, default=str)))
        call = next(self.calls)
        if callable(call):
            call = call(messages)
        self.turn += 1
        name, args = call
        return NS(content=[NS(type='tool_use', id=f't{self.turn}', name=name, input=args)], stop_reason='tool_use',
                  usage=NS(input_tokens=1000, output_tokens=50, cache_read_input_tokens=800, cache_creation_input_tokens=0))


def exa_fake(seen):
    def respond(request):
        body = json.loads(request.content)
        seen.append((request.url.path, body))
        if request.url.path == '/search':
            return httpx.Response(200, json={'costDollars': {'total': 0.007}, 'results': [
                {'title': 'EU261 compensation', 'url': 'https://eur-lex.europa.eu/eli/reg/2004/261', 'publishedDate': '2026-10-01T00:00:00Z',
                 'highlights': ['Flights over 3500 km: EUR 600']}]})
        return httpx.Response(200, json={'costDollars': {'total': 0.001}, 'results': [
            {'title': 'Claim form', 'url': body['urls'][0], 'text': 'Fill in the booking reference.', 'highlights': ['booking reference']}],
            'statuses': [{'id': body['urls'][0], 'status': 'success'}]})
    return ExaTools(api_key='fake', transport=httpx.MockTransport(respond))


def plain_hooks(**extra):
    return AgentHooks(lambda text, jpeg: extra.get('steps', []).append(text), lambda summary, filled: True, lambda: False,
                      **{k: v for k, v in extra.items() if k != 'steps'})


def test_exa_tools_sources_usage_and_messages(local_site):
    seen, steps, usage = [], [], []
    inbox = [['Use the email contact option please'], []]  # empty at start, the message arrives after step one
    exa = exa_fake(seen)

    def check_search(messages):
        result = messages[-1]['content'][0]
        assert 'EUR 600' in result['content'] and 'Untrusted web content' in result['content']
        # The user's message arrives in the same user turn as the tool result.
        assert any(b.get('type') == 'text' and 'email contact option' in b['text'] for b in messages[-1]['content'])
        return 'exa_read', {'url': 'https://example.com/claim', 'question': 'What does the form need?'}

    llm = Scripted([
        ('exa_search', {'query': 'EU261 compensation amount 3500 km', 'include_domains': None}),
        check_search,
        ('request_approval', {'summary': 'Claim EUR 600 for {{name}}', 'filled': [
            {'label': 'Amount', 'value': 'EUR 600', 'source': 'https://eur-lex.europa.eu/eli/reg/2004/261'},
            {'label': 'Name', 'value': '{{name}}', 'source': None}]}),
        ('finish', {'result': 'Prepared'}),
    ])
    approvals = []
    hooks = AgentHooks(lambda text, jpeg: steps.append(text), lambda summary, filled: approvals.append(filled) or True,
                       lambda: False, on_usage=usage.append, pending_messages=lambda: inbox.pop() if inbox else [])
    result = run_browser_agent('Claim', local_site + '/claim.html', PROFILE, hooks, llm, exa=exa, jev=Jev(api_key=''))
    assert result.status == 'done', result
    assert 'exa_search' in llm.received[0][1] and 'ask_user' not in llm.received[0][1]
    assert [p for p, _ in seen] == ['/search', '/contents']
    assert seen[0][1]['type'] == 'auto' and seen[0][1]['contents']['highlights']
    assert seen[1][1]['maxAgeHours'] == 6 and 'livecrawl' not in seen[1][1]
    assert approvals[0][0]['source'].startswith('https://eur-lex')
    assert result.filled == []  # this run filled nothing on the page
    assert {s['url'] for s in result.sources} == {'https://eur-lex.europa.eu/eli/reg/2004/261', 'https://example.com/claim'}
    assert result.usage['input_tokens'] == 4000 and result.usage['model_calls'] == 4 and result.usage['exa_cost_usd'] == 0.008
    assert usage[-1]['cache_read_input_tokens'] == 3200
    # 4 calls x (1000 in, 50 out, 800 cache read): (4000*4 + 200*20 + 3200*0.2) / 1e6
    assert result.usage['claude_cost_usd'] == 0.0206
    assert any(s.startswith('Searched the web with Exa') for s in steps)
    assert any(s.startswith('Message from you') for s in steps)
    for _, _, sent in llm.received:
        for value in PROFILE.values():
            assert value.casefold() not in sent.casefold()


def test_tools_hidden_without_keys(local_site):
    llm = Scripted([('finish', {'result': 'ok'})])
    run_browser_agent('x', local_site + '/claim.html', {}, plain_hooks(), llm, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert not {'exa_search', 'exa_read', 'ask_user'} & set(llm.received[0][1])


def test_ask_user_masks_answer(local_site):
    asked = []

    def check(messages):
        assert 'The user answered: {{name}} prefers 19:30' in messages[-1]['content'][0]['content']
        return 'finish', {'result': 'ok'}
    llm = Scripted([('ask_user', {'question': 'Which slot?'}), check])
    hooks = plain_hooks(ask_user=lambda q: asked.append(q) or 'Test Person prefers 19:30')
    result = run_browser_agent('x', local_site + '/claim.html', PROFILE, hooks, llm, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'done' and asked == ['Which slot?']
    assert 'ask_user' in llm.received[0][1]


def test_jev_makes_the_guard_stricter(local_site):
    def respond(request):
        body = json.loads(request.content)
        assert body['model'] and 'irreversible' in body['questions']['q']['instructions']
        return httpx.Response(200, json={'answers': {'q': {'noul': 0.9}}})
    jev = Jev(api_key='fake', transport=httpx.MockTransport(respond))

    def refused(messages):
        assert 'Call request_approval first' in messages[-1]['content'][0]['content']
        return 'finish', {'result': 'stopped before submit'}
    # "Discard changes" passes the regex guard, but Jev says it is irreversible, so it is gated.
    page = local_site + '/consent_fi.html'
    def click_discard(messages):
        first = messages[0]['content']  # the opening snapshot; read_page then reports "Page unchanged"
        return 'click', {'ref': next(line.split(']')[0][1:] for line in first.splitlines() if 'Hylkää muutokset' in line)}
    llm = Scripted([('read_page', {}), click_discard, refused])
    result = run_browser_agent('x', page, {}, plain_hooks(), llm, exa=ExaTools(api_key=''), jev=jev)
    assert result.status == 'done' and jev.calls == 1


def test_jev_choice_and_failures():
    def respond(request):
        q = json.loads(request.content)['questions']
        first = list(q['a']['criteria'])[0]
        return httpx.Response(200, json={'answers': {'a': {'probabilities': {first: 0.7, 'e2' if first == 'e1' else 'e1': 0.3}},
                                                     'b': {'probabilities': {'e2': 0.8, 'e1': 0.2}}}})
    jev = Jev(api_key='fake', transport=httpx.MockTransport(respond))
    assert jev.choose('state', 'Which button books 18:00?', {'e1': '17:00', 'e2': '18:00'}) == ('e2', 0.55)
    down = Jev(api_key='fake', transport=httpx.MockTransport(lambda r: httpx.Response(529)))
    assert down.yes('s', 'q') is None and down.calls == 2
    assert final_submit_probability(Jev(api_key=''), 'button', 'page') is None


def test_minimal_cookie_consent_in_finnish(local_site):
    browser = Browser()
    try:
        browser.goto(local_site + '/consent_fi.html')
        assert dismiss_cookie_banner(browser.page) == 'Vain välttämättömät'
        assert browser.page.locator('body').get_attribute('data-consent') == 'minimal'
        assert browser.page.locator('body').get_attribute('data-other') is None
        assert dismiss_cookie_banner(browser.page) is None
    finally:
        browser.close()


def test_private_values_blurred_and_screencast(local_site):
    browser = Browser()
    frames = []
    try:
        cast = Screencast(browser.page, frames.append, fps=10)
        browser.goto(local_site + '/claim.html')
        browser.page.locator('[name=name]').fill('Test Person')
        mark_private(browser.page, PROFILE)
        assert browser.page.locator('[name=name]').get_attribute('data-hoida-private') == '1'
        assert 'blur' in browser.page.locator('[name=name]').evaluate('e => getComputedStyle(e).filter')
        for _ in range(10):
            browser.page.mouse.wheel(0, 50)
            browser.page.wait_for_timeout(150)
        cast.close()
        assert frames and frames[0][:2] == b'\xff\xd8'
    finally:
        browser.close()


def test_forms_that_only_mention_identification_or_recaptcha_are_not_blocked(local_site):
    browser = Browser()
    try:
        browser.goto(local_site + '/form_mentions.html')
        assert browser.blockers() == []
    finally:
        browser.close()


import pytest
from hoida_agent.guard import is_final_submit


@pytest.mark.parametrize('label,final', [
    ('Jatka', False), ('Seuraava', False), ('Next', False), ('4 henkilöä', False), ('19:00', False), ('la 21.11.', False),
    ('21', False), ('Palaa vaiheeseen Seurueen koko', False), ('Lisää vaihtoehtoja', False),
    ('Vahvista varaus', True), ('Tee varaus', True), ('Varaa pöytä', True), ('Jatka maksamaan', True),
    ('Continue to payment', True), ('Lähetä', True), ('Book now', True), ('Something unclear', True),
])
def test_wizard_steps_pass_on_submit_buttons_but_final_steps_do_not(label, final):
    assert is_final_submit(f'<button type="submit">{label}</button> button type=submit {label}', label) is final


def test_filled_values_kept_for_handoff(local_site):
    llm = Scripted([('type_text', {'ref': 'e1', 'text': '{{name}}'}), ('select_option', {'ref': 'e4', 'option': 'Refund'}),
                    ('fail', {'reason': 'needs captcha: finish by hand'})])
    result = run_browser_agent('x', local_site + '/claim.html', PROFILE, plain_hooks(), llm, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'failed'
    assert result.filled == [{'label': 'Full name', 'value': '{{name}}'}, {'label': 'Claim type', 'value': 'Refund'}]


from hoida_agent.guard import is_navigation
from hoida_agent.live import _MINIMAL, _ACCEPT_ALL


def test_landing_page_links_are_not_final_but_paying_links_are():
    assert is_navigation('a', '/en/saunas/helsinki/booking', False, 'Book now')
    assert is_navigation('a', 'https://example.com/varaa', False, 'Varaa aika')
    assert not is_navigation('a', '/checkout/pay', False, 'Pay now')
    assert not is_navigation('a', '#', False, 'Book now')
    assert not is_navigation('button', '', True, 'Book now')
    assert not is_navigation('a', '/x', True, 'Book now')


@pytest.mark.parametrize('label,minimal', [
    ('Continue with only necessary cookies', True), ('Only necessary', True), ('Vain välttämättömät', True), ('Reject all', True),
    ('Hylkää kaikki', True), ('Accept all cookies', False), ('Hyväksy kaikki', False), ('Settings', False),
])
def test_minimal_consent_labels(label, minimal):
    assert (bool(_MINIMAL.search(label)) and not _ACCEPT_ALL.search(label)) is minimal


def test_hidden_radios_late_enabled_next_and_inert_elements(local_site):
    browser = Browser()
    try:
        browser.goto(local_site + '/hidden_inputs.html')
        snap = browser.snapshot()
        assert 'Hidden behind modal' not in snap.split('\nText: ')[0]
        ref = lambda text: next(l.split(']')[0][1:] for l in browser.snapshot().splitlines() if text in l)
        nxt = ref('"Next"')
        browser.click(ref('Flight experience'))
        assert browser.page.locator('#t2').is_checked()
        browser.check(ref('I agree'), True)
        assert browser.page.locator('[name=agree]').is_checked()
        browser.click(nxt)  # enabled 0.8 s after the choice
        assert browser.page.locator('body').get_attribute('data-next') == 'yes'
        browser.page.evaluate("document.querySelector('#next').disabled = true")
        with pytest.raises(ValueError, match='disabled'):
            browser.click(nxt)
    finally:
        browser.close()


def test_form_pages_skip_footer_links_and_long_menus(local_site):
    browser = Browser()
    try:
        browser.goto(local_site + '/form_with_footer.html')
        lines = browser.snapshot().split('\nText: ')[0]
        assert 'textarea' in lines and '"Send"' in lines and '"English"' in lines
        assert 'Footer link' not in lines and 'Menu link' not in lines
    finally:
        browser.close()


def test_follows_a_popup_window_and_keeps_streaming(local_site):
    frames, steps = [], []

    def in_popup(messages):
        snap = messages[-1]['content'][0]['content']
        assert 'Booking window' in snap and 'input[email]' in snap
        ref = next(l.split(']')[0][1:] for l in snap.splitlines() if 'input[email]' in l)
        return 'type_text', {'ref': ref, 'text': '{{email}}'}
    llm = Scripted([('click', {'ref': 'e1'}), in_popup, ('finish', {'result': 'ok'})])
    hooks = AgentHooks(lambda t, j: steps.append(t), lambda s, f: True, lambda: False, on_frame=frames.append)
    result = run_browser_agent('x', local_site + '/popup.html', PROFILE, hooks, llm, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'done', result
    assert result.final_url.endswith('/popup_child.html') and frames


def test_reading_does_not_use_up_actions_but_model_calls_are_capped(local_site):
    llm = Scripted([('read_page', {}), ('look', {}), ('read_page', {}), ('scroll', {'direction': 'down'}), ('finish', {'result': 'ok'})])
    result = run_browser_agent('x', local_site + '/claim.html', {}, plain_hooks(), llm, max_steps=1, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'done' and result.steps == 5
    llm = Scripted([('read_page', {})] * 10)
    result = run_browser_agent('x', local_site + '/claim.html', {}, plain_hooks(), llm, max_model_calls=3, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'failed' and 'limit' in result.result and llm.turn == 3


def test_payment_page_still_gets_the_approval_summary(local_site):
    approvals = []
    llm = Scripted([('request_approval', {'summary': 'Pay 208 EUR for the sauna', 'filled': []}), ('finish', {'result': 'handed over'})])
    hooks = AgentHooks(lambda t, j: None, lambda s, f: approvals.append(s) or False, lambda: False)
    browser_payment = local_site + '/payment.html'
    result = run_browser_agent('x', browser_payment, {}, hooks, llm, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert approvals == ['Pay 208 EUR for the sauna'] and result.status == 'stopped'
