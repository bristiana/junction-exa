"""User-approved sites and profile keys, independent of model instructions."""
from functools import lru_cache
from ipaddress import ip_address
from pathlib import Path
import re
from urllib.parse import urlsplit


@lru_cache(maxsize=1)
def _suffix_rules():
    return set(line.strip().encode('idna').decode('ascii') for line in Path(__file__).with_name('public_suffix_list.dat').read_text().splitlines()
               if line and not line.startswith('//'))


def site(url):
    parsed = urlsplit(url)
    host = (parsed.hostname or '').rstrip('.').lower().encode('idna').decode('ascii')
    if parsed.scheme not in ('http', 'https') or not host or parsed.username or parsed.password:
        raise ValueError('Use an http(s) URL without credentials')
    try:
        ip_address(host)
        return host
    except ValueError:
        pass
    labels = host.split('.')
    rules = _suffix_rules()
    suffix = 1
    for i in range(len(labels)):
        part = '.'.join(labels[i:])
        if '!' + part in rules:
            suffix = len(labels) - i - 1
            break
        if part in rules or (i + 1 < len(labels) and '*.' + '.'.join(labels[i + 1:]) in rules):
            suffix = max(suffix, len(labels) - i)
    return '.'.join(labels[-suffix - 1:])


def permitted_profile(goal, profile):
    """Only keys named in the user's goal may be resolved at the field boundary."""
    return {key: value for key, value in profile.items()
            if re.search(r'(?<!\w)' + re.escape(key).replace('_', r'\s*[_ ]\s*') + r'(?!\w)', goal, re.I)}


def reject_placeholders(text, profile):
    if '{{' in text or any(str(v).casefold() in text.casefold() for v in profile.values() if v):
        raise ValueError('Profile values and placeholders are only allowed in approved fields')
