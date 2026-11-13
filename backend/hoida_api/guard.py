"""Authentication, origin checks, sliding windows and research spend guards."""
import threading
import time
from collections import defaultdict, deque
from fastapi import HTTPException, Request


class SlidingWindow:
    """In-memory limits scoped to one process; shared storage is needed across replicas."""
    def __init__(self, ip_limit=300, user_limit=30, seconds=600):
        self.ip_limit, self.user_limit, self.seconds = ip_limit, user_limit, seconds
        self.events = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key, limit):
        with self.lock:
            current = time.monotonic()
            queue = self.events[key]
            while queue and queue[0] <= current - self.seconds:
                queue.popleft()
            if len(queue) >= limit:
                raise HTTPException(429, 'Rate limit exceeded')
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


def check_task_budget(request, user):
    """Limit task creations and reject research once recorded daily costs reach the cap."""
    state = request.app.state
    state.limiter.check('user:' + user['id'], state.limiter.user_limit)
    if state.store.daily_spend(user['id']) >= state.config.daily_cap_usd:
        raise HTTPException(429, 'Daily research spend cap reached')
