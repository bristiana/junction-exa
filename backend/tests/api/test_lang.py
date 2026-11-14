"""Errand language detection and the answer-language instruction."""
import pytest

from vali_api.lang import detect
from vali_api.research import build_query


@pytest.mark.parametrize('text,code', [
    ('cum îmi schimb adresa după ce m-am mutat în Helsinki', 'ro'),
    ('unde pot face o programare la medic', 'ro'),
    ('як зареєструвати нову адресу в Гельсінкі', 'uk'),
    ('как продлить вид на жительство', 'ru'),
    ('kela opintotuki kuinka paljon', 'fi'),
    ('mitä maksaa HSL kuukausilippu opiskelijalle', 'fi'),
    ('terveysasema Oulu ajanvaraus', 'fi'),
    ('tandläkare i Helsingfors akut', 'sv'),
    ('wie kann ich meine Adresse ändern', 'de'),
    ('is a 10% rent increase legal in Finland', 'en'),
    ('how do i regster a change of adress', 'en'),
    ('Kela', None), ('sauna', None)])
def test_detect(text, code):
    assert detect(text) == code


def test_errand_language_wins_and_profile_fills_in_when_unknown():
    assert 'Answer in: Romanian.' in build_query('cum îmi schimb adresa în Helsinki', profile={'language': 'English'})
    assert 'Answer in: Ukrainian.' in build_query('Kela', profile={'language': 'Ukrainian'})


def test_query_asks_for_the_errand_language_and_finnish_or_english_sources():
    query = build_query('як зареєструвати нову адресу в Гельсінкі')
    assert 'Answer in: Ukrainian.' in query and 'search and read sources in Finnish or English' in query
    assert 'Answer in' not in build_query('sauna')


def test_task_carries_lang():
    from vali_api.store import SQLiteStore
    store = SQLiteStore(':memory:')
    task = store.create_task('u_1', 'cum îmi schimb adresa în Helsinki', None, 'check', {})
    assert task['lang'] == 'ro' and store.create_task('u_1', 'sauna', None, 'book', {})['lang'] == 'en'
    store.close()


def test_a_tie_is_no_evidence():
    assert detect('la') is None  # French and Spanish tie


def test_lang_column_is_added_to_an_old_tasks_table(tmp_path):
    import sqlite3
    from vali_api.store import SQLiteStore
    path = str(tmp_path / 'old.db')
    old = sqlite3.connect(path)
    old.execute('CREATE TABLE tasks(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source TEXT NOT NULL, mode TEXT NOT NULL, '
                'task TEXT NOT NULL, page_json TEXT NOT NULL, research_json TEXT NOT NULL, execution_json TEXT, '
                'created_at TEXT NOT NULL, updated_at TEXT NOT NULL)')
    old.execute("INSERT INTO tasks VALUES('t_old','u','extension','check','kela opintotuki kuinka paljon','null','{}',NULL,'x','x')")
    old.commit()
    old.close()
    store = SQLiteStore(path)
    assert store.get_task('t_old')['lang'] == 'fi'
    assert store.create_task('u', 'як зареєструвати адресу', None, 'check', {})['lang'] == 'uk'
    store.close()
