"""Regressions from the live tester: answer language, how an answer opens, quote support, find prices, channels."""
import pytest

from vali_api.citations import (FETCH_CHARS, MAP_SCHEMA, MAP_SYSTEM, PAGE_CHARS, _facts, cite, excerpt, opener, own,
                                 split_sentences, unmark, verbatim)
from vali_api.exa import ExaClient
from vali_api.lang import detect
from vali_api.research import FIND_RULES, build_query, map_find_output, priced_answer
from vali_api.stats import channel_of_origin

KELA = 'https://www.kela.fi/opintotuki'
VERO = 'https://www.vero.fi/en/individuals/tax-cards-and-tax-returns/'


class FakeExa:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def contents(self, urls):
        self.calls.append(urls)
        return {'results': [{'id': u, 'url': u, 'title': 'Page', 'text': self.pages[u]} for u in urls], 'costDollars': {'total': 0}}


def output(answer, *urls):
    return {'text': answer, 'structured': {'answer': answer},
            'grounding': [{'field': 'structured.answer', 'citations': [{'url': u} for u in urls]}]}


def verdicts(table):
    """A fake judge: claim index -> (verdict, soft, quote)."""
    seen = []
    def llm(system, user, schema):
        seen.append(system + '\n' + user)
        i = int(user.split('[C', 1)[1].split(']', 1)[0])
        verdict, soft, quote = table[i]
        return {'claims': [{'i': i, 'verdict': verdict, 'soft': soft, 'support': [{'page': 0, 'quote': quote}] if quote else []}]}
    llm.seen = seen
    return llm


# 1. Language

@pytest.mark.parametrize('text,code', [
    ('hoe schrijf ik me in in Utrecht na verhuizing', 'nl'),
    ('hoe schrijf ik me in in Rotterdam na verhuizing', 'nl'),
    ('Wat kost een treinkaartje naar Rovaniemi', 'nl'),
    ('sähkösopimus vertailu', 'fi'),
    ('halvin sähkösopimus', 'fi'),
    ('opintotuki tulorajat 2026', 'fi'),
    ('Quanto costa il treno da Helsinki a Rovaniemi?', 'it'),
    ('як отримати картку Kela', 'uk'),
    ('где купить проездной', 'ru'),
    ('Hur ansöker jag om personnummer', 'sv'),
    ('Wo melde ich mich in Berlin an', 'de'),
    ('find a cheap gym in Helsinki', 'en'),
    ('I need a dentist in Espoo', 'en')])
def test_short_and_shared_word_errands_get_their_language(text, code):
    assert detect(text) == code


def test_find_and_check_queries_ask_for_the_errand_language():
    assert 'Answer in: Dutch.' in build_query('hoe schrijf ik me in in Utrecht na verhuizing')
    assert 'Answer in: Finnish.' in build_query('sähkösopimus vertailu')
    assert 'Answer in: Italian.' in build_query('Quanto costa il treno da Helsinki a Rovaniemi?')


# 2. and 3. How the answer opens

def test_an_unconfirmed_claim_never_opens_the_answer():
    page = {KELA: 'Opintoraha on 280 euroa kuukaudessa.'}
    result = output('The aid ends in May. Opintoraha on 280 euroa kuukaudessa. It is paid monthly.', KELA)
    cite(result, FakeExa(page), verdicts({
        0: ('no', 'Not confirmed by the sources: the aid ends in May.', ''),
        1: ('yes', '', 'Opintoraha on 280 euroa kuukaudessa.'),
        2: ('no', 'Not confirmed by the sources: it is paid monthly.', '')}))
    assert result['structured']['answer'].startswith('Opintoraha on 280 euroa kuukaudessa. Not confirmed')
    assert [c['supported'] for c in result['claims']] == [True, False, False]


def test_with_no_confirmed_claim_a_plain_sentence_on_the_sources_opens():
    page = {KELA: 'Opintotuki is student financial aid.', VERO: 'Tax cards.'}
    result = output('The aid ends in May.', KELA, VERO)
    judge = verdicts({0: ('no', 'Not confirmed by the sources: the aid ends in May.', '')})
    cite(result, FakeExa(page), judge, 'opintotuki tulorajat')
    lead = 'En voinut vahvistaa tätä lukemistani sivuista. Tarkista kela.fi ja vero.fi.'  # the errand's language
    assert result['structured']['answer'] == lead + '\nNot confirmed by the sources: the aid ends in May.'
    assert result['lead'] == lead and all(own(s, result) for s in split_sentences(lead))  # Vali's own line, not a claim
    assert [c['text'] for c in result['claims']] == ['Not confirmed by the sources: the aid ends in May.']
    assert all('[C' in u for u in judge.seen)  # no model writes the opener


@pytest.mark.parametrize('errand,lead', [
    ('how much is student aid', 'I could not confirm this on the pages I read. Check kela.fi.'),
    ('nasıl başvururum için', 'I could not confirm this on the pages I read. Check kela.fi.'),  # no template: English
    ('Wo melde ich mich in Berlin an', 'Ich konnte das auf den gelesenen Seiten nicht bestätigen. Prüfe kela.fi.')])
def test_the_opener_is_a_fixed_sentence_in_the_errand_language(errand, lead):
    result = output('The aid ends in May.', KELA)
    def judge(system, user, schema):
        assert '[C' in user, 'the opener never asks a model'
        return {'claims': [{'i': 0, 'verdict': 'no', 'soft': '', 'support': []}]}
    cite(result, FakeExa({KELA: 'Opintotuki.'}), judge, errand)
    assert result['lead'] == lead


def test_every_opener_names_the_sites_and_has_no_em_dash():
    for code in ('en', 'fi', 'sv', 'ro', 'de', 'es', 'fr', 'ru', 'uk', 'nl', 'da', 'it', 'ar'):
        sentence = opener(code, [{'domain': 'kela.fi'}, {'domain': 'vero.fi'}, {'domain': 'kela.fi'}])
        assert 'kela.fi' in sentence and 'vero.fi' in sentence and sentence.count('kela.fi') == 1 and '—' not in sentence


def test_markdown_and_stray_asterisks_never_lead():
    assert unmark('**Tulot:** *Jos tulot ylittävät rajan, tuki pienenee.*\n* bullet one\n# Heading') == (
        'Tulot: Jos tulot ylittävät rajan, tuki pienenee.\n- bullet one\nHeading')
    assert unmark('Rent is [due monthly](https://kkv.fi/x). Fill {{postal_code}}.') == 'Rent is due monthly. Fill {{postal_code}}.'


def test_a_softened_fragment_from_an_italic_line_does_not_open_the_answer():
    page = {KELA: 'Opintoraha on 280 euroa kuukaudessa.'}
    answer = '*Opintotuki pienenee, jos tulot ylittävät tämän rajan.*\nOpintoraha on 280 euroa kuukaudessa.'
    result = output(answer, KELA)
    cite(result, FakeExa(page), verdicts({
        0: ('partly', '*Jos tulot ylittävät tämän', ''),
        1: ('yes', '', 'Opintoraha on 280 euroa kuukaudessa.')}))
    first = result['structured']['answer']
    assert first == 'Opintoraha on 280 euroa kuukaudessa. Jos tulot ylittävät tämän'  # moved behind, once, no *
    assert result['claims'][0]['supported'] is True


def test_a_lowercase_opening_is_capitalised():
    result = output('a rent increase needs a clause in the lease.', KELA)
    cite(result, FakeExa({KELA: 'A rent increase needs a clause in the lease.'}),
         verdicts({0: ('yes', '', 'A rent increase needs a clause in the lease.')}))
    assert result['structured']['answer'] == 'A rent increase needs a clause in the lease.'
    assert result['claims'][0]['text'] == 'A rent increase needs a clause in the lease.'


# 4. Support decisions

def test_verbatim_ignores_markdown_typography_and_no_break_spaces():
    page = 'The **pre-completed** tax return is due on 1 April 2026 – check it in [MyTax](https://vero.fi).'
    assert verbatim('The pre-completed tax return is due on 1 April 2026 - check it in MyTax.', page)
    assert not verbatim('The pre-completed tax return is due on 14 April 2026', page)


def test_dates_and_numbers_meet_across_formats():
    assert _facts('Due 1.4.2026') & _facts('due on 1 April 2026') >= {'1-4', '2026'}
    assert '1-4' in _facts('1. huhtikuuta 2026') and '1-4' in _facts('April 1, 2026') and '1-4' in _facts('2026-04-01')
    assert '1500' in _facts('1 500 €') and '1500' in _facts('€1,500') and '9.89' in _facts('9,89 snt/kWh')


def test_a_date_deep_in_a_long_page_reaches_the_judge():
    filler = '\n'.join(f'Section {n}. General information about taxation in Finland for everyone.' for n in range(120))
    long_page = 'Tax return\n' + filler + '\nThe last day to check your return is 1 April 2026.\n' + filler
    assert len(long_page) > 8000 and FETCH_CHARS > len(long_page)
    shown = excerpt(long_page, 'Check your tax return by 1.4.2026.')
    assert 'The last day to check your return is 1 April 2026.' in shown and len(shown) <= PAGE_CHARS + 200
    result = output('Check your tax return by 1.4.2026.', VERO)
    judge = verdicts({0: ('yes', '', 'The last day to check your return is 1 April 2026.')})
    cite(result, FakeExa({VERO: long_page}), judge)
    assert '1 April 2026' in judge.seen[0] and result['claims'][0]['supported'] is True


def test_the_judge_is_told_formats_and_languages_may_differ():
    assert '1.4.2026 = 1 April 2026' in MAP_SYSTEM and 'another language' in MAP_SYSTEM


def test_page_text_is_read_long_enough():
    import httpx
    bodies = []
    def respond(request):
        bodies.append(request.content)
        return httpx.Response(200, json={'results': []})
    ExaClient('k', transport=httpx.MockTransport(respond)).contents(['https://vero.fi'])
    assert b'"maxCharacters":30000' in bodies[0].replace(b' ', b'')


# 5. Find answers carry a figure

def test_a_find_answer_without_a_figure_gets_the_priced_options():
    options = [{'name': 'VR seat', 'price': 'from 22.90 €', 'detail': '', 'url': 'https://vr.fi'},
               {'name': 'Sleeper', 'price': 'varies', 'detail': '', 'url': 'https://vr.fi/s'},
               {'name': 'Cabin', 'price': 'from 59 €.', 'detail': '', 'url': 'https://vr.fi/c'}]
    assert priced_answer('Prices vary by date.', options) == 'Prices vary by date. VR seat: from 22.90 €. Cabin: from 59 €.'
    assert priced_answer('A seat costs 22.90 €.', options) == 'A seat costs 22.90 €.'
    assert priced_answer('Prices vary.', [{'name': 'X', 'price': 'varies'}]) == 'Prices vary.'
    mapped = map_find_output({'output': {'content': {'answer': 'Prices vary.', 'options': options[:1], 'next_step': ''}}})
    assert mapped['structured']['answer'] == mapped['text'] == 'Prices vary. VR seat: from 22.90 €.'
    assert 'lowest price' in FIND_RULES


# 6. Channels

def test_channel_from_origin():
    assert channel_of_origin('chrome-extension://abcdef') == 'extension'
    assert channel_of_origin('https://vali.example') == 'web'
    assert channel_of_origin(None) == 'api'


# 7. Vali's own actions are not claims

EMAIL_DRAFT = {'type': 'email', 'label': 'Send email', 'body': 'Hello, please return my deposit. {{name}}'}


def test_own_actions_skip_the_support_check():
    drafted = {'structured': {'actions': [EMAIL_DRAFT]}}
    assert own('I prepared a short email requesting payment.', drafted) and own('Here is a draft email to your landlord.', drafted)
    assert not own('I prezzi variano.', drafted) and not own('In Finland rent rises yearly.', drafted)
    page = {KELA: 'The landlord must return the deposit.'}
    result = output('The landlord must return the deposit. I prepared a short email requesting payment.', KELA)
    result['structured']['actions'] = [EMAIL_DRAFT]
    judge = verdicts({0: ('yes', '', 'The landlord must return the deposit.'), 1: ('no', 'Not confirmed by the sources: x', '')})
    cite(result, FakeExa(page), judge)
    assert result['claims'][1] == {'text': 'I prepared a short email requesting payment.', 'sources': [], 'supported': None,
                                   'own': True}
    assert len(judge.seen) == 1 and 'Not confirmed' not in result['structured']['answer']


@pytest.mark.parametrize('sentence', [
    'I can confirm that every student receives 500 euros monthly.',
    'I can confirm that every student receives a monthly grant.',
    'I will check that the deposit comes back.',
    'I prepared an email asking for the 900 € deposit.',
    'I prepared an email asking for the deposit by 1 May.',
    'I wrote a letter to Kela in May.'])
def test_a_factual_sentence_is_never_own(sentence):
    assert not own(sentence, {'structured': {'actions': [EMAIL_DRAFT]}})


def test_a_draft_report_needs_a_real_draft():
    assert not own('I prepared a short email requesting payment.')
    assert not own('I prepared a short email requesting payment.', {'structured': {'actions': [
        {'type': 'open_link', 'label': 'Open', 'url': 'https://kela.fi'}, {'type': 'email', 'label': 'Send', 'body': ''}]}})
    assert own('I prepared a short message to paste.', {'structured': {'actions': [
        {'type': 'copy_text', 'label': 'Copy', 'body': 'Hei, olen muuttanut.'}]}})
    assert own('Laadin sinulle lyhyen sähköpostin.', {'structured': {'actions': [EMAIL_DRAFT]}})


def test_a_self_verdict_counts_as_unconfirmed():
    assert '"self"' not in MAP_SYSTEM and 'self' not in MAP_SCHEMA['properties']['claims']['items']['properties']['verdict']['enum']
    result = output('I can confirm that every student receives 500 euros monthly.', KELA)
    cite(result, FakeExa({KELA: 'Opintotuki is student financial aid.'}), verdicts({0: ('self', '', '')}))
    assert result['claims'][0]['supported'] is False and not result['claims'][0].get('own')


def test_a_short_table_row_quote_still_counts():
    assert verbatim('| 12 | 13 416 |', 'Tukikuukaudet | Tuloraja\n| 12 | 13 416 |\n| 9 | 20 127 |')


# 8. A watch says what it watches before any research, and the quote check leaves that alone

def test_a_watch_confirmation_leads_and_is_not_judged():
    from vali_api.monitors import with_watch
    found = output('Studios cost 600 to 850 euros.', KELA)
    found['structured'].update(key_facts=[], steps=[])
    result = with_watch(found, 'new flats under 900 eur in Espoo', 'Watch active.', live=True)
    assert result['structured']['answer'].split('\n')[0] == (
        'I will watch for new flats under 900 eur in Espoo. I will search the web for it once a day with Exa and tell '
        'you when new results appear.')
    result['own'].append('Watch saved locally.')  # any line Vali wrote itself, whatever its wording
    result['structured']['answer'] = 'Watch saved locally.\n' + result['structured']['answer']
    judge = verdicts({3: ('yes', '', 'Studios cost 600 to 850 euros.')})
    cite(result, FakeExa({KELA: 'Studios cost 600 to 850 euros.'}), judge)
    assert [c['supported'] for c in result['claims']] == [None, None, None, True] and len(judge.seen) == 1
    assert 'Not confirmed' not in result['structured']['answer']


# Round 2: the opener only when nothing is backed, and the answer's own order stays

def test_partly_backed_claims_keep_their_order_and_get_no_opener():
    page = {KELA: 'Löyly sauna costs 29 euros for two hours. Book in advance.'}
    answer = 'There are several saunas in Helsinki, including Löyly. Most of these saunas take bookings online.'
    result = output(answer, KELA)
    judge = verdicts({0: ('partly', 'There are several saunas in Helsinki.', 'Löyly sauna costs 29 euros for two hours.'),
                      1: ('partly', 'Most of these saunas take bookings.', 'Book in advance.')})
    cite(result, FakeExa(page), judge)
    assert result['structured']['answer'] == 'There are several saunas in Helsinki. Most of these saunas take bookings.'
    assert 'lead' not in result and not any('[C' not in u for u in judge.seen)  # no opener call at all


def test_only_the_leading_unbacked_sentence_moves_and_nothing_is_lost():
    page = {KELA: 'Löyly costs 29 euros for two hours.'}
    answer = 'The sauna is the best in town. Löyly costs 29 euros for two hours.\n- Bring a towel.'
    result = output(answer, KELA)
    cite(result, FakeExa(page), verdicts({
        0: ('no', 'Not confirmed by the sources: the sauna is the best in town.', ''),
        1: ('yes', '', 'Löyly costs 29 euros for two hours.'),
        2: ('no', 'Not confirmed by the sources: bring a towel.', '')}))
    assert result['structured']['answer'] == ('Löyly costs 29 euros for two hours.\n- Not confirmed by the sources: bring a '
                                              'towel.\nNot confirmed by the sources: the sauna is the best in town.')
    assert '29 euros' in result['claims'][0]['text']


def test_own_lines_are_not_counted_as_claims_in_the_trail():
    from vali_api.activity import done
    output_ = {'claims': [{'text': 'I prepared a draft.', 'sources': [], 'supported': None, 'own': True},
                          {'text': 'Deposit back in 14 days.', 'sources': [1], 'supported': True}], 'sources': [{}]}
    assert done({'created_at': '2026-11-14T10:00:00+00:00'}, output_)['text'] == 'Answer ready: 1 of 1 sentences quoted from 1 sources'


@pytest.mark.parametrize('text,code', [
    ('jeg mistet mit sygesikringskort i Finland hvad gør jeg', 'da'),
    ('hvordan får jeg et personnummer i Finland', 'da'),
    ('jeg har mistet kortet mitt, hva gjør jeg', 'no'),
    ('Hur får jag ett personnummer', 'sv'),
    ('wie kann ich meine Adresse ändern', 'de')])
def test_danish_and_norwegian_are_not_german_or_swedish(text, code):
    assert detect(text) == code


def test_a_partly_claim_shown_trimmed_keeps_its_quote():
    page = {KELA: 'Löyly costs 29 euros for two hours.'}
    result = output('Löyly costs 29 euros for two hours and is the best sauna in town. Assuming Helsinki, it is open today.', KELA)
    cite(result, FakeExa(page), verdicts({
        0: ('partly', 'Löyly costs 29 euros for two hours.', 'Löyly costs 29 euros for two hours.'),
        1: ('partly', 'It is open.', 'Löyly costs 29 euros for two hours.')}))
    first, assumption = result['claims']
    assert first['text'] == 'Löyly costs 29 euros for two hours.' and first['supported'] is True
    assert result['sources'][0]['quote'] == 'Löyly costs 29 euros for two hours.'
    assert assumption['text'].startswith('Assuming Helsinki') and assumption['supported'] is False  # kept whole, so not backed


def test_a_partly_claim_without_a_trimmed_form_stays_unconfirmed():
    page = {KELA: 'Löyly costs 29 euros for two hours.'}
    result = output('Löyly costs 29 euros and is the best sauna.', KELA)
    cite(result, FakeExa(page), verdicts({0: ('partly', '', 'Löyly costs 29 euros for two hours.')}))
    assert result['claims'][0]['supported'] is False and 'quote' not in result['sources'][0]


def test_english_errands_with_finnish_names_stay_english():
    assert detect('Vero form 5 deadline') == 'en' and detect('vero.fi tax card for part time job') == 'en'
