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


def permitted_profile(goal, profile):
    """Only keys named in the user's goal may be resolved at the field boundary."""
    return {key: value for key, value in profile.items()
            if re.search(r'(?<!\w)' + re.escape(key).replace('_', r'\s*[_ ]\s*') + r'(?!\w)', goal, re.I)}


def reject_placeholders(text, profile):
    if '{{' in text or any(str(v).casefold() in text.casefold() for v in profile.values() if v):
        raise ValueError('Profile values and placeholders are only allowed in approved fields')
