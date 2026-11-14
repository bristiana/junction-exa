"""Your situation: who the answers are for (EU or not, student, no personal ID yet), and the next errand."""
from test_api import api  # noqa: F401  (fixture)
from vali_api.research import build_query, build_run_request, describe_situation, map_find_output


def test_situation_is_saved_merged_and_shown_in_me(api):
    client, application, store, calls, polls, browsers, user = api
    assert client.get('/v1/me').json()['situation'] is None
    client.put('/v1/situation', json={'citizenship': 'eu', 'country': 'Romania', 'student': True, 'school': 'Aalto'})
    client.put('/v1/situation', json={'city': 'Espoo', 'has_personal_id': False})
    situation = client.get('/v1/me').json()['situation']
    assert situation == {'citizenship': 'eu', 'country': 'Romania', 'student': True, 'school': 'Aalto', 'city': 'Espoo', 'has_personal_id': False}
    assert client.put('/v1/situation', json={'citizenship': 'martian'}).status_code == 422


def test_research_query_carries_the_situation(api):
    client, application, store, calls, polls, browsers, user = api
    client.put('/v1/situation', json={'citizenship': 'non_eu', 'student': True, 'has_bank': False})
    client.post('/v1/tasks', json={'task': 'How do I open a bank account?'})
    queries = [body.get('query', '') for method, path, body in calls if method == 'POST' and isinstance(body, dict)]
    assert any('a non-EU citizen' in q and 'no Finnish bank account' in q for q in queries)


def test_situation_sentence_and_next_errand_schema():
    line = describe_situation({'citizenship': 'eu', 'country': 'Romania', 'student': True, 'school': 'Aalto', 'has_personal_id': False})
    assert line.startswith('The user is an EU/EEA citizen from Romania, a student at Aalto') and 'no Finnish personal identity code' in line
    assert describe_situation(None) == '' and describe_situation({'asked': True}) == ''
    assert build_query('x') == build_query('x', situation=None)  # the extension's port is unchanged
    assert 'next_errand' in build_run_request('x')['outputSchema']['properties']
    found = map_find_output({'output': {'content': {'answer': 'A €5', 'options': [], 'next_step': '', 'next_errand': 'Register at DVV'}}})
    assert found['structured']['next_errand'] == 'Register at DVV'
