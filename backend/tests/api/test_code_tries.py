"""Wrong pairing codes are counted in the store, so every replica sees the same lockout. Both engines."""
import shutil
import socket
import subprocess
import tempfile
import threading
from pathlib import Path

import pytest

from vali_api.store import PostgresStore, SQLiteStore


@pytest.fixture(scope='module')
def postgres_url():
    """A throwaway local Postgres, or a skip when this machine has none."""
    initdb, pg_ctl = shutil.which('initdb'), shutil.which('pg_ctl')
    if not (initdb and pg_ctl):
        pytest.skip('no local Postgres')
    folder = Path(tempfile.mkdtemp(prefix='vali-pg-'))
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    subprocess.run([initdb, '-D', str(folder / 'data'), '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True)
    options = f"-p {port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''"
    subprocess.run([pg_ctl, '-D', str(folder / 'data'), '-o', options, '-l', str(folder / 'log'), '-w', 'start'],
                   check=True, capture_output=True)
    try:
        yield f'postgresql://postgres@127.0.0.1:{port}/postgres'
    finally:
        subprocess.run([pg_ctl, '-D', str(folder / 'data'), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(folder, ignore_errors=True)


@pytest.fixture(params=['sqlite', 'postgres'])
def stores(request, tmp_path):
    """Two stores on one database, like two replicas."""
    if request.param == 'sqlite':
        made = [SQLiteStore(str(tmp_path / 'vali.db')) for _ in range(2)]
    else:
        url = request.getfixturevalue('postgres_url')
        made = [PostgresStore(url) for _ in range(2)]
        made[0].sql('DELETE FROM code_tries')
    yield made
    for store in made:
        store.close()


def test_tries_are_shared_and_reset_after_the_window(stores):
    first, second = stores
    assert [first.count_code_try('pair:1', 5, 900) for _ in range(3)] == [True] * 3
    assert [second.count_code_try('pair:1', 5, 900) for _ in range(3)] == [True, True, False]
    assert second.count_code_try('pair:2', 5, 900)  # another number has its own count
    first.sql('UPDATE code_tries SET window_start=? WHERE scope=?', ('2000-01-01T00:00:00+00:00', 'pair:1'))
    assert first.count_code_try('pair:1', 5, 900)


def test_a_right_code_gives_its_try_back(stores):
    first, second = stores
    for _ in range(5):
        assert first.count_code_try('pair:3', 5, 900)
    second.refund_code_try('pair:3')
    assert second.count_code_try('pair:3', 5, 900) and not first.count_code_try('pair:3', 5, 900)


def test_concurrent_tries_never_pass_the_limit(stores):
    results, start = [], threading.Barrier(20)

    def attempt(store):
        start.wait()
        results.append(store.count_code_try('pair:all', 7, 3600))
    threads = [threading.Thread(target=attempt, args=(stores[i % 2],)) for i in range(20)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert results.count(True) == 7
