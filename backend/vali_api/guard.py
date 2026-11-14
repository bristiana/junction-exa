"""Authentication, origin checks, sliding windows and research spend guards."""
import math
import threading
import time
from collections import defaultdict, deque
from fastapi import HTTPException, Request


class RateLimited(HTTPException):
    """429 with Retry-After; the body also carries retry_after for clients that cannot read headers."""
    def __init__(self, retry_after, what='requests'):
        self.retry_after = max(1, math.ceil(retry_after))
        super().__init__(429, f'Too many {what} at once. Try again in {self.retry_after} s.',
                         headers={'Retry-After': str(self.retry_after)})


class SlidingWindow:
    """In-memory limits scoped to one process; shared storage is needed across replicas.

    Errands are limited per account (40 a minute, so a burst of 10 always fits); new accounts per IP (20 an hour);
    any other write per IP, loosely (600 in 10 minutes: a room of judges shares one venue address). Reads (GET polls)
    are never limited per IP."""
    def __init__(self, user_limit=40, seconds=60, signup_limit=20, signup_seconds=3600, ip_limit=600, ip_seconds=600):
        self.user_limit, self.seconds = user_limit, seconds
        self.signup_limit, self.signup_seconds = signup_limit, signup_seconds
        self.ip_limit, self.ip_seconds = ip_limit, ip_seconds
        self.events = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key, limit, seconds=None, what='requests', count=True):
        seconds = seconds or self.seconds
        with self.lock:
            current = time.monotonic()
            queue = self.events[key]
            while queue and queue[0] <= current - seconds:
                queue.popleft()
            if len(queue) >= limit:
                raise RateLimited(queue[0] + seconds - current if queue else seconds, what)
            if count:
                queue.append(current)

    def failed(self, key):
        """Record one wrong attempt; check(key, ..., count=False) locks out after too many."""
        with self.lock:
            self.events[key].append(time.monotonic())


CODE_TRIES, CODE_LOCKOUT = 5, 900  # wrong link or pairing codes before a 15-minute lockout


def check_code_tries(limiter, key):
    limiter.check(key, CODE_TRIES, CODE_LOCKOUT, what='wrong codes', count=False)


def public_start_url(url, resolve):
    """http(s) to a public host only: no localhost, private, link-local (cloud metadata) or reserved address.

    This checks the start URL as resolved now; it is not full SSRF protection (later redirects, DNS changes and
    the pages the browser agent opens are outside this check)."""
    import ipaddress
    from urllib.parse import urlsplit
    parts = urlsplit(url or '')
    host = (parts.hostname or '').lower()
    if parts.scheme not in ('http', 'https') or not host or host == 'localhost' or host.endswith(
            ('.localhost', '.local', '.internal', '.lan', '.home.arpa')):
        return False
    try:
        addresses = {str(ipaddress.ip_address(host))}  # a literal address is checked as written
    except ValueError:
        try:
            addresses = resolve(host)
        except OSError:
            return False
    try:
        return bool(addresses) and all(ipaddress.ip_address(a.split('%')[0]).is_global for a in addresses)
    except ValueError:
        return False


def resolve_host(host):
    import socket
    return {info[4][0] for info in socket.getaddrinfo(host, None)}


def client_ip(request):
    """Modal hands the app the caller's public address and adds no X-Forwarded-For (checked live on 2026-11-14:
    public peer, zero forwarded hops), so a forwarded header could only be forged and is ignored."""
    return request.client.host if request.client else 'unknown'


def check_origin(origin, configured):
    """Enforce an optional exact origin allow-list, with an extension wildcard."""
    if not origin or not configured:
        return
    allowed = {s.strip() for s in configured.split(',')}
    if origin in allowed or ('extension' in allowed and origin.startswith('chrome-extension://')):
        return
    raise HTTPException(403, 'Origin not allowed')


def authenticate(request: Request):
    """Resolve a bearer token by its SHA-256 hash; raw tokens never reach the store."""
    authorization = request.headers.get('authorization', '')
    scheme, _, token = authorization.partition(' ')
    user = request.app.state.store.user_by_token(token) if scheme.lower() == 'bearer' and token else None
    if not user:
        raise HTTPException(401, 'Bearer token required', headers={'WWW-Authenticate': 'Bearer'})
    return user


def check_task_budget(application, user, *, count_request=True):
    """Limit task creations and reject research once recorded daily costs reach the cap."""
    state = application.state
    if count_request:
        state.limiter.check('user:' + user['id'], state.limiter.user_limit, what='errands')
    if state.store.daily_spend(user['id']) >= state.config.daily_cap_usd:
        raise HTTPException(429, 'Daily research spend cap reached')
    if state.store.daily_spend() >= state.config.global_daily_cap_usd:  # kill switch across all users
        raise HTTPException(429, "Vali has used today's research budget. Try again tomorrow.")
