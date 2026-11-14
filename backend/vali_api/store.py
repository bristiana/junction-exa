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


def now():
    return datetime.now(timezone.utc).isoformat()


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


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
            'device_link_codes(code_hash TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL, sealed_token TEXT NOT NULL, salt TEXT NOT NULL, expires_at TEXT NOT NULL)',
            'tasks(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source TEXT NOT NULL, mode TEXT NOT NULL, task TEXT NOT NULL, page_json TEXT NOT NULL, research_json TEXT NOT NULL, execution_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
            'watches(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, query TEXT NOT NULL, exa_monitor_id TEXT, created_at TEXT NOT NULL)',
            'watch_details(watch_id TEXT PRIMARY KEY, task_id TEXT, secret TEXT NOT NULL)',
            'watch_slots(user_id TEXT NOT NULL, slot INTEGER NOT NULL, watch_id TEXT UNIQUE NOT NULL, PRIMARY KEY(user_id,slot))',
            'watch_updates(watch_id TEXT NOT NULL, event_id TEXT NOT NULL, data_json TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(watch_id,event_id))',
            'failures(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, stage TEXT NOT NULL, error TEXT NOT NULL, at TEXT NOT NULL)',
            f'shots(task_id TEXT NOT NULL, n INTEGER NOT NULL, jpeg {blob} NOT NULL, PRIMARY KEY(task_id,n))',
            f'live_frames(task_id TEXT PRIMARY KEY, jpeg {blob} NOT NULL, updated_at TEXT NOT NULL)']
        for table in tables:
            self.sql('CREATE TABLE IF NOT EXISTS ' + table)

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
        return self.sql('SELECT * FROM users WHERE token_hash=?', (token_hash(token),), one=True)

    def get_user(self, uid):
        return self.sql('SELECT * FROM users WHERE id=?', (uid,), one=True)

    def set_profile(self, uid, profile):
        self.sql('UPDATE users SET profile_json=? WHERE id=?', (json.dumps(profile), uid))

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
        return row

    def create_task(self, uid, task, page, mode, research, source='extension'):
        tid, at = 't_' + uuid.uuid4().hex, now()
        self.sql('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)',
                 (tid, uid, source, mode, task, json.dumps(page), json.dumps(research), None, at, at))
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

    def daily_spend(self, uid):
        today = datetime.now(timezone.utc).date().isoformat()
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
            self.sql('INSERT INTO watches VALUES(?,?,?,?,?)', (wid, uid, query, monitor_id, now()))
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
