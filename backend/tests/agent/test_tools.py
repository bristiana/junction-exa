"""Exa and Jev inside the loop, live view, consent, usage and mid-run messages."""
import json
import time
from types import SimpleNamespace as NS

import httpx

from vali_agent import AgentHooks, run_browser_agent
from vali_agent.browser import Browser
from vali_agent.jev import Jev, final_submit_probability
from vali_agent.live import Screencast, dismiss_cookie_banner, mark_private
from vali_agent.web import ExaTools

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


def test_exa_calls_are_recorded_masked_and_reported_live(local_site):
    seen, live = [], []
    exa = exa_fake(seen)
    def searched(messages):
        assert not messages[-1]['content'][0]['is_error']
        return 'exa_read', {'url': 'ftp://example.com/x', 'question': None}

    def private_read(messages):
        assert messages[-1]['content'][0]['is_error']
        return 'exa_read', {'url': 'https://example.com/claim?who=Test Person', 'question': 'Opening hours for Test Person?'}

    def finish(messages):
        assert not messages[-1]['content'][0]['is_error']
        return 'finish', {'result': 'ok'}

    llm = Scripted([
        ('exa_search', {'query': 'Kela office near Test Person {{city}}', 'include_domains': ['kela.fi']}),
        searched, private_read, finish,
    ])
    hooks = plain_hooks(on_exa=live.append)
    result = run_browser_agent('x', local_site + '/claim.html', PROFILE | {'city': 'Espoo'}, hooks, llm, exa=exa, jev=Jev(api_key=''))
    assert result.status == 'done'
    assert len(result.exa) == 3
    bad = result.exa[1]
    assert bad['kind'] == 'read' and bad['results'] == [] and 'http' in bad['error'] and bad['cost_usd'] == 0
    assert live[-1] == result.exa
    assert seen[0][1]['query'] == 'Kela office near {{name}} Espoo'
    assert seen[1][1]['urls'] == ['https://example.com/claim?who={{name}}']
    assert seen[1][1]['highlights']['query'] == 'Opening hours for {{name}}?'
    assert len(seen) == 2 and result.sources
    assert 'Test Person' not in json.dumps([result.exa, result.sources, seen])


def test_exa_log_masks_before_truncating_and_is_capped():
    exa = exa_fake([])
    exa.masker = lambda text: text.replace('Test Person', '{{name}}')
    exa.search('x' * 190 + ' Test Person')  # a cut at 200 would leave "Test Pe" behind if sliced first
    assert exa.calls[0]['query'] == 'x' * 190 + ' {{name}}'[:9]
    assert 'Test' not in exa.calls[0]['query']
    for _ in range(40):
        exa.search('q')
    assert len(exa.calls) == 30 and round(exa.cost_usd, 3) == 0.287  # all 41 calls ran and were billed


def test_system_prompt_sends_unknown_facts_to_exa(local_site):
    llm = Scripted([('finish', {'result': 'ok'})])
    run_browser_agent('x', local_site + '/claim.html', {}, plain_hooks(ask_user=lambda q: None), llm,
                      exa=exa_fake([]), jev=Jev(api_key=''))
    system = llm.received[0][0]
    assert 'postcode' in system and 'look it up with exa_search before filling it' in system
    assert 'Exa cannot find it, use ask_user' in system
    assert 'fail("missing: <the fact>")' in system


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
        assert browser.page.locator('[name=name]').get_attribute('data-vali-private') == '1'
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
from vali_agent.guard import is_final_submit


@pytest.mark.parametrize('label', [
    '4 henkilöä', '19:00', 'Palaa vaiheeseen Seurueen koko', 'Lisää vaihtoehtoja',
    'Vahvista varaus', 'Tee varaus', 'Varaa pöytä', 'Jatka maksamaan',
    'Continue to payment', 'Lähetä', 'Book now', 'Something unclear',
])
def test_explicit_submit_buttons_always_require_approval(label):
    assert is_final_submit(f'<button type="submit">{label}</button> button type=submit {label}', label)


def test_filled_values_kept_for_handoff(local_site):
    llm = Scripted([('type_text', {'ref': 'e1', 'text': '{{name}}'}), ('select_option', {'ref': 'e4', 'option': 'Refund'}),
                    ('fail', {'reason': 'needs captcha: finish by hand'})])
    result = run_browser_agent('Fill name', local_site + '/claim.html', PROFILE, plain_hooks(), llm, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'failed'
    assert result.filled == [{'label': 'Full name', 'value': '{{name}}'}, {'label': 'Claim type', 'value': 'Refund'}]


from vali_agent.live import _MINIMAL, _ACCEPT_ALL


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
    llm = Scripted([('request_approval', {'summary': 'Open booking window', 'filled': []}), ('click', {'ref': 'e1'}), in_popup, ('finish', {'result': 'ok'})])
    hooks = AgentHooks(lambda t, j: steps.append(t), lambda s, f: True, lambda: False, on_frame=frames.append)
    result = run_browser_agent('Fill email', local_site + '/popup.html', PROFILE, hooks, llm, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
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


def jev_picking(text):
    """Fake Jev that picks the option whose description contains `text`, in both orders."""
    seen = []

    def respond(request):
        q = json.loads(request.content)['questions']
        seen.append(q)
        if 'q' in q:  # guard second opinion: not irreversible
            return httpx.Response(200, json={'answers': {'q': {'noul': 0.05}}})
        pick = {k: (0.95 if text in v else 0.05 / max(1, len(q['a']['criteria']) - 1)) for k, v in q['a']['criteria'].items()}
        return httpx.Response(200, json={'answers': {'a': {'probabilities': pick}, 'b': {'probabilities': pick}}})
    return Jev(api_key='fake', transport=httpx.MockTransport(respond)), seen


def test_jev_finds_the_element_from_the_target(local_site):
    jev, seen = jev_picking('Accept terms')
    steps = []
    llm = Scripted([('click', {'ref': None, 'target': 'the accept terms checkbox'}), ('finish', {'result': 'ok'})])
    hooks = AgentHooks(lambda t, j: steps.append(t), lambda s, f: True, lambda: False)
    result = run_browser_agent('x', local_site + '/claim.html', PROFILE, hooks, llm, exa=ExaTools(api_key=''), jev=jev)
    assert result.status == 'done', result
    assert 'Clicked "Accept terms" (found by Jev)' in steps
    assert len(seen[0]['a']['criteria']) <= 25


def test_stale_ref_found_again_by_jev_still_hits_the_guard(local_site):
    jev, _ = jev_picking('Submit claim')

    def refused(messages):
        assert 'Call request_approval first' in messages[-1]['content'][0]['content']
        return 'finish', {'result': 'stopped'}
    llm = Scripted([('click', {'ref': 'e99', 'target': 'the submit button'}), refused])
    result = run_browser_agent('x', local_site + '/claim.html', PROFILE, plain_hooks(), llm, exa=ExaTools(api_key=''), jev=jev)
    assert result.status == 'done'


def test_without_jev_a_missing_ref_asks_to_read_the_page(local_site):
    def told(messages):
        assert 'call read_page' in messages[-1]['content'][0]['content']
        return 'finish', {'result': 'ok'}
    llm = Scripted([('click', {'ref': None, 'target': 'Submit claim'}), told])
    result = run_browser_agent('x', local_site + '/claim.html', PROFILE, plain_hooks(), llm, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'done'


def test_menu_toggles_skip_jev_and_filter_buttons_pass(local_site):
    jev = Jev(api_key='fake', transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json={'answers': {'q': {'noul': 0.95}}})))  # Jev would call everything final
    def opened(messages):
        assert not messages[-1]['content'][0]['is_error']
        return 'finish', {'result': 'menu opened'}
    llm = Scripted([('click', {'ref': 'e1', 'target': 'Paikat'}), opened])
    result = run_browser_agent('x', local_site + '/dropdown_toggle.html', {}, plain_hooks(), llm, exa=ExaTools(api_key=''), jev=jev)
    assert result.status == 'done' and jev.calls == 0
    assert is_final_submit('<button type="submit">Kaikki</button> button type=submit Kaikki', 'Kaikki')


def test_toggles_that_order_or_submit_are_still_gated(local_site):
    jev = Jev(api_key='fake', transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json={'answers': {'q': {'noul': 0.95}}})))
    def refused(messages):
        assert 'Call request_approval first' in messages[-1]['content'][0]['content']
        return 'click', {'ref': 'e4', 'target': 'Options'}  # a submit button inside a form is no toggle
    def refused_again(messages):
        assert 'Call request_approval first' in messages[-1]['content'][0]['content']
        return 'finish', {'result': 'gated'}
    llm = Scripted([('click', {'ref': 'e3', 'target': 'Place my order'}), refused, refused_again])
    result = run_browser_agent('x', local_site + '/dropdown_toggle.html', {}, plain_hooks(), llm, exa=ExaTools(api_key=''), jev=jev)
    assert result.status == 'done'
    assert is_final_submit('<button aria-haspopup="true">Place my order</button>', 'Place my order')


def test_autocomplete_suggestions_skip_only_the_default_submit_type(local_site):
    # palautteet.hel.fi: the address suggestions are typeless buttons in the form and were refused as final.
    jev = Jev(api_key='fake', transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json={'answers': {'q': {'noul': 0.1}}})))
    ref = lambda messages, text: next(line.split(']')[0][1:] for line in messages[0]['content'].splitlines()
                                      if line.startswith('[') and line.split(' ', 2)[2].startswith(f'"{text}'))
    def click(text, previous_refused=False):
        def step(messages):
            if len(messages) > 1:
                outcome = messages[-1]['content'][0]
                assert outcome['is_error'] == previous_refused and ('Call request_approval first' in outcome['content']) == previous_refused
            return 'click', {'ref': ref(messages, text), 'target': text}
        return step
    def approval(messages):
        assert 'Call request_approval first' in messages[-1]['content'][0]['content']  # "Submit order" as an option
        return 'request_approval', {'summary': 'Order', 'filled': []}
    def done(messages):
        assert not messages[-1]['content'][0]['is_error']
        return 'finish', {'result': 'ok'}
    steps = []
    llm = Scripted([click('Mannerheimintie 5'), click('Katajanokanlaituri 2a'), click('Aleksanterinkatu 1'), click('Lähetä'), click('Submit order', True),
                    approval, click('Submit order'), done])
    result = run_browser_agent('x', local_site + '/typeahead_form.html', {}, plain_hooks(steps=steps), llm,
                               exa=ExaTools(api_key=''), jev=jev)
    assert result.status == 'done' and jev.calls == 3  # the suggestions still get the Jev check
    assert [s for s in steps if s.startswith(('Clicked', 'Action refused'))] == [
        'Clicked "Mannerheimintie 5"', 'Clicked "Katajanokanlaituri 2a"', 'Clicked "Aleksanterinkatu 1, Helsinki"', 'Action refused: Call request_approval first',
        'Action refused: Call request_approval first', 'Clicked "Submit order"']


def test_maintenance_page_is_a_hand_off_with_the_outage(local_site):
    page = local_site + '/maintenance.html'
    def fail(messages):
        assert 'BLOCKER: needs unavailable:' in messages[0]['content']
        return 'fail', {'reason': 'The service is down for maintenance until Sat 14.11.2026 16:00. Try again after that.'}
    result = run_browser_agent('x', page, {}, plain_hooks(), Scripted([fail]), exa=ExaTools(api_key=''))
    assert result.status == 'failed'
    assert result.result == ('needs unavailable: The service is down for maintenance until Sat 14.11.2026 16:00. '
                             f'Try again after that; finish by hand later at {page}')
    # Any page action on it ends the run with the same kind of hand-off.
    result = run_browser_agent('x', page, {}, plain_hooks(), Scripted([('scroll', {'direction': 'down'})]), exa=ExaTools(api_key=''))
    assert result.result == f'needs unavailable: the site is down right now; finish by hand later at {page}'


def test_server_errors_are_unavailable_but_a_form_announcing_a_break_is_not(local_site):
    browser = Browser()
    try:
        browser.goto(local_site + '/maintenance_notice.html')
        assert browser.blockers() == []
        browser.page.route('**/down', lambda route: route.fulfill(status=503, body='<h1>Oops</h1>', content_type='text/html'))
        browser.goto(local_site + '/down')
        assert browser.blockers() == ['unavailable']
        browser.page.set_content('<p>Please solve the CAPTCHA</p>')  # a bot challenge served as a 503 stays a captcha
        assert browser.blockers() == ['captcha']
    finally:
        browser.close()


@pytest.mark.parametrize('label', ['Next', 'Continue', 'Jatka', 'Seuraava', 'Nästa', 'Fortsätt',
                                   'Search', 'Hae', 'Select', 'Valitse', '21', 'la 21.11.', 'Back', 'Edellinen'])
def test_wizard_next_and_jatka_are_not_final(label):
    assert not is_final_submit(f'<button class="book-now" type="submit">{label}</button>', label)


@pytest.mark.parametrize('label', ['Osta', 'Viimeistele', 'Ilmoittaudu', 'Köp', 'Beställ', 'Reservera',
                                   'Slutför', 'Register', 'Subscribe', 'Donate', 'Apply', 'Continue to payment'])
def test_final_action_words(label):
    assert is_final_submit(f'<button>{label}</button>', label)


def test_save_requires_submit_control_and_html_metadata_is_not_a_label():
    assert not is_final_submit('<button type="button">Tallenna</button>', 'Tallenna')
    assert is_final_submit('<button type="submit">Tallenna</button>', 'Tallenna')
    assert not is_final_submit('<a href="/order" class="book-now">Locations</a>', 'Locations')
    assert is_final_submit('<button aria-label="Confirm">Next</button>', 'Next')
    assert is_final_submit('<input type="button" value="Pay">', '')


@pytest.mark.parametrize('container', ['class="pac-container"', 'class="address-autocomplete"',
                                       'role="listbox"', 'role="option"'])
def test_common_autocomplete_buttons_are_suggestions(local_site, container):
    browser = Browser()
    try:
        browser.goto(local_site + '/claim.html')
        browser.page.set_content(f'<form><div {container}><button>Main Street 1</button></div></form>')
        browser.snapshot()
        button = next(ref for ref in browser._refs if browser._element(ref).evaluate("el => el.localName === 'button'"))
        assert not is_final_submit(browser.element_text(button))
        browser.click(button)
    finally:
        browser.close()


def test_checkbox_approval_reaches_browser_and_is_consumed(local_site):
    def verify(messages):
        assert not messages[-1]['content'][0]['is_error']
        return 'set_checkbox', {'ref': 'e1', 'checked': False}

    def refused(messages):
        assert 'Call request_approval first' in messages[-1]['content'][0]['content']
        return 'finish', {'result': 'ok'}

    class TermsBrowser(Browser):
        def goto(self, url):
            super().goto(url)
            self.page.set_content('<input type="checkbox" name="confirm-terms" aria-label="Confirm terms">')

    from unittest.mock import patch
    llm = Scripted([('set_checkbox', {'ref': 'e1', 'checked': True}),
                    ('request_approval', {'summary': 'Confirm terms', 'filled': []}),
                    ('set_checkbox', {'ref': 'e1', 'checked': True}), verify, refused])
    with patch('vali_agent.agent.Browser', TermsBrowser):
        result = run_browser_agent('Accept terms', local_site + '/claim.html', {}, plain_hooks(), llm,
                                   exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'done'
    assert result.filled == [{'label': 'Confirm terms', 'value': 'checked'}]


def test_booking_provider_navigation_and_personal_field_approval(local_site):
    provider = local_site.replace('127.0.0.1', 'localhost') + '/claim.html'
    steps = []

    def blocked(messages):
        assert 'outside the start site' in messages[-1]['content'][0]['content']
        return 'request_approval', {'summary': f'Type my email on {provider}',
                                    'filled': [{'label': 'Email', 'value': '{{email}}', 'source': None}]}

    def typed(messages):
        assert not messages[-1]['content'][0]['is_error']
        return 'type_text', {'ref': 'e2', 'text': '{{email}}'}

    def consumed(messages):
        assert 'outside the start site' in messages[-1]['content'][0]['content']
        return 'finish', {'result': 'ok'}

    llm = Scripted([('open_url', {'url': provider}),
                    ('type_text', {'ref': 'e2', 'text': '{{email}}'}), blocked,
                    ('type_text', {'ref': 'e2', 'text': '{{email}}'}), typed, consumed])
    result = run_browser_agent('Fill email', local_site + '/claim.html', PROFILE, plain_hooks(steps=steps), llm,
                               exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'done'
    assert result.filled == [{'label': 'Email', 'value': '{{email}}'}]
    assert 'Navigated to ' + provider in steps


def test_unnamed_details_need_the_users_yes(local_site):
    asked = []

    def typed(messages):
        assert 'did not allow' not in messages[-1]['content'][0]['content']
        return 'type_text', {'ref': 'e1', 'text': '{{email}}'}

    def done(messages):
        assert 'did not allow' not in messages[-1]['content'][0]['content']
        return 'finish', {'result': 'ok'}
    # The request names no detail: one yes covers the name and the email, asked once.
    llm = Scripted([('type_text', {'ref': 'e1', 'text': '{{first_name}}'}), typed, done])
    hooks = plain_hooks(ask_user=lambda q: asked.append(q) or 'Yes, go ahead')
    result = run_browser_agent('Book a sauna', local_site + '/claim.html', PROFILE, hooks, llm, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'done' and len(asked) == 1
    assert asked[0].startswith('May I use your saved name, email and phone on ')
    assert '{{email}}' in llm.received[0][0] and 'With the user' in llm.received[0][0]


def test_a_no_keeps_unnamed_details_refused(local_site):
    asked = []

    def refused(messages):
        assert 'did not allow their saved details' in messages[-1]['content'][0]['content']
        return 'type_text', {'ref': 'e1', 'text': '{{email}}'}

    def again(messages):
        assert 'did not allow their saved details' in messages[-1]['content'][0]['content']
        return 'finish', {'result': 'ok'}
    llm = Scripted([('type_text', {'ref': 'e1', 'text': '{{name}}'}), refused, again])
    hooks = plain_hooks(ask_user=lambda q: asked.append(q) or 'no thanks')
    result = run_browser_agent('Book a sauna', local_site + '/claim.html', PROFILE, hooks, llm, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'done' and len(asked) == 1


def test_without_ask_user_unnamed_details_stay_refused(local_site):
    def refused(messages):
        assert 'Missing profile placeholder: email' in messages[-1]['content'][0]['content']
        return 'finish', {'result': 'ok'}
    llm = Scripted([('type_text', {'ref': 'e1', 'text': '{{email}}'}), refused])
    result = run_browser_agent('Book a sauna', local_site + '/claim.html', PROFILE, plain_hooks(), llm, exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    assert result.status == 'done' and 'With the user' not in llm.received[0][0]
