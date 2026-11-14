"""One SQL store interface backed by SQLite locally or Postgres on Modal."""
import hashlib
import json
import math
import secrets
import sqlite3
import threading
import uuid
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
            'tasks(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source TEXT NOT NULL, mode TEXT NOT NULL, task TEXT NOT NULL, page_json TEXT NOT NULL, research_json TEXT NOT NULL, execution_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
            'watches(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, query TEXT NOT NULL, exa_monitor_id TEXT, created_at TEXT NOT NULL)',
            f'shots(task_id TEXT NOT NULL, n INTEGER NOT NULL, jpeg {blob} NOT NULL, PRIMARY KEY(task_id,n))',
            f'live_frames(task_id TEXT PRIMARY KEY, jpeg {blob} NOT NULL, updated_at TEXT NOT NULL)']
        for table in tables:
            self.sql('CREATE TABLE IF NOT EXISTS ' + table)

    def sql(self, query, params=(), one=False):
        with self.lock:
            cursor = self.connection.execute(query.replace('?', '%s') if self.postgres else query, params)
            rows = cursor.fetchall() if cursor.description else []
            return (dict(rows[0]) if rows else None) if one else [dict(r) for r in rows]

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
        return bool(self.sql(query + ' RETURNING id', params))

    def update_execution(self, tid, execution):
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
                with self.connection.transaction():
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

    def create_watch(self, uid, query, monitor_id=None):
        wid = 'w_' + uuid.uuid4().hex
        self.sql('INSERT INTO watches VALUES(?,?,?,?,?)', (wid, uid, query, monitor_id, now()))
        return self.sql('SELECT * FROM watches WHERE id=?', (wid,), one=True)

    def list_watches(self, uid):
        return self.sql('SELECT * FROM watches WHERE user_id=? ORDER BY created_at DESC', (uid,))

    def delete_watch(self, uid, wid):
        return bool(self.sql('DELETE FROM watches WHERE id=? AND user_id=? RETURNING id', (wid, uid)))

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
    def __init__(self, path='hoida.db'):
        conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        super().__init__(conn)


class PostgresStore(Store):
    postgres = True

    def __init__(self, database_url):
        import psycopg
        from psycopg.rows import dict_row
        super().__init__(psycopg.connect(database_url, autocommit=True, row_factory=dict_row))


def make_store(config):
    return PostgresStore(config.database_url) if config.database_url else SQLiteStore(config.sqlite_path)
