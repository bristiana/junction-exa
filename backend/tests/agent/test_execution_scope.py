from types import SimpleNamespace
from unittest.mock import Mock
import pytest
from vali_agent.browser import Browser
from vali_agent.privacy import substitute
from vali_agent.scope import registrable_domain, site, permitted_profile, reject_placeholders


@pytest.mark.parametrize('url,expected', [
    ('https://shop.example.co.uk/path', 'example.co.uk'),
    ('https://other.co.uk', 'other.co.uk'),
    ('https://alice.github.io', 'github.io'),
    ('https://a.example.com', 'example.com'),
    ('https://www.city.kawasaki.jp', 'kawasaki.jp'),
    ('https://a.b.ck', 'b.ck'), ('https://www.ck', 'www.ck'),
    ('http://127.0.0.1:80', '127.0.0.1'),
])
def test_registrable_site(url, expected):
    assert site(url) == expected


def test_navigation_allows_booking_provider_without_trusting_personal_fields():
    browser = Browser.__new__(Browser)
    browser._start_site = 'example.co.uk'
    browser._private_profile = {'email': 'secret@example.com'}
    assert browser._check_url('https://booking.example.org') == 'example.org'
    browser.page = Mock(url='https://redirect.example.org', is_closed=lambda: False)
    browser._popups = []
    browser._wait_quiet = lambda: None
    browser._settle()
    assert browser._start_site == 'example.co.uk'
    browser._refs = {'e1': SimpleNamespace(url=browser.page.url)}
    browser._element = lambda ref: Mock(evaluate=lambda script: True)
    with pytest.raises(ValueError, match='request_approval'):
        browser.personal_field('e1')
    browser.personal_field('e1', approved=True)
    with pytest.raises(ValueError, match='request_approval'):
        browser.personal_field('e1')
    with pytest.raises(ValueError, match='only allowed'):
        browser._check_url('https://booking.example.org/?email=secret@example.com')


def test_cross_site_link_without_personal_values_is_allowed():
    browser = Browser.__new__(Browser)
    browser._private_profile = {}
    browser.page = SimpleNamespace(url='https://example.com')
    element = Mock()
    element.evaluate.side_effect = ['https://provider.example.org', ('<a href="https://provider.example.org/order">Continue</a>', 'Continue')]
    assert not browser._guard_click(element)


def test_only_keys_named_by_goal_are_substituted():
    profile = {'email': 'person@example.com', 'name': 'Private Person', 'phone': '5551234'}
    allowed = permitted_profile('Fill my email, never use username', profile)
    assert set(allowed) == {'email'}
    assert substitute('{{email}}', allowed) == profile['email']
    with pytest.raises(ValueError, match='Missing'):
        substitute('{{phone}}', allowed)


@pytest.mark.parametrize('text', ['https://example.com/{{email}}', 'person@example.com', 'find {{name}}'])
def test_personal_values_cannot_be_used_in_urls_or_research(text):
    with pytest.raises(ValueError, match='only allowed'):
        reject_placeholders(text, {'email': 'person@example.com'})


@pytest.mark.parametrize('safe', [False, True])
def test_personal_field_requires_field_validation(safe):
    browser = Browser.__new__(Browser)
    browser._start_site = 'example.com'
    browser._refs = {'e1': SimpleNamespace(url='https://example.com')}
    element = Mock()
    element.evaluate.return_value = safe
    browser._element = lambda ref: element
    if safe:
        browser.personal_field('e1')
    else:
        with pytest.raises(ValueError, match='never search or messages'):
            browser.personal_field('e1')


def test_personal_fields_in_external_frames_are_rejected():
    browser = Browser.__new__(Browser)
    browser._start_site = 'example.com'
    browser._refs = {'e1': SimpleNamespace(url='https://evil.org')}
    with pytest.raises(ValueError, match='outside'):
        browser.personal_field('e1')


@pytest.mark.parametrize('host,expected', [
    ('example.com', 'example.com'),
    ('www.example.co.uk', 'example.co.uk'),
    ('a.b.example.fi', 'example.fi'),
    ('127.0.0.1', '127.0.0.1'),
    ('::1', '::1'),
    ('localhost', 'localhost'),
    ('a.example.co.zz', 'co.zz'),
])
def test_registrable_domain_uses_small_suffix_set(host, expected):
    assert registrable_domain(host) == expected
