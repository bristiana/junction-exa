"""Ask early: the one detail a booking or search obviously lacks (city, group size, date), with quick replies."""
import re

CITIES = ('helsinki', 'helsingfors', 'espoo', 'esbo', 'vantaa', 'vanda', 'tampere', 'tammerfors', 'turku', 'åbo', 'oulu',
          'uleåborg', 'jyväskylä', 'lahti', 'kuopio', 'pori', 'joensuu', 'lappeenranta', 'hämeenlinna', 'vaasa', 'rovaniemi',
          'seinäjoki', 'kotka', 'porvoo', 'kerava', 'järvenpää', 'mikkeli', 'kajaani', 'nurmijärvi', 'tuusula')
_GROUP = re.compile(r'\b(group|table|party|team|friends|family|colleagues|class|us|people|persons|guests)\b', re.I)
_COUNT = re.compile(r'\b\d+\b|\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|pair|alone|myself|solo)\b', re.I)
_WHEN = re.compile(
    r'\b(today|tonight|tomorrow|now|weekend|week|month|morning|evening|afternoon|night|monday|tuesday|wednesday|thursday|'
    r'friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|'
    r'jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|christmas|easter|midsummer|asap|soon|next|this)\b'
    r'|\d{1,2}[./-]\d{1,2}|\d{1,2}:\d{2}|\d{1,2}\s?(am|pm)\b', re.I)
QUESTIONS = {
    'city': ('Which city?', ['Helsinki', 'Espoo', 'Tampere', 'Turku']),
    'group': ('How many people?', ['2', '3-5', '6-10', 'More than 10']),
    'when': ('When?', ['Today', 'Tomorrow', 'This weekend', 'Next week']),
}


def missing(task, mode):
    """Names of the details a book or find errand lacks, most important first."""
    if mode not in ('book', 'find'):
        return []
    text, gaps = task.lower(), []
    if not any(re.search(r'(?<!\w)' + city, text) for city in CITIES):
        gaps.append('city')
    if _GROUP.search(text) and not _COUNT.search(text):
        gaps.append('group')
    if mode == 'book' and not _WHEN.search(text):
        gaps.append('when')
    return gaps


def early_question(task, mode):
    gaps = missing(task, mode)
    if not gaps:
        return None
    text, options = QUESTIONS[gaps[0]]
    return {'text': text, 'options': list(options), 'answer': None}


def with_answer(task, question, answer):
    """The errand text for the follow-up pass."""
    return f'{task.strip()}\n\nThe user answered "{question["text"]}": {answer.strip()}'
