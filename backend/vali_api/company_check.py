"""POST /v1/check: is this landlord, agency or company real, old enough, free of scam warnings, on its own domain?

Two Exa searches run side by side (a category "company" search and an open search aimed at the business
register and at warnings), each returning page text plus highlights. Findings are rules over that text, so
every quote is a sentence of the fetched page, checked with citations.verbatim before it is returned.
"""
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .citations import domain_of, fold, split_sentences, squash, verbatim
from .exa import ExaError, TTLCache
from .guard import authenticate

logger = logging.getLogger('vali.company_check')

CACHE_SECONDS = 6 * 3600
DEADLINE_SECONDS = 7.0  # both searches together; the endpoint answers within 8 s
# Exa list prices: $0.005 a search (1-25 results), $0.001 a page for text, $0.001 a page for highlights.
# Company search 3 pages text + highlights ($0.011) + risk search 3 pages text ($0.008) = $0.019 a call.
RESULTS_PER_SEARCH = 3
PAGE_CHARS = 4000
QUOTE_CHARS = 320
REGISTRY_DOMAINS = ('ytj.fi', 'prh.fi', 'virre.prh.fi', 'finder.fi', 'asiakastieto.fi', 'kauppalehti.fi',
                    'fonecta.fi', 'yritystele.fi', 'proff.fi', 'vainu.com')
LEGAL_SUFFIXES = {'oy', 'oyj', 'ab', 'ltd', 'ky', 'tmi', 'ry', 'ay', 'inc', 'llc', 'gmbh', 'as'}
BUSINESS_ID = re.compile(r'\b\d{7}-\d\b')
FOUNDED = re.compile(
    r'(?:founded|established|registered|incorporated|since|perustettu|rekister\w*|vuodesta|aloittanut|'
    r'grundad|registrerad)\D{0,40}?\b((?:19|20)\d{2})\b', re.I)
WARNING = re.compile(
    r'\b(scam\w*|fraud\w*|fake|huijau\w*|huijar\w*|huijaus\w*|petos\w*|varoitu\w*|varoittaa|warning|'
    r'beware|bluff|bedrägeri\w*)\b', re.I)
BAD_REVIEW = re.compile(r'\b(1(?:[.,]\d)?\s*(?:/\s*5|stars?|tähte\w*)|one star|terrible|worst|never again|'
                        r'avoid|älkää|huono\w* kokemu\w*)\b', re.I)


class CheckBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    domain: str | None = Field(None, max_length=253)
    city: str | None = Field(None, max_length=80)


def clean_domain(value):
    value = squash(value).lower()
    if not value:
        return ''
    return domain_of(value if '://' in value else 'https://' + value)


def name_tokens(name):
    words = re.findall(r'\w+', fold(name))
    return [w for w in words if w not in LEGAL_SUFFIXES and len(w) >= 2] or words


def mentions(text, tokens):
    folded = fold(text)
    return all(re.search(r'(?<!\w)' + re.escape(t) + r'(?!\w)', folded) for t in tokens)


def same_site(host, domain):
    return bool(host and domain) and (host == domain or host.endswith('.' + domain) or domain.endswith('.' + host))


def searches(body):
    place = f' {body.city}' if body.city else ''
    company = dict(query=f'{body.name}{place} Finland', category='company', type='auto', numResults=RESULTS_PER_SEARCH,
                   userLocation='FI', contents={'text': {'maxCharacters': PAGE_CHARS},
                                                'highlights': {'query': 'founded registered business ID',
                                                               'maxCharacters': QUOTE_CHARS}})
    risk = dict(query=f'"{body.name}"{place} y-tunnus rekisteröity huijaus arvostelut scam reviews', type='auto',
                numResults=RESULTS_PER_SEARCH, userLocation='FI', contents={'text': {'maxCharacters': PAGE_CHARS}})
    return [company, risk]


def run_searches(exa, bodies, deadline=DEADLINE_SECONDS):
    """Both searches in parallel; whatever has not answered by the deadline is left out."""
    pool = ThreadPoolExecutor(max_workers=len(bodies))
    futures = [pool.submit(exa.search, b) for b in bodies]
    done, _ = wait(futures, timeout=deadline)
    pool.shutdown(wait=False, cancel_futures=True)
    responses, cost = [], 0.0
    for future in futures:
        response = None
        if future not in done:
            logger.warning('company_check search timed out')
        else:
            try:
                response = future.result() or {}
            except ExaError as exc:
                logger.warning('company_check search failed status=%s', exc.status)
            except Exception:  # a broken search leaves the other one to answer
                logger.exception('company_check search failed')
        if response is not None:
            cost += float((response.get('costDollars') or {}).get('total') or 0)
        responses.append(response)
    return responses, cost


def pages_of(responses):
    """Pages of every search that answered; `company` marks results of the category "company" search."""
    pages, seen = [], set()
    for index, response in enumerate(responses):
        for result in (response or {}).get('results') or []:
            url = result.get('url')
            if not url or url in seen:
                continue
            seen.add(url)
            pages.append({'url': url, 'title': squash(result.get('title')) or domain_of(url), 'domain': domain_of(url),
                          'text': result.get('text') or '', 'highlights': result.get('highlights') or [],
                          'company': index == 0})
    return pages


def brand_matches(host, tokens):
    label = fold(host.split('.')[-2] if host.count('.') else host).replace('-', '')
    return any(len(t) >= 3 and t in label for t in tokens)


def candidate_sentences(page):
    """Highlights first (Exa picked them as relevant), then the page's own sentences; all from the page text."""
    for highlight in page['highlights']:
        yield from split_sentences(highlight, strip_markers=False)
    yield from split_sentences(page['text'], strip_markers=False)


def find_quote(page, pattern, tokens=None):
    for sentence in candidate_sentences(page):
        sentence = squash(sentence).lstrip('#*>|- ')
        if len(sentence) > QUOTE_CHARS or not pattern.search(sentence):
            continue
        if tokens and not mentions(sentence, tokens) and not mentions(page['title'], tokens):
            continue
        if verbatim(sentence, page['text']):
            return sentence
    return None


def finding(kind, text, page, quote):
    return {'kind': kind, 'text': text,
            'source': {'url': page['url'], 'title': page['title'], 'domain': page['domain'], 'quote': quote}}


def registry_findings(pages, tokens):
    out = []
    for page in pages:
        if not any(same_site(page['domain'], d) for d in REGISTRY_DOMAINS) or not mentions(page['text'] + ' ' + page['title'], tokens):
            continue
        quote = find_quote(page, BUSINESS_ID)
        if quote:
            business_id = BUSINESS_ID.search(quote).group(0)
            out.append(finding('registered', f'Listed in a Finnish company register ({page["domain"]}) with Business ID {business_id}.',
                               page, quote))
            break
    return out


def age_findings(pages, tokens, today=None):
    today = today or date.today()
    for page in pages:
        if not mentions(page['text'] + ' ' + page['title'], tokens):
            continue
        quote = find_quote(page, FOUNDED)
        if not quote:
            continue
        year = int(FOUNDED.search(quote).group(1))
        if year > today.year:
            continue
        years = today.year - year
        age = 'less than a year' if years == 0 else f'about {years} year{"s" if years != 1 else ""}'
        return [finding('age', f'Founded or registered in {year}, {age} ago.', page, quote)], years
    return [], None


def warning_findings(pages, tokens):
    out = []
    for page in pages:
        if not mentions(page['text'] + ' ' + page['title'], tokens):
            continue
        quote = find_quote(page, WARNING, tokens)
        if quote:
            out.append(finding('warning', f'A page mentions this name together with a scam or fraud warning ({page["domain"]}).', page, quote))
            continue
        quote = find_quote(page, BAD_REVIEW, tokens)
        if quote:
            out.append(finding('review', f'A negative review mentions this name ({page["domain"]}).', page, quote))
    return out[:3]


def domain_findings(pages, tokens, domain):
    if not domain:
        return [], None
    for page in pages:
        if same_site(page['domain'], domain):
            quote = find_quote(page, re.compile('.'), tokens) or find_quote(page, re.compile(r'\w{4,}'))
            if quote:
                return [finding('domain', f'{domain} is a site the search ties to this name.', page, quote)], True
    for page in pages:
        if any(same_site(page['domain'], d) for d in REGISTRY_DOMAINS) and domain in fold(page['text']):
            quote = find_quote(page, re.compile(re.escape(domain), re.I))
            if quote:
                return [finding('domain', f'The register entry lists the website {domain}.', page, quote)], True
    for page in pages:  # the company's own site, as the company search sees it, is somewhere else
        if not page['company'] or any(same_site(page['domain'], d) for d in REGISTRY_DOMAINS) or not brand_matches(page['domain'], tokens):
            continue
        quote = find_quote(page, re.compile('.'), tokens)
        if quote:
            return [finding('domain', f'The company search finds this name at {page["domain"]}, not at {domain}.', page, quote)], False
    return [], None


def verdict_of(findings, domain_ok, years):
    kinds = {f['kind'] for f in findings}
    if 'warning' in kinds or domain_ok is False or (years is not None and years < 1):
        return 'caution'
    if 'registered' in kinds and domain_ok is not False:
        return 'ok'
    if 'review' in kinds:
        return 'caution'
    return 'unknown'


def check_company(exa, body, today=None):
    started = time.monotonic()
    responses, cost = run_searches(exa, searches(body))
    answered = [r for r in responses if r is not None]
    pages, tokens, domain = pages_of(responses), name_tokens(body.name), clean_domain(body.domain)
    found = registry_findings(pages, tokens)
    ages, years = age_findings(pages, tokens, today)
    sites, domain_ok = domain_findings(pages, tokens, domain)
    warnings = warning_findings(pages, tokens)
    findings = found + ages + warnings + sites
    logger.info('company_check pages=%d findings=%d cost=%.4f seconds=%.2f', len(pages), len(findings), cost,
                time.monotonic() - started)
    result = {'verdict': verdict_of(findings, domain_ok, years) if answered else 'unknown',
              'findings': [{'text': f['text'], 'source': f['source']} for f in findings]}
    return result, len(answered) == len(responses)  # only a complete answer is cached


def cache_of(state):
    cache = getattr(state, 'company_check_cache', None)
    if cache is None:
        cache = state.company_check_cache = TTLCache(ttl=CACHE_SECONDS, max_entries=1024)
    return cache


router = APIRouter()


@router.post('/v1/check')
def check(body: CheckBody, request: Request, user=Depends(authenticate)):
    state = request.app.state
    cache = cache_of(state)
    key = '|'.join([' '.join(name_tokens(body.name)), clean_domain(body.domain), fold(squash(body.city))])
    hit = cache.get(key)
    if hit is not None:
        return hit
    result, complete = check_company(state.exa, body)
    if complete:
        cache.put(key, result)
    return result
