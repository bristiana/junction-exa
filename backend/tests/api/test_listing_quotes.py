"""A list answer (showtimes, timetables, opening hours) verifies when the cited page lists the items.

Live regression: "what's playing at Finnkino Tennispalatsi tonight and when" was marked unsupported although the
cited leffavuoro.fi page (fixture: its Exa /contents text, Saturday and Sunday) listed every film. The judge was
shown film titles torn from their times and from the day heading, and asked for one sentence no list page has.
"""
import re
from pathlib import Path

from vali_api.citations import MAP_SYSTEM, PAGE_CHARS, cite, excerpt

from test_answer_quality import FakeExa, output

URL = 'https://leffavuoro.fi/en/theatre/finnkino-tennispalatsi-helsinki/'
PAGE = (Path(__file__).parents[1] / 'fixtures' / 'leffavuoro_tennispalatsi.txt').read_text()
FILMS = ['Lapin sota', 'Clayface', 'How To Rob A Bank', 'Wildwood - Sysimetsä', 'Spider-Man: Brand New Day']
CLAIM = ('For tonight, Saturday November 14, 2026, Finnkino Tennispalatsi has several evening screenings including '
         'Lapin sota, Clayface, How To Rob A Bank, Wildwood - Sysimetsä, and Spider-Man: Brand New Day, with showtimes '
         'starting from 17:40 onwards.')


def day(shown, heading):
    """What the judge was shown under one day heading, up to the next day."""
    part = shown.split(heading, 1)[1] if heading in shown else ''
    return re.split(r'^## ', part, maxsplit=1, flags=re.M)[0]


def film(section, title):
    """One film's lines in a day: its heading up to the next heading."""
    part = section.split('### ' + title + '\n', 1)[1] if '### ' + title + '\n' in section else ''
    return re.split(r'^#', part, maxsplit=1, flags=re.M)[0]


def listing_judge(films):
    """A fake judge that can only read: it quotes a film's title line when the Saturday part it was shown lists it,
    and drops the films it was not shown from the sentence ("partly"), as the prompt asks."""
    seen = []
    def llm(system, user, schema):
        seen.append(user)
        i = int(user.split('[C', 1)[1].split(']', 1)[0])
        saturday = day(user.split('[P0]', 1)[1], '## Sat 14.11.')
        listed = [f for f in films if '### ' + f + '\n' in saturday]
        support = [{'page': 0, 'quote': '### ' + f} for f in listed]
        if listed == films:
            return {'claims': [{'i': i, 'verdict': 'yes', 'soft': '', 'support': support}]}
        soft = f'Tonight Finnkino Tennispalatsi shows {", ".join(listed[:-1])} and {listed[-1]}.' if listed else ''
        return {'claims': [{'i': i, 'verdict': 'partly' if listed else 'no', 'soft': soft, 'support': support}]}
    llm.seen = seen
    return llm


def test_the_judge_sees_each_listed_film_with_its_times_under_its_day():
    assert len(PAGE) > PAGE_CHARS  # long enough that only an excerpt is shown
    shown = excerpt(PAGE, CLAIM)
    assert len(shown) <= PAGE_CHARS + 200
    saturday = day(shown, '## Sat 14.11.')
    times = {'Lapin sota': '- 18:50', 'Clayface': '- 18:20', 'How To Rob A Bank': '- 18:05',
             'Wildwood - Sysimetsä': '- 21:15', 'Spider-Man: Brand New Day': '- 21:15'}
    for title, time in times.items():
        assert time in film(saturday, title), title  # the title and its evening time, together
    for title in FILMS:  # a film from another day is never shown without that day's heading above it
        assert shown.index('### ' + title) > shown.index('## Sat 14.11.')
        if shown.count('### ' + title) > 1:
            assert '## Sun 15.11.' in shown


def test_a_showtimes_answer_is_supported_by_the_listing_it_cites():
    result = output(CLAIM, URL)
    cite(result, FakeExa({URL: PAGE}), listing_judge(FILMS), "what's playing at Finnkino Tennispalatsi tonight and when")
    claim = result['claims'][0]
    assert claim['supported'] is True and claim['sources'] == [1] and 'original' not in claim
    assert 'lead' not in result and result['structured']['answer'] == CLAIM  # no "I could not confirm this"
    assert result['sources'][0]['quote'] == 'Lapin sota'  # the title line, without its heading marks


def test_a_film_the_page_does_not_list_is_trimmed_not_passed():
    claim = ('For tonight, Saturday November 14, 2026, Finnkino Tennispalatsi has evening screenings including '
             'Lapin sota, Clayface, Dune: Part Three and Spider-Man: Brand New Day.')
    assert 'Dune' not in PAGE
    result = output(claim, URL)
    cite(result, FakeExa({URL: PAGE}), listing_judge(['Lapin sota', 'Clayface', 'Dune: Part Three', 'Spider-Man: Brand New Day']))
    shown = result['claims'][0]
    assert shown['original'] == claim and 'Dune' not in shown['text'] and 'Dune' not in result['structured']['answer']
    assert shown['text'] == 'Tonight Finnkino Tennispalatsi shows Lapin sota, Clayface and Spider-Man: Brand New Day.'


def test_a_quote_for_an_item_not_on_the_page_backs_nothing():
    result = output('Finnkino Tennispalatsi shows Dune: Part Three tonight.', URL)
    def judge(system, user, schema):  # a judge that claims a line the page does not have
        return {'claims': [{'i': 0, 'verdict': 'yes', 'soft': '', 'support': [{'page': 0, 'quote': '### Dune: Part Three'}]}]}
    cite(result, FakeExa({URL: PAGE}), judge)
    assert result['claims'][0]['supported'] is False and 'quote' not in result['sources'][0]


def test_the_judge_is_told_how_list_pages_state_things():
    assert 'one quote per item' in MAP_SYSTEM and 'headings above it' in MAP_SYSTEM
