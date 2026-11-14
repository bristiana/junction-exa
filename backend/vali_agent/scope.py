"""User-approved sites and profile keys, independent of model instructions."""
from ipaddress import ip_address
import re
from urllib.parse import urlsplit


_MULTIPART_SUFFIXES = {
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'gov.au',
    'co.jp', 'co.nz', 'co.za', 'com.br', 'com.mx', 'com.ar', 'com.tr', 'com.cn',
    'co.in', 'co.kr', 'com.hk', 'com.sg',
}


def registrable_domain(host):
    """Approximate a registrable domain using common two-label public suffixes."""
    host = host.rstrip('.').lower().encode('idna').decode('ascii')
    try:
        ip_address(host)
        return host
    except ValueError:
        labels = host.split('.')
        count = 3 if '.'.join(labels[-2:]) in _MULTIPART_SUFFIXES else 2
        return '.'.join(labels[-count:])


def site(url):
    parsed = urlsplit(url)
    host = (parsed.hostname or '').rstrip('.').lower().encode('idna').decode('ascii')
    if parsed.scheme not in ('http', 'https') or not host or parsed.username or parsed.password:
        raise ValueError('Use an http(s) URL without credentials')
    return registrable_domain(host)


_NAME_KEYS = ('name', 'full_name', 'first_name', 'last_name')


def with_name_parts(profile):
    """Forms ask for the name whole or split. Fill in the missing forms from the ones the user gave:
    a full name "Anna Maria Virtanen" gives first name "Anna Maria" and last name "Virtanen"."""
    profile = dict(profile or {})
    whole = next((str(profile[k]).strip() for k in ('full_name', 'name') if str(profile.get(k) or '').strip()), '')
    if not whole and str(profile.get('first_name') or '').strip() and str(profile.get('last_name') or '').strip():
        whole = f"{str(profile['first_name']).strip()} {str(profile['last_name']).strip()}"
    if not whole:
        return profile
    words = whole.split()
    derived = {'name': whole, 'full_name': whole}
    if len(words) >= 2:
        derived |= {'first_name': ' '.join(words[:-1]), 'last_name': words[-1]}
    return {key: value for key, value in derived.items() if not str(profile.get(key) or '').strip()} | {
        key: value for key, value in profile.items() if str(value or '').strip() or key not in derived}


def _named(key, goal):
    return re.search(r'(?<!\w)' + re.escape(key).replace('_', r'\s*[_ ]\s*') + r'(?!\w)', goal, re.I)


def permitted_profile(goal, profile):
    """Only keys named in the user's goal may be resolved at the field boundary.
    The name counts as one detail: naming it in any form permits all of its forms."""
    allowed = {key: value for key, value in profile.items() if _named(key, goal)}
    if any(key in allowed for key in _NAME_KEYS):
        allowed |= {key: value for key, value in profile.items() if key in _NAME_KEYS}
    return allowed


def reject_placeholders(text, profile):
    if '{{' in text or any(str(v).casefold() in text.casefold() for v in profile.values() if v):
        raise ValueError('Profile values and placeholders are only allowed in approved fields')
