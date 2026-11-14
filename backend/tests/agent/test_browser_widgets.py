import re
import pytest
from vali_agent.browser import Browser
from vali_agent.guard import is_final_submit


@pytest.fixture
def browser():
    instance = Browser()
    yield instance
    instance.close()


def ref(snapshot, label):
    return next(re.match(r'\[(e\d+)\]', line)[1] for line in snapshot.splitlines()
                if line.startswith('[e') and f'"{label}"' in line)


def test_existing_claim_refs(browser, local_site):
    browser.goto(local_site+'/claim.html')
    snapshot = browser.snapshot()
    fields = browser.page.locator('input,select,textarea,button')
    assert fields.evaluate_all('(els)=>els.map(el=>el.getAttribute("data-vali-ref"))') == [f'e{i}' for i in range(1,10)]
    browser.type('e1', 'Test passenger')
    browser.type('e2', 'test@example.com')
    browser.select('e4', 'Refund')
    browser.check('e5', True)
    browser.check('e7', True)
    browser.type('e8', 'Claim details')
    assert ref(snapshot, 'Submit claim') == 'e9'
    assert is_final_submit(browser.element_text('e9'))
    browser.click('e9')  # Browser is driven directly; approval belongs to the agent.
    assert 'Reference FC-1234' in browser.snapshot()


def test_frames(browser, local_site):
    browser.goto(local_site+'/widget_frames.html')
    snapshot = browser.snapshot()
    refs = re.findall(r'^\[(e\d+)\]', snapshot, re.M)
    assert len(refs) == len(set(refs)) == 9
    for prefix, frame in [('Child', browser.page.frames[1]), ('Opaque', browser.page.frames[2])]:
        browser.type(ref(snapshot, prefix+' name'), 'Test passenger')
        browser.select(ref(snapshot, prefix+' choice'), 'Two')
        assert frame.locator('input').input_value() == 'Test passenger'
        assert frame.locator('select').input_value() == 'Two'
        confirm = frame.locator('button[type=submit]').get_attribute('data-vali-ref')
        assert is_final_submit(browser.element_text(confirm))
        browser.click(ref(snapshot, prefix+' action'))
        assert frame.locator('button').first.inner_text() == prefix+' clicked'
    for invalid in ['e0', 'e-1', 'e1"]', 'e999', None]:
        with pytest.raises(ValueError, match='reference'):
            browser.element_text(invalid)


def test_shadow_and_aria(browser, local_site):
    browser.goto(local_site+'/widget_aria.html')
    snapshot = browser.snapshot()
    for label in ['Help link', 'Email radio', 'Menu action', 'Nested action']:
        assert ref(snapshot, label)
    assert 'Skip negative tabindex' not in '\n'.join(snapshot.splitlines()[:-1])
    browser.type(ref(snapshot, 'Shadow name'), 'Passenger')
    browser.select(ref(snapshot, 'Shadow choice'), 'Two')
    assert browser.page.locator('#shadow input').input_value() == 'Passenger'
    assert browser.page.locator('#shadow select').input_value() == 'Two'
    assert 'type=submit' in browser.element_text(ref(snapshot, 'Shadow action'))
    browser.click(ref(snapshot, 'Shadow action'))
    browser.type(ref(snapshot, 'Editable notes'), 'New notes')
    assert browser.page.locator('[contenteditable]').inner_text() == 'New notes'
    for label in ['Accept policy', 'Notifications']:
        target = ref(snapshot, label)
        browser.check(target, True)
        browser.check(target, True)  # Idempotent: a second call must not toggle it off.
        assert browser._element(target).get_attribute('aria-checked') == 'true'
        browser.check(target, False)
        assert browser._element(target).get_attribute('aria-checked') == 'false'
    with pytest.raises(ValueError, match='enabled'):
        browser.check(ref(snapshot, 'Disabled choice'), True)
    for label in ['Open panel', 'Details tab', 'Focusable action']:
        browser.click(ref(snapshot, label))
    updated = browser.snapshot()
    assert 'aria-expanded=true' in updated and 'aria-selected=true' in updated
    assert 'aria-checked=false' in updated and 'aria-disabled=true' in updated
    assert 'Shadow clicked' in updated and 'Focus clicked' in updated


def test_custom_dropdowns(browser, local_site):
    browser.goto(local_site+'/widget_dropdowns.html')
    snapshot = browser.snapshot()
    target = ref(snapshot, 'Destination')
    browser.select(target, 'hELsinki')
    assert browser._element(target).inner_text() == 'Helsinki'  # Exact beats earlier contains.
    browser.select(target, 'central')
    assert browser._element(target).inner_text() == 'Tampere Central'
    browser.select(ref(snapshot, 'Ticket class'), 'flexible')
    assert browser.page.locator('#ticket').inner_text() == 'Flexible fare'
    browser.select(ref(snapshot, 'Seat'), 'window')
    assert browser.page.locator('#seat').inner_text() == 'Window'
    browser.select(ref(snapshot, 'Native choice'), 'Two')
    assert browser.page.locator('select').input_value() == 'two'
    with pytest.raises(ValueError, match='Option not found'):
        browser.select(target, 'Missing city')


@pytest.mark.parametrize('kind,value,hint', [
    ('date', '2026-11-14', 'YYYY-MM-DD'), ('time', '14:30', 'HH:MM'),
    ('datetime-local', '2026-11-14T14:30', 'YYYY-MM-DDTHH:MM'), ('number', '3', 'numeric'),
])
def test_special_input_types(browser, local_site, kind, value, hint):
    browser.goto(local_site+'/widget_dates.html')
    browser.snapshot()
    field = browser.page.locator(f'input[type="{kind}"]')
    target = field.get_attribute('data-vali-ref')
    browser.type(target, value)
    assert field.input_value() == value
    with pytest.raises(ValueError, match=hint):
        browser.type(target, 'not a valid value')


def test_calendar_and_wizard(browser, local_site):
    browser.goto(local_site+'/widget_dates.html')
    browser.click(ref(browser.snapshot(), 'Choose date'))
    browser.click(ref(browser.snapshot(), '14 November'))
    assert browser.page.locator('input[type=date]').input_value() == '2026-11-14'
    browser.goto(local_site+'/widget_wizard.html')
    snapshot = browser.snapshot()
    next_ref = ref(snapshot, 'Next / Seuraava')
    assert not is_final_submit(browser.element_text(next_ref))
    assert 'Confirm booking' not in snapshot
    browser.click(next_ref)
    snapshot = browser.snapshot()
    assert 'Review your booking' in snapshot and 'Next / Seuraava' not in snapshot
    assert is_final_submit(browser.element_text(ref(snapshot, 'Confirm booking')))


def test_snapshot_budget(browser, local_site):
    browser.goto(local_site+'/widget_size.html')
    snapshot = browser.snapshot()
    lines, text = snapshot.split('\nText: ', 1)
    assert len(text) == 2500
    assert len(re.findall(r'^\[e\d+\]', lines, re.M)) == 200
    assert 'options_count=80' in lines
    assert 'Native 25' in lines and 'Native 26' not in lines
    assert 'Custom 25' in lines and 'Custom 26' not in lines
    assert 'Native 26' not in text and 'Custom 26' not in text
    # Remove the cap pressure to test the distance filter independently.
    browser.page.locator('#buttons').evaluate('(el)=>el.remove()')
    lines = browser.snapshot().split('\nText: ', 1)[0]
    assert 'Distant action' not in lines and 'Distant field' in lines


@pytest.mark.parametrize('kind,expected', [
    ('suomi','login'), ('finnish','login'), ('bank','login'), ('english','login'),
    ('link','login'), ('identity','login'), ('human','captcha'), ('turnstile','captcha'),
])
def test_identification_and_challenges(browser, local_site, kind, expected):
    browser.page.route('https://**/*', lambda route: route.fulfill(body='<html></html>', content_type='text/html'))
    browser.goto(local_site+'/widget_blockers.html?kind='+kind)
    assert expected in browser.blockers()
