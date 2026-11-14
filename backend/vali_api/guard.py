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

    Errands are limited per account (40 a minute, so a burst of 10 always fits); new accounts per IP (20 an hour).
    Nothing else is limited per IP: a room of judges shares one venue address and polls every second."""
    def __init__(self, user_limit=40, seconds=60, signup_limit=20, signup_seconds=3600):
        self.user_limit, self.seconds = user_limit, seconds
        self.signup_limit, self.signup_seconds = signup_limit, signup_seconds
        self.events = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key, limit, seconds=None, what='requests'):
        seconds = seconds or self.seconds
        with self.lock:
            current = time.monotonic()
            queue = self.events[key]
            while queue and queue[0] <= current - seconds:
                queue.popleft()
            if len(queue) >= limit:
                raise RateLimited(queue[0] + seconds - current if queue else seconds, what)
            queue.append(current)


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
