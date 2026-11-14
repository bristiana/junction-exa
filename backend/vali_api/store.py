"""One SQL store interface backed by SQLite locally or Postgres on Modal."""
import hashlib
import base64
import json
import math
import secrets
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from .lang import detect


def now():
    return datetime.now(timezone.utc).isoformat()


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def password_hash(password):
    """scrypt with a random salt, stored as salt$hash in hex."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return salt.hex() + '$' + digest.hex()


def password_ok(password, stored):
    salt, _, digest = stored.partition('$')
    try:
        check = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32)
    except ValueError:
        return False
    return secrets.compare_digest(check.hex(), digest)


class Store:
    """Serialize operations and keep research and execution writes independent."""
    postgres = False

    def __init__(self, connection):
        self.connection = connection
        self.lock = threading.RLock()
        blob = 'BYTEA' if self.postgres else 'BLOB'
        tables = [
            'users(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, profile_json TEXT NOT NULL, wa_number TEXT UNIQUE)',
            'wa_seen(message_id TEXT PRIMARY KEY, at TEXT NOT NULL)',
            'pair_codes(code TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)',
            'code_tries(scope TEXT PRIMARY KEY, window_start TEXT NOT NULL, tries INTEGER NOT NULL)',
            'device_link_codes(code_hash TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL, sealed_token TEXT NOT NULL, salt TEXT NOT NULL, expires_at TEXT NOT NULL)',
            'tasks(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source TEXT NOT NULL, mode TEXT NOT NULL, task TEXT NOT NULL, page_json TEXT NOT NULL, research_json TEXT NOT NULL, execution_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lang TEXT)',
            'watches(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, query TEXT NOT NULL, exa_monitor_id TEXT, created_at TEXT NOT NULL, check_requested_at TEXT)',
            'watch_details(watch_id TEXT PRIMARY KEY, task_id TEXT, secret TEXT NOT NULL)',
            'watch_slots(user_id TEXT NOT NULL, slot INTEGER NOT NULL, watch_id TEXT UNIQUE NOT NULL, PRIMARY KEY(user_id,slot))',
            'watch_updates(watch_id TEXT NOT NULL, event_id TEXT NOT NULL, data_json TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(watch_id,event_id))',
            'failures(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, stage TEXT NOT NULL, error TEXT NOT NULL, at TEXT NOT NULL)',
            f'shots(task_id TEXT NOT NULL, n INTEGER NOT NULL, jpeg {blob} NOT NULL, PRIMARY KEY(task_id,n))',
            f'live_frames(task_id TEXT PRIMARY KEY, jpeg {blob} NOT NULL, updated_at TEXT NOT NULL)',
            # "Continue in my browser": the cloud browser's page and cookies. Secrets: never in execution_json.
            'handoffs(task_id TEXT PRIMARY KEY, data_json TEXT NOT NULL, expires_at TEXT NOT NULL)',
            # Email and password sign-in: one login per account, any number of signed-in browsers.
            'credentials(email TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL, created_at TEXT NOT NULL)',
            'sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL)',
            # "Your situation": EU or not, student, city, ID and bank yes/no. Not identifying; answers fit the person.
            'situations(user_id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL)']
        for table in tables:
            self.sql('CREATE TABLE IF NOT EXISTS ' + table)
        self._add_column('tasks', 'lang TEXT')
        self._add_column('watches', 'check_requested_at TEXT')
        self._once('profiles-cleared', "UPDATE users SET profile_json='{}' WHERE profile_json<>'{}'")  # they stay on the device

    def _once(self, name, statement):
        """A one-off data migration, recorded so later starts skip it."""
        self.sql('CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY, at TEXT NOT NULL)')
        if self.sql('INSERT INTO migrations VALUES(?,?) ON CONFLICT(name) DO NOTHING RETURNING name', (name, now())):
            self.sql(statement)

    def _add_column(self, table, column):
        """Additive migration for tables created before the column existed."""
        if self.postgres:
            self.sql(f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column}')
        elif column.split()[0] not in {r['name'] for r in self.sql(f'PRAGMA table_info({table})')}:
            self.sql(f'ALTER TABLE {table} ADD COLUMN {column}')

    in_transaction = 0

    def sql(self, query, params=(), one=False):
        with self.lock:
            query = query.replace('?', '%s') if self.postgres else query
            self._ensure_connected()
            try:
                cursor = self.connection.execute(query, params)
            except Exception as exc:
                if not self._reconnect_after(exc):
                    raise
                cursor = self.connection.execute(query, params)
            rows = cursor.fetchall() if cursor.description else []
            return (dict(rows[0]) if rows else None) if one else [dict(r) for r in rows]

    def _ensure_connected(self):
        pass

    def _reconnect_after(self, exc):
        return False

    @contextmanager
    def transaction(self):
        with self.lock:
            if self.postgres:
                self._ensure_connected()
                self.in_transaction += 1
                try:
                    with self.connection.transaction():
                        yield
                finally:
                    self.in_transaction -= 1
            else:
                self.connection.execute('BEGIN IMMEDIATE')
                try:
                    yield
                    self.connection.commit()
                except Exception:
                    self.connection.rollback()
                    raise

    def create_user(self):
        token, uid = secrets.token_urlsafe(32), 'u_' + uuid.uuid4().hex
        self.sql('INSERT INTO users VALUES(?,?,?,?,?)', (uid, token_hash(token), now(), '{}', None))
        return {'user_id': uid, 'token': token}

    def user_by_token(self, token):
        user = self.sql('SELECT * FROM users WHERE token_hash=?', (token_hash(token),), one=True)
        if user:
            return user
        session = self.sql('SELECT user_id FROM sessions WHERE token_hash=?', (token_hash(token),), one=True)
        return self.get_user(session['user_id']) if session else None

    def set_password(self, uid, email, password):
        """Attach an email and password to this account. False when the email belongs to another account."""
        email = email.strip().lower()
        owner = self.sql('SELECT user_id FROM credentials WHERE email=?', (email,), one=True)
        if owner and owner['user_id'] != uid:
            return False
        self.sql('DELETE FROM credentials WHERE user_id=?', (uid,))
        self.sql('INSERT INTO credentials VALUES(?,?,?,?)', (email, uid, password_hash(password), now()))
        return True

    def get_situation(self, uid):
        row = self.sql('SELECT data_json FROM situations WHERE user_id=?', (uid,), one=True)
        return json.loads(row['data_json']) if row else None

    def set_situation(self, uid, data):
        self.sql('INSERT INTO situations VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json, '
                 'updated_at=excluded.updated_at', (uid, json.dumps(data), now()))
        return data

    def email_of(self, uid):
        row = self.sql('SELECT email FROM credentials WHERE user_id=?', (uid,), one=True)
        return row['email'] if row else None

    def login(self, email, password):
        """A new browser token for the account behind this email and password, or None."""
        row = self.sql('SELECT user_id, pw_hash FROM credentials WHERE email=?', (email.strip().lower(),), one=True)
        if not row or not password_ok(password, row['pw_hash']):
            return None
        token = secrets.token_urlsafe(32)
        self.sql('INSERT INTO sessions VALUES(?,?,?)', (token_hash(token), row['user_id'], now()))
        return {'user_id': row['user_id'], 'token': token}

    def get_user(self, uid):
        return self.sql('SELECT * FROM users WHERE id=?', (uid,), one=True)

    def create_pair_code(self, uid):
        expiry = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        with self.lock:
            self.sql('DELETE FROM pair_codes WHERE user_id=? OR expires_at<?', (uid, now()))
            for _ in range(100):
                code = str(secrets.randbelow(900000) + 100000)
                rows = self.sql('INSERT INTO pair_codes VALUES(?,?,?) ON CONFLICT(code) DO NOTHING RETURNING code', (code, uid, expiry))
                if rows:
                    return {'code': code, 'expires_at': expiry}
        raise RuntimeError('Unable to allocate pairing code')

    @staticmethod
    def _link_cipher(code, salt):
        from cryptography.fernet import Fernet
        # The short code is a temporary password. Keep the bearer token out of
        # plaintext storage; online guesses are separately API-limited.
        key = hashlib.scrypt(code.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32)
        return Fernet(base64.urlsafe_b64encode(key))

    def create_link_code(self, uid, token):
        user = self.user_by_token(token)
        if not user or user['id'] != uid:
            raise ValueError('Invalid link identity')
        expiry = (datetime.now(timezone.utc) + timedelta(seconds=600)).isoformat()
        with self.lock:
            self.sql('DELETE FROM device_link_codes WHERE user_id=? OR expires_at<=?', (uid, now()))
            for _ in range(100):
                code = f'{secrets.randbelow(1000000):06d}'
                salt = secrets.token_hex(16)
                sealed = self._link_cipher(code, salt).encrypt(token.encode()).decode()
                rows = self.sql('INSERT INTO device_link_codes VALUES(?,?,?,?,?) ON CONFLICT(code_hash) DO NOTHING RETURNING code_hash',
                                (token_hash(code), uid, sealed, salt, expiry))
                if rows:
                    return {'code': code, 'expires_in': 600}
        raise RuntimeError('Unable to allocate device code')

    def redeem_link_code(self, code):
        # DELETE RETURNING is atomic across connections/replicas on both engines.
        row = self.sql('DELETE FROM device_link_codes WHERE code_hash=? AND expires_at>? RETURNING user_id,sealed_token,salt',
                       (token_hash(code), now()), one=True)
        if not row:
            return None
        from cryptography.fernet import InvalidToken
        try:
            token = self._link_cipher(code, row['salt']).decrypt(row['sealed_token'].encode()).decode()
        except (InvalidToken, ValueError):
            return None
        user = self.user_by_token(token)
        return token if user and user['id'] == row['user_id'] else None

    def link_number(self, code, number):
        # Consume the code atomically so only one delivery can use it.
        with self.lock:
            row = self.sql('DELETE FROM pair_codes WHERE code=? AND expires_at>? RETURNING user_id', (code, now()), one=True)
            if not row:
                return False
            self.sql('UPDATE users SET wa_number=NULL WHERE wa_number=?', (number,))
            self.sql('UPDATE users SET wa_number=? WHERE id=?', (number, row['user_id']))
            return True

    def count_code_try(self, scope, limit, seconds):
        """Take one code try for scope; False once its window already holds `limit`. One upsert, so concurrent
        tries on any replica never pass the limit. A window starts with its first try and lasts `seconds`."""
        current = datetime.now(timezone.utc)
        expired = (current - timedelta(seconds=seconds)).isoformat()
        row = self.sql('INSERT INTO code_tries VALUES(?,?,1) ON CONFLICT(scope) DO UPDATE SET '
                       'tries=CASE WHEN code_tries.window_start<=? THEN 1 ELSE code_tries.tries+1 END, '
                       'window_start=CASE WHEN code_tries.window_start<=? THEN excluded.window_start ELSE code_tries.window_start END '
                       'RETURNING tries', (scope, current.isoformat(), expired, expired), one=True)
        return row['tries'] <= limit

    def refund_code_try(self, scope):
        """A try that was not a wrong code (the right one, or one refused elsewhere) does not count."""
        self.sql('UPDATE code_tries SET tries=tries-1 WHERE scope=? AND tries>0', (scope,))

    def find_user_by_number(self, number):
        return self.sql('SELECT * FROM users WHERE wa_number=?', (number,), one=True)

    def claim_whatsapp_message(self, message_id):
        return bool(self.sql('INSERT INTO wa_seen VALUES(?,?) ON CONFLICT(message_id) DO NOTHING RETURNING message_id',
                             (message_id, now())))

    def approve_execution(self, tid, previous):
        if not previous or previous.get('status') != 'awaiting_approval' or previous.get('approval_decision') is not None:
            return False
        return self.start_execution(tid, {**previous, 'approval_decision': 'approved'}, previous)

    @staticmethod
    def decode_task(row):
        if row is None:
            return None
        for key in ('page', 'research', 'execution'):
            raw = row.pop(key + '_json')
            row[key] = json.loads(raw) if raw is not None else None
        row['channel'] = row['source']
        row['lang'] = row.get('lang') or detect(row['task']) or 'en'  # detection only for rows older than the column
        return row

    def create_task(self, uid, task, page, mode, research, source='extension'):
        tid, at = 't_' + uuid.uuid4().hex, now()
        self.sql('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                 (tid, uid, source, mode, task, json.dumps(page), json.dumps(research), None, at, at, detect(task) or 'en'))
        return self.get_task(tid)

    def get_task(self, tid):
        return self.decode_task(self.sql('SELECT * FROM tasks WHERE id=?', (tid,), one=True))

    def list_tasks(self, uid, limit=30):
        return [self.decode_task(r) for r in self.sql('SELECT * FROM tasks WHERE user_id=? ORDER BY created_at DESC LIMIT ?', (uid, limit))]

    def update_research(self, tid, research, expected=None):
        query = 'UPDATE tasks SET research_json=?, updated_at=? WHERE id=?'
        params = (json.dumps(research), now(), tid)
        if expected is not None:
            query += ' AND research_json=?'
            params += (json.dumps(expected),)
        changed = bool(self.sql(query + ' RETURNING id', params))
        if changed and research.get('status') == 'failed':
            self.record_failure(tid, 'research', 'Research failed.')
        return changed

    def update_execution(self, tid, execution):
        if execution.get('status') == 'failed':
            self.record_failure(tid, 'execution', 'Execution failed.')
        self.sql('UPDATE tasks SET execution_json=?, updated_at=? WHERE id=?', (json.dumps(execution), now(), tid))

    def start_execution(self, tid, execution, previous):
        query = 'UPDATE tasks SET execution_json=?, updated_at=? WHERE id=? AND '
        params = (json.dumps(execution), now(), tid)
        if previous is None:
            query += 'execution_json IS NULL'
        else:
            query += 'execution_json=?'
            params += (json.dumps(previous),)
        return bool(self.sql(query + ' RETURNING id', params))

    def patch_execution(self, tid, patch=None, step=None, shot=None, message=None):
        # A row lock protects approval decisions from concurrent sandbox steps.
        with self.lock:
            if self.postgres:
                with self.transaction():
                    row = self.sql('SELECT execution_json FROM tasks WHERE id=? FOR UPDATE', (tid,), one=True)
                    return self._patch_execution(tid, row, patch, step, shot, message)
            row = self.sql('SELECT execution_json FROM tasks WHERE id=?', (tid,), one=True)
            return self._patch_execution(tid, row, patch, step, shot, message)

    def _patch_execution(self, tid, row, patch, step, shot, message=None):
        execution = json.loads(row['execution_json'] or '{}')
        stopped = execution.get('approval_decision') == 'stopped'
        execution.update(patch or {})
        if stopped:
            execution['approval_decision'] = 'stopped'
            if execution.get('status') in {'starting', 'running', 'awaiting_approval', 'submitting'}:
                execution['status'] = 'stopped'
        if step:
            execution.setdefault('steps', []).append(step)
        if shot:
            execution.setdefault('shots', []).append(shot)
        if message:
            # Messages the user sends to a running sandbox (extension or WhatsApp); read by the agent between steps.
            execution.setdefault('inbox', []).append(message)
        self.update_execution(tid, execution)
        return execution

    def recent_research(self, uid, task, mode, effort, since, known_details=()):
        """This user's latest completed research for the same errand words, effort and saved detail names (no page,
        no follow-up)."""
        wanted = ' '.join(task.lower().split())
        rows = self.sql("SELECT task, research_json, created_at FROM tasks WHERE user_id=? AND mode=? AND page_json='null' "
                        'AND created_at>=? ORDER BY created_at DESC LIMIT 200', (uid, mode, since))
        for row in rows:
            research = json.loads(row['research_json'])
            if (' '.join(row['task'].lower().split()) == wanted and research.get('status') == 'completed'
                    and research.get('effort', 'low') == effort
                    and sorted(set(research.get('known_details') or ())) == sorted(set(known_details))
                    and research.get('output') and not (research.get('question') or {}).get('answer')):
                return research, row['created_at']
        return None

    def daily_spend(self, uid=None):
        """Today's research cost for one user, or for everyone when uid is None."""
        today = datetime.now(timezone.utc).date().isoformat()
        if uid is None:
            rows = self.sql('SELECT research_json FROM tasks WHERE created_at>=?', (today,))
        else:
            rows = self.sql('SELECT research_json FROM tasks WHERE user_id=? AND created_at>=?', (uid, today))
        return math.fsum(float(json.loads(r['research_json']).get('cost') or 0) for r in rows)

    def record_failure(self, tid, stage, error):
        messages = {
            'research': 'Research failed.',
            'research.poll': 'Research service is temporarily unavailable.',
            'research.events': 'Research progress is temporarily unavailable.',
            'execution': 'Execution failed.',
            'watch.create': 'Recurring search setup failed.',
            'watch.delete': 'Could not remove recurring search. Please retry.',
        }
        # A stable primary key makes concurrent inserts idempotent across workers.
        failure_id = hashlib.sha256(json.dumps([tid, stage]).encode()).hexdigest()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        with self.lock:
            self.sql('DELETE FROM failures WHERE at<?', (cutoff,))
            self.sql('INSERT INTO failures SELECT ?,?,?,?,? '
                     'WHERE NOT EXISTS (SELECT 1 FROM failures WHERE task_id=? AND stage=?) '
                     'ON CONFLICT DO NOTHING',
                     (failure_id, tid, stage, messages.get(stage, 'Task failed.'), now(), tid, stage))

    def recent_failures(self, uid):
        return self.sql('SELECT f.task_id,f.stage,f.error,f.at FROM failures f JOIN tasks t ON t.id=f.task_id '
                        'WHERE t.user_id=? ORDER BY f.at DESC LIMIT 30', (uid,))

    def create_watch(self, uid, query, monitor_id=None, task_id=None):
        wid = 'w_' + uuid.uuid4().hex
        with self.transaction():
            self.sql('INSERT INTO watches(id,user_id,query,exa_monitor_id,created_at) VALUES(?,?,?,?,?)', (wid, uid, query, monitor_id, now()))
            self.sql('INSERT INTO watch_details VALUES(?,?,?)', (wid, task_id, ''))
        return self.get_watch(wid)

    def get_watch(self, wid):
        return self.sql('SELECT w.*,d.task_id,d.secret FROM watches w LEFT JOIN watch_details d ON d.watch_id=w.id WHERE w.id=?',
                        (wid,), one=True)

    def reserve_watch_slot(self, uid, wid):
        # Unique SQL keys enforce the paid limit across workers, not just threads.
        for slot in range(3):
            if self.sql('INSERT INTO watch_slots VALUES(?,?,?) ON CONFLICT DO NOTHING RETURNING slot', (uid, slot, wid)):
                return True
        return False

    def release_watch_slot(self, wid):
        self.sql('DELETE FROM watch_slots WHERE watch_id=?', (wid,))

    def activate_watch(self, wid, monitor_id, secret):
        with self.transaction():
            self.sql('UPDATE watches SET exa_monitor_id=? WHERE id=?', (monitor_id, wid))
            self.sql('UPDATE watch_details SET secret=? WHERE watch_id=?', (secret, wid))

    def request_check(self, wid, requested=True):
        # A user-asked run: its next completed delivery always replies, even with nothing new.
        self.sql('UPDATE watches SET check_requested_at=? WHERE id=?', (now() if requested else None, wid))

    def take_check(self, wid):
        """Clear a requested check; True for the one delivery that clears it."""
        return bool(self.sql('UPDATE watches SET check_requested_at=NULL WHERE id=? AND check_requested_at IS NOT NULL '
                             'RETURNING id', (wid,)))

    def list_watches(self, uid):
        watches = self.sql('SELECT * FROM watches WHERE user_id=? ORDER BY created_at DESC', (uid,))
        for watch in watches:
            updates = self.sql('SELECT event_id,data_json,seen FROM watch_updates WHERE watch_id=? ORDER BY event_id', (watch['id'],))
            watch['updates'] = [{**json.loads(r['data_json']), 'id': r['event_id'], 'seen': bool(r['seen'])} for r in updates]
            watch['unseen_count'] = sum(not u['seen'] for u in watch['updates'])
        return watches

    def add_watch_update(self, watch, event_id, update):
        # Event deduplication and the task write must commit together.
        with self.transaction():
            return self._add_watch_update(watch, event_id, update)

    def _add_watch_update(self, watch, event_id, update):
        suffix = ' FOR UPDATE' if self.postgres else ''
        if not self.sql('SELECT id FROM watches WHERE id=?' + suffix, (watch['id'],), one=True):
            return False
        task = self.get_task(watch['task_id']) if watch.get('task_id') else None
        if task and self.postgres:
            self.sql('SELECT id FROM tasks WHERE id=? FOR UPDATE', (task['id'],))
            task = self.get_task(task['id'])
        if not self.sql('INSERT INTO watch_updates VALUES(?,?,?,0) ON CONFLICT DO NOTHING RETURNING event_id',
                        (watch['id'], event_id, json.dumps(update))):
            return False
        if task:
            research = task['research']
            research.setdefault('updates', []).append(update)
            output = research.get('output') or {}
            research['output'] = output
            output['text'] = (output.get('text', '') + '\n' + update['text']).strip()
            output.setdefault('grounding', []).append({'field': 'updates', 'citations': update['sources']})
            self.update_research(task['id'], research)
        return True

    def see_watch_updates(self, uid, wid):
        watch = self.get_watch(wid)
        if not watch or watch['user_id'] != uid:
            return False
        self.sql('UPDATE watch_updates SET seen=1 WHERE watch_id=?', (wid,))
        return True

    def delete_watch(self, uid, wid):
        with self.transaction():
            if not self.sql('DELETE FROM watches WHERE id=? AND user_id=? RETURNING id', (wid, uid)):
                return False
            for table in ('watch_details', 'watch_slots', 'watch_updates'):
                self.sql('DELETE FROM ' + table + ' WHERE watch_id=?', (wid,))
            return True

    def put_shot(self, tid, n, jpeg):
        self.sql('INSERT INTO shots VALUES(?,?,?) ON CONFLICT(task_id,n) DO UPDATE SET jpeg=excluded.jpeg', (tid, n, jpeg))

    def get_shot(self, tid, n):
        row = self.sql('SELECT jpeg FROM shots WHERE task_id=? AND n=?', (tid, n), one=True)
        return bytes(row['jpeg']) if row else None

    def put_live_frame(self, tid, jpeg):
        # Only the newest frame of a running sandbox is kept.
        self.sql('INSERT INTO live_frames VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET jpeg=excluded.jpeg, updated_at=excluded.updated_at', (tid, jpeg, now()))

    def get_live_frame(self, tid):
        row = self.sql('SELECT jpeg FROM live_frames WHERE task_id=?', (tid,), one=True)
        return bytes(row['jpeg']) if row else None

    HANDOFF_SECONDS = 900

    def put_handoff(self, tid, url, cookies):
        current = datetime.now(timezone.utc)
        self.sql('DELETE FROM handoffs WHERE expires_at<=?', (current.isoformat(),))
        expires = (current + timedelta(seconds=self.HANDOFF_SECONDS)).isoformat()
        self.sql('INSERT INTO handoffs VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET data_json=excluded.data_json, '
                 'expires_at=excluded.expires_at', (tid, json.dumps({'url': url, 'cookies': cookies}), expires))

    def take_handoff(self, tid):
        """One fetch only: DELETE RETURNING is atomic on both engines, and an expired hand-off is gone too."""
        row = self.sql('DELETE FROM handoffs WHERE task_id=? RETURNING data_json, expires_at', (tid,), one=True)
        return json.loads(row['data_json']) if row and row['expires_at'] > now() else None

    def handoff_live(self, tid):
        return bool(self.sql('SELECT 1 AS x FROM handoffs WHERE task_id=? AND expires_at>?', (tid, now()), one=True))

    def close(self):
        self.connection.close()


class SQLiteStore(Store):
    def __init__(self, path='vali.db'):
        conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        super().__init__(conn)


# Modal's egress can silently drop an idle DB socket; without these a query sent into it
# waits for kernel retransmits (~15 min) while holding the store lock.
PG_SOCKET_OPTIONS = dict(connect_timeout=10, keepalives=1, keepalives_idle=30, keepalives_interval=10,
                         keepalives_count=3, tcp_user_timeout=15000)


class PostgresStore(Store):
    postgres = True

    def __init__(self, database_url, connect=None):
        self.database_url = database_url
        self._connect_fn = connect
        super().__init__(self._connect())

    def _connect(self):
        if self._connect_fn:
            return self._connect_fn()
        import psycopg
        from psycopg.rows import dict_row
        return psycopg.connect(self.database_url, autocommit=True, row_factory=dict_row, **PG_SOCKET_OPTIONS)

    def _reopen(self):
        try:
            self.connection.close()
        except Exception:
            pass
        self.connection = self._connect()

    def _ensure_connected(self):
        if self.connection.closed and not self.in_transaction:
            self._reopen()

    def _reconnect_after(self, exc):
        import psycopg
        # Retry once only when the socket itself died outside a transaction.
        if isinstance(exc, psycopg.OperationalError) and self.connection.closed and not self.in_transaction:
            self._reopen()
            return True
        return False


def make_store(config):
    return PostgresStore(config.database_url) if config.database_url else SQLiteStore(config.sqlite_path)
