"""Per-sentence claims, numbered sources and verbatim quotes."""
from vali_api.citations import cite, is_official, split_sentences, verbatim
from vali_api.exa import ExaError

DVV = 'https://dvv.fi/en/notification-of-move'
POSTI = 'https://www.posti.fi/en/moving'
BLOG = 'https://blog.example.com/moving'
PAGES = {
    DVV: 'Notification of move\n\nYou must submit the notification of move no later than one week after   moving. '
         'You can submit it online.',
    POSTI: 'Posti forwards your mail. Mail forwarding costs 10 euros per month.',
    BLOG: 'Moving is stressful.',
}


class FakeExa:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def contents(self, urls):
        self.calls.append(urls)
        if self.fail:
            raise ExaError(502, 'down')
        return {'results': [{'id': u, 'url': u, 'title': '', 'text': PAGES[u], 'publishedDate': '2025-01-02'} for u in urls],
                'costDollars': {'total': 0.003}}


def output(answer):
    return {'text': answer, 'structured': {'answer': answer}, 'grounding': [
        {'field': 'structured.steps[0]', 'citations': [{'url': BLOG, 'title': 'A blog'}]},
        {'field': 'structured.answer', 'citations': [{'url': DVV, 'title': 'DVV'}, {'url': POSTI, 'title': 'Posti'}]}]}


def test_sentences_split_on_ends_and_lines_but_not_abbreviations():
    text = 'Notify DVV within one week [1]. Fees are approx. 10 euros, e.g. for mail.\n- Posti forwards mail! Ok.'
    assert split_sentences(text) == ['Notify DVV within one week.', 'Fees are approx. 10 euros, e.g. for mail.',
                                     'Posti forwards mail! Ok.']


def test_official_domains():
    assert is_official('dvv.fi') and is_official('lomakkeet.dvv.fi') and is_official('europa.eu')
    assert is_official('usa.gov') and is_official('gov.uk')
    assert is_official('posti.fi', 'Use the Posti service') and not is_official('posti.fi', 'post office')
    assert is_official('helmiainen.fi', 'Hammaslääkäriasema Helmiäinen') and not is_official('example.com', 'x')


def test_verbatim_ignores_whitespace_only():
    page = 'You must   submit\nthe notification.'
    assert verbatim('You must submit the notification.', page)
    assert not verbatim('You must file the notification.', page) and not verbatim('must', page)


def test_llm_mapping_keeps_only_verbatim_quotes_and_numbers_by_first_use():
    seen = []
    def llm(system, user, schema):
        seen.append(user)
        return {'claims': [
            {'i': 0, 'verdict': 'yes', 'support': [{'page': 1, 'quote': 'Mail forwarding costs 10 euros per month.'}]},
            {'i': 1, 'verdict': 'yes', 'support': [
                {'page': 0, 'quote': 'You must submit the notification of move no later than one week after moving.'},
                {'page': 1, 'quote': 'Posti says you have a week.'}]},
            {'i': 2, 'verdict': 'no', 'support': []},
            {'i': 3, 'verdict': 'partly', 'support': [{'page': 0, 'quote': 'You can submit it online.'}]}]}
    result = output('Forwarding costs 10 € a month. Notify within one week. Moving is easy. Submit it online at night.')
    exa = FakeExa()
    assert cite(result, exa, llm, 'change of address') == 0.003
    assert exa.calls == [[DVV, POSTI, BLOG]]
    assert result['claims'] == [
        {'text': 'Forwarding costs 10 € a month.', 'sources': [1], 'supported': True},
        {'text': 'Notify within one week.', 'sources': [2, 1], 'supported': True},
        {'text': 'Moving is easy.', 'sources': [], 'supported': False},
        {'text': 'Submit it online at night.', 'sources': [2], 'supported': False}]
    posti, dvv, blog = result['sources']
    assert (posti['n'], posti['domain'], posti['quote'], posti['official']) == (1, 'posti.fi', 'Mail forwarding costs 10 euros per month.', False)
    assert dvv['quote'] == 'You must submit the notification of move no later than one week after moving.' and dvv['official']
    assert blog['n'] == 3 and 'quote' not in blog and blog['title'] == 'A blog'
    assert 'Moving is stressful.' in seen[0]
    assert result['structured']['answer'].startswith('Forwarding costs 10 €')


def test_lexical_fallback_without_llm():
    result = output('You must submit the notification of move within one week after moving.')
    cite(result, FakeExa())
    assert result['claims'][0]['sources'] == [1] and result['claims'][0]['supported'] is None  # overlap is not a judgement
    assert result['sources'][0]['quote'].startswith('You must submit the notification of move')


def test_failed_llm_falls_back_and_unreadable_pages_leave_support_unknown():
    result = output('You must submit the notification of move within one week after moving.')
    cite(result, FakeExa(), lambda *a: None)
    assert result['claims'][0]['supported'] is None and result['sources'][0]['quote']
    result = output('Notify within one week.')
    assert cite(result, FakeExa(fail=True), lambda *a: 1 / 0) == 0
    assert result['claims'] == [{'text': 'Notify within one week.', 'sources': [], 'supported': None}]
    assert [s['url'] for s in result['sources']] == [DVV, POSTI, BLOG] and all('quote' not in s for s in result['sources'])


def test_no_output_is_left_alone():
    assert cite(None, FakeExa()) == 0
    result = {'text': '', 'structured': {}, 'grounding': []}
    cite(result, FakeExa())
    assert result['claims'] == [] and result['sources'] == []


def test_freshness_from_published_date():
    from datetime import date
    from vali_api.citations import freshness
    today = date(2026, 11, 14)
    assert freshness('2025-06-01T00:00:00.000Z', today) == {'published': '2025-06-01', 'stale': False}
    assert freshness('2025-05-01', today) == {'published': '2025-05-01', 'stale': True}
    assert freshness(None, today) == {} and freshness('soon', today) == {}


def test_sources_carry_published_and_stale():
    result = output('You must submit the notification of move within one week after moving.')
    cite(result, FakeExa())
    assert result['sources'][0]['published'] == '2025-01-02' and result['sources'][0]['stale'] is True  # > 18 months before today


def test_unconfirmed_claims_are_softened_in_claims_and_answer():
    def llm(system, user, schema):
        return {'claims': [
            {'i': 0, 'verdict': 'yes', 'soft': '', 'support': [{'page': 1, 'quote': 'Mail forwarding costs 10 euros per month.'}]},
            {'i': 1, 'verdict': 'no', 'soft': 'Not confirmed by the sources: the clinic accepts new patients.', 'support': []},
            {'i': 2, 'verdict': 'partly', 'soft': 'You can submit it online.',
             'support': [{'page': 0, 'quote': 'You can submit it online.'}]}]}
    result = output('Forwarding costs 10 € a month. The clinic accepts new patients. Submit it online at night.')
    cite(result, FakeExa(), llm)
    claims = result['claims']
    assert claims[0] == {'text': 'Forwarding costs 10 € a month.', 'sources': [1], 'supported': True}
    assert claims[1]['text'].startswith('Not confirmed by the sources') and claims[1]['original'] == 'The clinic accepts new patients.'
    assert claims[2] == {'text': 'You can submit it online.', 'sources': [2], 'supported': False,
                         'original': 'Submit it online at night.'}
    assert result['structured']['answer'] == ('Forwarding costs 10 € a month. Not confirmed by the sources: the clinic '
                                              'accepts new patients. You can submit it online.')


def test_without_a_judgement_nothing_is_softened():
    result = output('The clinic accepts new patients.')
    cite(result, FakeExa())
    assert result['structured']['answer'] == 'The clinic accepts new patients.' and 'original' not in result['claims'][0]


def test_softening_keeps_assumptions_bullets_and_short_sentences():
    answer = 'Yes. Assuming you rent privately, the deposit is due back.\n- The clinic accepts new patients.\n- Call 09 123.'
    result = {'text': answer, 'structured': {'answer': answer},
              'grounding': [{'field': 'structured.answer', 'citations': [{'url': DVV}]}]}
    def llm(system, user, schema):
        i = int(user.split('[C', 1)[1].split(']', 1)[0])
        soft = {1: 'Not confirmed: rent.', 2: 'Not confirmed by the sources: the clinic accepts new patients.'}.get(i, '')
        return {'claims': [{'i': i, 'verdict': 'no', 'soft': soft, 'support': []}]}
    cite(result, FakeExa(), llm)
    assert result['structured']['answer'] == ('Yes. Assuming you rent privately, the deposit is due back.\n'
                                              '- Not confirmed by the sources: the clinic accepts new patients.\n- Call 09 123.')


def test_a_failed_claim_is_retried_then_falls_back_alone():
    calls = []
    def llm(system, user, schema):
        i = int(user.split('[C', 1)[1].split(']', 1)[0])
        calls.append(i)
        if i == 1:
            return None
        return {'claims': [{'i': i, 'verdict': 'yes', 'soft': '', 'support': [
            {'page': 0, 'quote': 'You must submit the notification of move no later than one week after moving.'}]}]}
    result = output('Notify within one week after moving. You must submit the notification of move within one week after moving.')
    cite(result, FakeExa(), llm)
    assert sorted(calls) == [0, 1, 1]
    assert result['claims'][0]['supported'] is True and result['claims'][1]['supported'] is None
