"""Offline multipart and device handoff contracts, including real media adapters."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image
from pypdf import PdfWriter

from test_api import api
from vali_api.app import poll_research_once
from vali_api.store import SQLiteStore, token_hash
from vali_media import letters, voice


@pytest.fixture
def media(api, monkeypatch):
    client, application, *_ = api
    application.state.config.elevenlabs_api_key = 'fake-voice'
    application.state.config.anthropic_api_key = 'fake-vision'
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'fake-voice')
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'fake-vision')
    return api


@pytest.mark.parametrize('mime', ['audio/webm', 'audio/ogg; codecs=opus', 'audio/mp4', 'audio/m4a', 'audio/wav'])
@pytest.mark.parametrize('create', [None, '1'])
def test_voice_provider_and_task(media, monkeypatch, mime, create):
    client, app, store, *_ = media
    original = voice.transcribe
    def provider(request):
        assert request.headers['xi-api-key'] == 'fake-voice'
        assert b'original-audio' in request.content
        return httpx.Response(200, json={'text': 'find a sauna'})
    monkeypatch.setattr(voice, 'transcribe', lambda data, mime, **kwargs: original(data, mime, **kwargs, transport=httpx.MockTransport(provider)))
    app.state.limiter.user_limit = 1
    response = client.post('/v1/voice', files={'audio': ('voice', b'original-audio', mime)}, data={'create': create} if create else {})
    assert response.status_code == 200
    result = response.json()
    assert result['text'] == 'find a sauna'
    if create:
        assert result['task'] == result['text'] and result['research']['status'] == 'completed'
        assert store.get_task(result['id'])['task'] == result['text']
    else:
        assert result == {'text': 'find a sauna'}
    assert client.post('/v1/tasks', json={'task': 'find sauna'}).status_code == 429


def image_bytes(size, fmt):
    stream = BytesIO()
    Image.new('RGB', size, 'white').save(stream, format=fmt)
    return stream.getvalue()


def fake_claude(monkeypatch, *, invalid=False):
    captured = []
    class Claude:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        @property
        def messages(self):
            return self
        def create(self, **kwargs):
            captured.append(kwargs['messages'][0]['content'])
            raw = 'not-json' if invalid else json.dumps({'text': 'Aino Example rent rises to 850 EUR on 1.1.2027.\nErrand: Check the rent increase', 'redactions': {'Aino Example': '{{name}}'}})
            return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=raw)])
    monkeypatch.setattr(letters.anthropic, 'Anthropic', Claude)
    return captured


@pytest.mark.parametrize('mime', ['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
@pytest.mark.parametrize('note', [None, 'Check whether this rent increase is allowed'])
def test_letter_image_provider_and_context(media, monkeypatch, mime, note):
    client, app, store, calls, *_ = media
    captured = fake_claude(monkeypatch)
    image = Image.new('RGB', (20, 20), 'white')
    stream = BytesIO()
    if mime == 'image/heic':
        import pillow_heif
        pillow_heif.from_pillow(image).save(stream)
    else:
        image.save(stream, format={'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WEBP'}[mime])
    response = client.post('/v1/letters', files={'file': ('private-filename', stream.getvalue(), mime)}, data={'note': note} if note else {})
    assert response.status_code == 200
    task = response.json()
    assert task['task'] == (note or 'Explain this letter and tell me what to do')
    assert task['page']['title'] == 'Uploaded letter' and task['page']['url'] == ''
    assert task['page']['text'] == task['page']['selection']
    assert '{{name}}' in task['page']['text'] and '850 EUR' in task['page']['text']
    assert 'Aino Example' not in json.dumps(task) and 'private-filename' not in json.dumps(task)
    assert captured[0][0]['source']['media_type'] == ('image/jpeg' if mime == 'image/heic' else mime)
    assert ' '.join(task['page']['selection'].split()) in calls[-1][2]['query']
    poll_research_once(task['id'], app)
    assert store.get_task(task['id'])['research']['output']['structured']['answer']


def text_pdf():
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    writer = PdfWriter()
    page = writer.add_blank_page(width=400, height=400)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
    stream = DecodedStreamObject()
    stream.set_data(b'BT /F1 12 Tf 20 300 Td (Aino Example rent 850 EUR) Tj ET')
    page[NameObject('/Contents')] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def test_pdf_extracts_then_redacts(media, monkeypatch):
    captured = fake_claude(monkeypatch)
    response = media[0].post('/v1/letters', files={'file': ('letter.pdf', text_pdf(), 'application/pdf')})
    assert response.status_code == 200
    assert 'Aino Example rent 850 EUR' in captured[0][0]['text']
    assert 'Aino Example' not in json.dumps(response.json())
    assert '{{name}}' in response.json()['page']['text']


@pytest.mark.parametrize('path,field,mime', [('/v1/voice', 'audio', 'audio/wav'), ('/v1/letters', 'file', 'image/png')])
@pytest.mark.parametrize('kind,status', [('empty', 400), ('large', 413), ('type', 415), ('auth', 401), ('config', 503), ('cap', 429), ('rate', 429)])
def test_upload_guards(media, monkeypatch, path, field, mime, kind, status):
    client, app, *_ = media
    def forbidden(*args, **kwargs):
        pytest.fail('provider called before guard')
    monkeypatch.setattr(voice, 'transcribe', forbidden)
    monkeypatch.setattr(letters, 'read_letter', forbidden)
    data = b'audio-or-image'
    if kind == 'empty':
        data = b''
    elif kind == 'large':
        data = b'x' * (10 * 1024 * 1024 + 1)
    elif kind == 'type':
        mime = 'text/plain'
    elif kind == 'auth':
        del client.headers['Authorization']
    elif kind == 'config':
        app.state.config.elevenlabs_api_key = app.state.config.anthropic_api_key = ''
    elif kind == 'cap':
        app.state.config.daily_cap_usd = 0
    elif kind == 'rate':
        app.state.limiter.user_limit = 0
    assert client.post(path, files={field: ('file', data, mime)}).status_code == status


def test_provider_errors_are_safe(media, monkeypatch):
    client = media[0]
    def fail(*args, **kwargs):
        raise voice.VoiceError('private provider payload')
    monkeypatch.setattr(voice, 'transcribe', fail)
    response = client.post('/v1/voice', files={'audio': ('a.wav', b'audio', 'audio/wav')})
    assert response.status_code == 502 and 'private' not in response.text
    fake_claude(monkeypatch, invalid=True)
    response = client.post('/v1/letters', files={'file': ('a.png', image_bytes((20, 20), 'PNG'), 'image/png')})
    assert response.status_code == 502
    assert not client.get('/v1/tasks').json()['tasks']


@pytest.mark.parametrize('transcript,status', [('', 400), ('   ', 400), ('x' * 20001, 422)])
def test_bad_transcript(media, monkeypatch, transcript, status):
    monkeypatch.setattr(voice, 'transcribe', lambda *args, **kwargs: transcript)
    assert media[0].post('/v1/voice', files={'audio': ('a', b'audio', 'audio/ogg')}, data={'create': '1'}).status_code == status


@pytest.mark.parametrize('mime,data', [('application/pdf', b'not-pdf'), ('image/heic', b'not-heic')])
def test_invalid_documents(media, mime, data):
    assert media[0].post('/v1/letters', files={'file': ('file', data, mime)}).status_code == 400


def test_scanned_pdf_rejected(media):
    writer, output = PdfWriter(), BytesIO()
    writer.add_blank_page(width=100, height=100)
    writer.write(output)
    assert media[0].post('/v1/letters', files={'file': ('file', output.getvalue(), 'application/pdf')}).status_code == 400


def test_device_link_same_identity_once_and_private(api, caplog):
    client, app, store, *_, user = api
    code = client.post('/v1/link/code').json()
    assert len(code['code']) == 6 and code['code'].isdigit() and code['expires_in'] == 600
    row = store.sql('SELECT * FROM device_link_codes', one=True)
    assert row['code_hash'] == token_hash(code['code'])
    assert code['code'] not in row.values() and user['token'] not in row.values()
    del client.headers['Authorization']
    response = client.post('/v1/link', json={'code': code['code']})
    assert response.json() == {'token': user['token']}
    assert response.headers['cache-control'] == 'no-store'
    assert client.post('/v1/link', json={'code': code['code']}).status_code == 404
    client.headers['Authorization'] = 'Bearer ' + response.json()['token']
    assert client.get('/v1/me').json()['user_id'] == user['user_id']
    assert code['code'] not in caplog.text and user['token'] not in caplog.text


def test_device_expiry_replacement_auth_and_limits(api):
    client, app, store, *_ = api
    old = client.post('/v1/link/code').json()['code']
    code = client.post('/v1/link/code').json()['code']
    assert client.post('/v1/link', json={'code': old}).status_code == 404
    store.sql('UPDATE device_link_codes SET expires_at=?', ('2000-01-01T00:00:00+00:00',))
    assert client.post('/v1/link', json={'code': code}).status_code == 404
    del client.headers['Authorization']
    assert client.post('/v1/link/code').status_code == 401
    for _ in range(3):  # two wrong codes above, five in all, then a 15-minute lockout
        assert client.post('/v1/link', json={'code': '000000'}).status_code == 404
    locked = client.post('/v1/link', json={'code': '000000'})
    assert locked.status_code == 429 and 'wrong codes' in locked.json()['detail'] and int(locked.headers['retry-after']) > 800


def test_device_issuance_limit(api):
    client, *_ = api
    for _ in range(10):
        assert client.post('/v1/link/code').status_code == 200
    assert client.post('/v1/link/code').status_code == 429


def test_device_leading_zero_and_concurrent_redeem(api, monkeypatch):
    client, app, store, *_, user = api
    monkeypatch.setattr('vali_api.store.secrets.randbelow', lambda _: 123)
    code = client.post('/v1/link/code').json()['code']
    assert code == '000123'
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(store.redeem_link_code, [code, code]))
    assert results.count(user['token']) == 1 and results.count(None) == 1


def test_device_code_survives_store_restart(tmp_path):
    path = str(tmp_path / 'link.db')
    store = SQLiteStore(path)
    user = store.create_user()
    code = store.create_link_code(user['user_id'], user['token'])['code']
    store.close()
    store = SQLiteStore(path)
    assert store.redeem_link_code(code) == user['token']
    store.close()


def test_golden_letter_offline(media, monkeypatch):
    import importlib.util
    script = Path(__file__).resolve().parents[3] / 'scripts' / 'golden.py'
    spec = importlib.util.spec_from_file_location('golden_inputs', script)
    golden = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(golden)
    client, app, *_ = media
    fake_claude(monkeypatch)
    app.state.spawn_research_poller = lambda tid: poll_research_once(tid, app)
    async def run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url='http://test', headers=dict(client.headers)) as http:
            result = await golden.letter(http, golden.Errand('letter'))
            assert result.startswith('answer ')
    asyncio.run(run())


@pytest.mark.parametrize('path,field', [('/v1/voice', 'audio'), ('/v1/letters', 'file')])
def test_oversized_request_rejected_before_parsing(media, monkeypatch, path, field):
    from vali_api import uploads
    monkeypatch.setattr(uploads, 'read_upload', lambda *a, **k: pytest.fail('body parsed'))
    data = b'x' * (11 * 1024 * 1024 + 1)
    assert media[0].post(path, files={field: ('file', data, 'audio/wav')}).status_code == 413


@pytest.mark.parametrize('filename,mime,sent_name,sent_type', [
    ('voice.webm', 'audio/webm', 'voice.webm', 'audio/webm'),
    ('clip.m4a', 'application/octet-stream', 'voice.m4a', 'audio/mp4'),
    ('memo.caf', '', 'voice.caf', 'audio/x-caf'),
    ('memo', 'audio/x-caf', 'voice.caf', 'audio/x-caf'),
    ('x.m4a', 'audio/x-m4a', 'voice.m4a', 'audio/x-m4a'),
])
def test_voice_container_naming(media, monkeypatch, filename, mime, sent_name, sent_type):
    from email import policy
    from email.parser import BytesParser
    original = voice.transcribe
    seen = []
    def provider(request):
        message = BytesParser(policy=policy.default).parsebytes(
            b'Content-Type: ' + request.headers['content-type'].encode() + b'\r\n\r\n' + request.content)
        part = next(p for p in message.iter_parts() if p.get_param('name', header='content-disposition') == 'file')
        seen.append((part.get_filename(), part.get_content_type()))
        return httpx.Response(200, json={'text': 'hello'})
    monkeypatch.setattr(voice, 'transcribe', lambda data, mime, **kwargs: original(
        data, mime, **kwargs, transport=httpx.MockTransport(provider)))
    files = {'audio': (filename, b'audio', mime)} if mime else {'audio': (filename, b'audio')}
    response = media[0].post('/v1/voice', files=files)
    assert response.status_code == 200, response.text
    assert seen == [(sent_name, sent_type)]


def test_voice_unknown_generic_type_rejected(media):
    assert media[0].post('/v1/voice', files={'audio': ('voice.exe', b'x', 'application/octet-stream')}).status_code == 415


def test_image_pixel_cap(media, monkeypatch):
    from vali_api import uploads
    fake_claude(monkeypatch)
    monkeypatch.setattr(uploads, 'MAX_PIXELS', 100)
    response = media[0].post('/v1/letters', files={'file': ('a.png', image_bytes((20, 20), 'PNG'), 'image/png')})
    assert response.status_code == 413


def test_large_image_reencoded_as_jpeg(media, monkeypatch):
    import base64
    from vali_api import uploads
    captured = fake_claude(monkeypatch)
    monkeypatch.setattr(uploads, 'VISION_MAX_SIDE', 10)
    response = media[0].post('/v1/letters', files={'file': ('a.png', image_bytes((40, 20), 'PNG'), 'image/png')})
    assert response.status_code == 200
    source = captured[0][0]['source']
    assert source['media_type'] == 'image/jpeg'
    with Image.open(BytesIO(base64.b64decode(source['data']))) as image:
        assert image.format == 'JPEG' and max(image.size) <= 10


def test_small_image_passes_unchanged(media, monkeypatch):
    import base64
    captured = fake_claude(monkeypatch)
    data = image_bytes((20, 20), 'PNG')
    assert media[0].post('/v1/letters', files={'file': ('a.png', data, 'image/png')}).status_code == 200
    assert base64.b64decode(captured[0][0]['source']['data']) == data


@pytest.mark.parametrize('code', ['١٢٣٤٥٦', '12345', '1234567', '12a456'])
def test_link_code_ascii_digits_only(api, code):
    client = api[0]
    del client.headers['Authorization']
    assert client.post('/v1/link', json={'code': code}).status_code == 422
