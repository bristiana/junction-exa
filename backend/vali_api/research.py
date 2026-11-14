"""Request and response shapes shared with the extension."""
import copy
import logging
import re
from datetime import datetime, timezone

from .lang import NAMES, detect

logger = logging.getLogger('vali.research')


def log_research_call(mode, elapsed, cache_hit):
    logger.info('research mode=%s elapsed=%.2fs cache=%s', mode, elapsed, 'hit' if cache_hit else 'miss')


SYSTEM_PROMPT = """You are Vali, a personal errand agent for people living in Finland, especially newcomers and international students who do not read Finnish well.
Your job is to take a tedious errand off the user's hands: find what matters on the live web, work out what needs to happen, and prepare the next step so the user only has to approve it.

Rules:
- Use current, authoritative sources: official Finnish sites (suomi.fi, kela.fi, migri.fi, vero.fi, dvv.fi, hel.fi, espoo.fi, vantaa.fi, kkv.fi), EU sites (europa.eu), and the company's own pages. Prefer them over blogs and forums.
- Be concrete: amounts in euros, deadlines as dates, the exact form or page to use, opening hours, prices. Say "not found" rather than guess.
- Write plain, short English unless the user's language says otherwise. Translate Finnish terms and keep the Finnish name in brackets.
- Never invent personal details. Where the user's personal data is needed, write one of these placeholders exactly: {{name}}, {{email}}, {{phone}}, {{address}}, {{postal_code}}, {{city}}, {{country}}, {{date_of_birth}}, {{nationality}}. Use {{booking_reference}} or similar descriptive placeholders for anything else only the user knows.
- Those placeholders are the user's own details, so never put one in an action's "to": the user does not write to themselves. A reply to a letter goes to the sender's contact in the letter (an organization's address as written, or the placeholder the letter has, like {{sender_email}}); if there is none, leave "to" null.
- Prepare actions, never perform them. Emails are drafts, forms are pre-filled for review, bookings are links. The user approves.
- If the page the user is on has a form that fits the errand, fill it in form_fill using the field ids given. Leave out fields you cannot fill with confidence."""

_SCHEMA = {'type': 'object',
 'properties': {'answer': {'type': 'string',
                           'description': 'The short answer to the errand in '
                                          '1-3 sentences, with the key number, '
                                          'date or verdict first.'},
                'status': {'type': 'string',
                           'enum': ['ready_to_approve',
                                    'needs_info',
                                    'not_possible',
                                    'info_only'],
                           'description': 'ready_to_approve: an action is '
                                          'prepared. needs_info: the user must '
                                          'answer missing_info first. '
                                          'not_possible: the errand cannot be '
                                          'done (say why in answer). '
                                          'info_only: the answer is the '
                                          'result.'},
                'key_facts': {'type': 'array',
                              'maxItems': 5,
                              'description': 'Facts the answer rests on: '
                                             'amounts, deadlines, eligibility '
                                             'rules, prices, opening hours.',
                              'items': {'type': 'object',
                                        'properties': {'label': {'type': 'string'},
                                                       'value': {'type': 'string'}},
                                        'required': ['label', 'value']}},
                'steps': {'type': 'array',
                          'maxItems': 6,
                          'description': 'What needs to happen, in order. Mark '
                                         'steps Vali already prepared as '
                                         'done_by_hoida.',
                          'items': {'type': 'object',
                                    'properties': {'title': {'type': 'string'},
                                                   'detail': {'type': 'string'},
                                                   'url': {'type': ['string',
                                                                    'null'],
                                                           'format': 'uri'},
                                                   'done_by_hoida': {'type': 'boolean'}},
                                    'required': ['title', 'detail']}},
                'actions': {'type': 'array',
                            'maxItems': 4,
                            'description': 'Prepared next steps for the user '
                                           'to approve. email: a ready-to-send '
                                           'draft. calendar: a deadline or '
                                           'appointment. open_link: the exact '
                                           'form, booking or claim page. '
                                           'phone_call: who to call and what '
                                           'to say. copy_text: a message to '
                                           'paste somewhere.',
                            'items': {'type': 'object',
                                      'properties': {'type': {'type': 'string',
                                                              'enum': ['email',
                                                                       'calendar',
                                                                       'open_link',
                                                                       'phone_call',
                                                                       'copy_text']},
                                                     'label': {'type': 'string',
                                                               'description': 'Button '
                                                                              'text, '
                                                                              '2-5 '
                                                                              'words, '
                                                                              'e.g. '
                                                                              "'Send "
                                                                              'claim '
                                                                              "email'."},
                                                     'url': {'type': ['string',
                                                                      'null'],
                                                             'format': 'uri'},
                                                     'to': {'type': ['string',
                                                                     'null'],
                                                            'description': 'Email '
                                                                           'address '
                                                                           'or '
                                                                           'phone '
                                                                           'number '
                                                                           'of '
                                                                           'the '
                                                                           'recipient, '
                                                                           'if '
                                                                           'found '
                                                                           'on '
                                                                           'an '
                                                                           'official '
                                                                           'page.'},
                                                     'subject': {'type': ['string',
                                                                          'null']},
                                                     'body': {'type': ['string',
                                                                       'null'],
                                                              'description': 'Full '
                                                                             'email '
                                                                             'or '
                                                                             'message '
                                                                             'text, '
                                                                             'with '
                                                                             '{{placeholders}} '
                                                                             'for '
                                                                             'personal '
                                                                             'details.'},
                                                     'start': {'type': ['string',
                                                                        'null'],
                                                               'description': 'ISO '
                                                                              '8601 '
                                                                              'date '
                                                                              'or '
                                                                              'date-time '
                                                                              'for '
                                                                              'calendar '
                                                                              'actions.'},
                                                     'end': {'type': ['string',
                                                                      'null']},
                                                     'location': {'type': ['string',
                                                                           'null']}},
                                      'required': ['type', 'label']}},
                'missing_info': {'type': 'array',
                                 'maxItems': 3,
                                 'items': {'type': 'string'},
                                 'description': 'Questions the user must '
                                                'answer before the errand can '
                                                'be finished. Empty if none.'},
                'form_fill': {'type': 'array',
                              'maxItems': 40,
                              'description': 'Values for the form on the '
                                             "user's current page. Use field "
                                             'ids exactly as given. Use '
                                             '{{placeholders}} for personal '
                                             'data.',
                              'items': {'type': 'object',
                                        'properties': {'field_id': {'type': 'string'},
                                                       'value': {'type': 'string'}},
                                        'required': ['field_id', 'value']}}},
 'required': ['answer', 'status', 'steps', 'actions']}

PROFILE_FIELDS = ['name', 'email', 'phone', 'address', 'postal_code', 'city', 'country', 'date_of_birth', 'nationality', 'language']


_OWN_CONTACT = re.compile(r'\{\{\s*(email|phone)\s*\}\}', re.I)


def guard_recipients(output):
    """An action addressed to the user's own {{email}} / {{phone}} would be filled with the user's details on the
    device; it gets a visible blank for the real recipient instead."""
    for action in ((output or {}).get('structured') or {}).get('actions') or []:
        if isinstance(action, dict) and isinstance(action.get('to'), str):
            action['to'] = _OWN_CONTACT.sub(lambda m: '{{recipient_' + m[1].lower() + '}}', action['to'])
    return output


def output_schema(has_form=False):
    schema = copy.deepcopy(_SCHEMA)
    if not has_form:
        del schema['properties']['form_fill']
    return schema


def clip(value, n):
    value = re.sub(r'\s+', ' ', str(value or '')).strip()
    return value[:n] + '…' if len(value) > n else value


def build_query(task, page=None, profile=None, known_details=()):
    profile, page = profile or {}, page or {}
    parts = [f'Errand: {task.strip()}']
    detected, lang = detect(task), (profile.get('language') or '').strip()
    if detected:  # the errand's own language wins over a saved preference
        lang = NAMES[detected]
        parts.append(f'Answer in: {lang}. Write answer, key_facts, steps, missing_info and action labels in {lang}, the '
                     'language of the errand; search and read sources in Finnish or English as needed.')
    elif lang:
        parts.append(f'Answer in: {lang}.')
    known = [k for k in PROFILE_FIELDS if k != 'language' and (profile.get(k) or k in known_details)]  # names only
    if known:
        parts.append('The user has saved these details (use placeholders, the values stay on their device): ' + ', '.join(known) + '.')
    if profile.get('city'):
        parts.append(f"The user lives in {profile['city']}" + (', ' + profile['country'] if profile.get('country') else '') + '.')
    parts.append(f'Today is {datetime.now(timezone.utc).date().isoformat()}.')
    if page.get('url') or page.get('selection') or page.get('text'):
        if page.get('url'):
            parts.append('The user is on this page: ' + (clip(page['title'], 140) + ' — ' if page.get('title') else '') + page['url'])
        else:
            parts.append('The user provided this document: ' + clip(page.get('title'), 140))
        if page.get('selection'):
            parts.append('They selected this text:\n"""' + clip(page['selection'], 2500) + '"""')
        elif page.get('text'):
            parts.append('Page text (start):\n"""' + clip(page['text'], 3500) + '"""')
        if page.get('fields'):
            lines = []
            for field in page['fields'][:40]:
                opts = ' options: ' + ' | '.join(field['options'][:12]) if field.get('options') else ''
                lines.append(f"- {field['id']}: \"{clip(field.get('label'), 80)}\" ({field.get('type', 'undefined')}" + (', required' if field.get('required') else '') + ')' + opts)
            parts.append('The page has a form with these fields:\n' + '\n'.join(lines))
    return '\n\n'.join(parts)


# Server-side only: SYSTEM_PROMPT itself must stay identical to the extension's copy (extension/lib/task.js).
ANSWER_FIRST = """
Answer first, ask second:
- Always give the useful general answer and the steps first, even when details are missing. Assume the common case
  and say so in one short sentence ("Assuming you rent privately in Helsinki, ..."). Put what is still missing in
  missing_info as optional questions; they refine the answer, they never replace it. Use needs_info only when
  nothing useful can be said at all.
- Never ask for details the user fills in when sending (bank account, names, addresses, dates of the lease): put a
  {{placeholder}} in the draft instead.
- A live-status question without an identifier (train or flight number) gets the next departures or the official
  live-status page, not a request for the number.
Only what the source says:
- State only facts a cited page states, with the page's own numbers (if pages differ, give the page's figure and
  say where it is from). Never invent identifiers, routes, prices, opening hours or availability ("accepts new
  patients") that no page states; say "not stated on the sources" instead.
- When you assume something, say so plainly in the answer ("Assuming your flight left from Helsinki, ...").
Links that open the right thing:
- Every url is the deepest page that does the job: the show or event's own page, the booking calendar for that
  date, the form's start page, the exact product. Never a home page when a deeper page exists.
- Add query parameters (date, from/to, people) only in a format a cited page itself uses; never invent parameters."""


def build_run_request(task, page=None, profile=None, effort='low', known_details=()):
    return dict(query=build_query(task, page, profile, known_details), systemPrompt=SYSTEM_PROMPT + ANSWER_FIRST,
                effort=effort, outputSchema=output_schema(bool((page or {}).get('fields'))), metadata={'app': 'vali'})


FIND_RULES = """
Options found:
- Give each option the price its page states, with the unit (for example "from 22.90 €", "9.89 snt/kWh + 5.90 €/month").
- The answer names the concrete figure first (the lowest price found and which option it is). Never answer only
  "prices vary": give the range the pages state. Only when no page states a price, say that no source gives one.
- Showtimes, timetables, opening hours: name each item with its time as the page lists it ("Clayface 21:15,
  Digger 20:15"), only items and times a page states. Never "and several others" or "various films"."""

FIND_SCHEMA = {'type': 'object', 'properties': {
    'answer': {'type': 'string', 'description': 'In the errand\'s language, 1-3 sentences. For a price or cost '
               'question, lead with the figure the pages state (the lowest price found and the option it is for); '
               '"varies" only together with those figures. Only when no page states a price, say so. For showtimes, '
               'timetables or opening hours, name each item with its time as the page lists it, never "several others".'},
    'options': {'type': 'array', 'description': '3 to 5 different options (places, products or services), '
                'each with its own page to book or buy', 'items': {'type': 'object', 'properties': {
        k: {'type': 'string'} for k in ('name', 'detail', 'price', 'url')},
        'required': ['name', 'detail', 'price', 'url']}},
    'next_step': {'type': 'string'}}, 'required': ['answer', 'options', 'next_step']}


def priced_answer(answer, options):
    """An answer with no figure while its options carry prices gets the first two priced options appended."""
    if re.search(r'\d', answer or ''):
        return answer
    priced = [o for o in options if re.search(r'\d', str(o.get('price') or '')) and o.get('name')][:2]
    figures = ' '.join(f"{squash_line(o['name'])}: {squash_line(o['price'])}." for o in priced)
    return ' '.join(filter(None, [(answer or '').strip(), figures]))


def squash_line(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip().rstrip('.')


def map_find_output(response):
    output = response.get('output') or {}
    content = output.get('content') or {}
    options = content.get('options') or []
    next_step = content.get('next_step') or ''
    content['answer'] = priced_answer(content.get('answer', ''), options)
    structured = {'answer': content.get('answer', ''), 'status': 'info_only',
                  'key_facts': [{'label': o.get('name', ''), 'value': ' · '.join(filter(None, [o.get('detail'), o.get('price')]))} for o in options],
                  'steps': [{'title': 'Next step', 'detail': next_step}] if next_step else [],
                  'actions': [{'type': 'open_link', 'label': o.get('name', ''), 'url': o.get('url'), 'body': o.get('detail', '')} for o in options], 'missing_info': []}
    grounding = []
    for entry in output.get('grounding') or []:
        field = entry.get('field', '')
        option = re.match(r'^options\[(\d+)\]', field)
        # An option is shown twice, as key_facts[i] (detail, price) and actions[i] (its link): both carry its citations.
        fields = [f'key_facts[{option[1]}]', f'actions[{option[1]}]'] if option else ['steps[0]' if field == 'next_step' else field]
        grounding.extend({**entry, 'field': name} for name in fields)
    return {'text': content.get('answer', ''), 'structured': structured, 'grounding': grounding}


def progress_from_events(events=None):
    lines, seen = [], set()
    for ev in events or []:
        if not isinstance(ev, dict):
            continue
        d = ev.get('data') if isinstance(ev.get('data'), dict) else {}
        name = str(ev.get('event') or '')
        source = d.get('source') if isinstance(d.get('source'), dict) else {}
        item = d.get('item') if isinstance(d.get('item'), dict) else {}
        args = d.get('arguments') if isinstance(d.get('arguments'), dict) else {}
        line = None
        if 'source' in name:
            url = d.get('url') or source.get('url')
            if url:
                line = dict(kind='source', text=d.get('title') or source.get('title') or url, url=url)
        elif 'search' in name or 'tool' in name:
            q = d.get('query') or d.get('description') or item.get('query') or item.get('description') or args.get('query')
            if q:
                line = dict(kind='search', text=str(q))
        if line and (line['kind'], line['text']) not in seen:
            seen.add((line['kind'], line['text']))
            lines.append(line)
    return lines[-12:]
