from contextlib import nullcontext

import psycopg
import pytest

from vali_api.store import PG_SOCKET_OPTIONS, PostgresStore


class FakeCursor:
    description = None

    def fetchall(self):
        return []


class FakeConnection:
    """A Postgres connection whose socket can be made to die like Modal's dropped egress."""

    def __init__(self, log):
        self.closed = False
        self.dead = False
        self.log = log

    def execute(self, query, params=()):
        if self.dead:
            self.closed = True  # psycopg marks a connection closed once its socket fails
            raise psycopg.OperationalError('consuming input failed: Connection timed out')
        self.log.append((id(self), query))
        return FakeCursor()

    def close(self):
        self.closed = True


def make_store():
    log, connections = [], []

    def connect():
        connections.append(FakeConnection(log))
        return connections[-1]

    return PostgresStore('postgres://unused', connect=connect), connections, log


def test_dead_socket_reconnects_and_retries_once():
    store, connections, log = make_store()
    connections[0].dead = True
    store.sql('SELECT 1')
    assert len(connections) == 2
    assert log[-1] == (id(connections[1]), 'SELECT 1')


def test_closed_connection_is_reopened_before_use():
    store, connections, _ = make_store()
    connections[0].closed = True
    store.sql('SELECT 1')
    assert len(connections) == 2


def test_no_silent_retry_inside_a_transaction():
    store, connections, _ = make_store()
    connections[0].transaction = lambda: nullcontext()
    connections[0].dead = True
    with pytest.raises(psycopg.OperationalError):
        with store.transaction():
            store.sql('UPDATE tasks SET task=?', ('x',))
    assert len(connections) == 1
    assert store.in_transaction == 0


def test_other_errors_are_not_retried():
    store, connections, _ = make_store()

    def fail(query, params=()):
        raise psycopg.errors.UniqueViolation('duplicate')
    connections[0].execute = fail
    with pytest.raises(psycopg.errors.UniqueViolation):
        store.sql('INSERT INTO users VALUES(?)', ('u',))
    assert len(connections) == 1


def test_real_connect_sets_keepalives_and_send_timeout(monkeypatch):
    seen = {}

    def fake_connect(url, **kwargs):
        seen.update(kwargs)
        return FakeConnection([])
    monkeypatch.setattr(psycopg, 'connect', fake_connect)
    PostgresStore('postgres://unused')
    assert seen['keepalives'] == 1 and seen['keepalives_idle'] <= 60
    assert 0 < seen['tcp_user_timeout'] <= 30000 and seen['connect_timeout'] <= 15
    # libpq must accept every option, or connecting on Modal would fail outright.
    psycopg.conninfo.conninfo_to_dict(psycopg.conninfo.make_conninfo('dbname=x', **PG_SOCKET_OPTIONS))
