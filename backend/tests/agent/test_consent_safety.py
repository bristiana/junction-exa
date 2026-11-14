from unittest.mock import Mock
import pytest
from vali_agent.browser import Browser
from vali_agent.guard import is_final_submit
from vali_agent.live import dismiss_cookie_banner


@pytest.mark.parametrize('label', ['Send', 'Pay', 'Confirm', 'Book', 'Varaa', 'Boka', 'Tilaa', 'Maksa', 'Skicka'])
def test_cookie_wrapper_cannot_exempt_final_control(label):
    element = Mock()
    element.evaluate.side_effect = ['', (f'<button class="cookie-consent">{label}</button>', label)]
    with pytest.raises(ValueError, match='request_approval'):
        Browser.__new__(Browser)._guard_click(element)


@pytest.mark.parametrize('label', ['Next', 'Continue', 'Jatka', 'Seuraava', 'Select slot'])
def test_wizard_next_and_continue_are_not_final(label):
    assert not is_final_submit('<button type="submit">', label)


@pytest.mark.parametrize('label', ['Reject all and Pay', 'Only necessary Confirm', 'Vain välttämättömät Vahvista'])
def test_cookie_dismissal_does_not_click_mixed_final_label(label):
    frame = Mock()
    frame.evaluate.return_value = [{'label': label, 'around': 'Cookie consent'}]
    page = Mock(frames=[frame])
    assert dismiss_cookie_banner(page) is None
    frame.locator.assert_not_called()


def test_exact_minimal_cookie_choice_still_works():
    frame = Mock()
    frame.evaluate.return_value = [{'label': 'Reject all', 'around': 'Cookie consent'}]
    page = Mock(frames=[frame])
    assert dismiss_cookie_banner(page) == 'Reject all'
    frame.locator.return_value.first.click.assert_called_once()


@pytest.mark.parametrize('description', ['<button aria-label="Reject all">Pay</button>',
                                         '<button type="submit">Reject all</button>'])
def test_cookie_aria_label_cannot_hide_a_final_action(description):
    frame = Mock()
    frame.evaluate.return_value = [{'label': 'Reject all', 'description': description, 'around': 'Cookie consent'}]
    assert dismiss_cookie_banner(Mock(frames=[frame])) is None
    frame.locator.assert_not_called()


def test_checkbox_role_cannot_hide_final_button():
    element = Mock()
    element.evaluate.side_effect = ['', ('<button role="checkbox" aria-checked="false">Pay</button>', 'Pay')]
    browser = Browser.__new__(Browser)
    browser._element = lambda ref: element
    with pytest.raises(ValueError, match='request_approval'):
        browser.check('e1', True)
    element.click.assert_not_called()
    element.set_checked.assert_not_called()


@pytest.mark.parametrize('key', ['Enter', 'Return', 'Space', ' ', 'Control+Enter'])
def test_keyboard_cannot_activate_an_unrecognized_final_control(key):
    browser = Browser.__new__(Browser)
    browser.page = Mock()
    with pytest.raises(ValueError, match='request_approval'):
        browser.press(key)
    browser.page.keyboard.press.assert_not_called()


@pytest.mark.parametrize('label', ['Accept necessary', 'Reject all', 'Only necessary',
                                   'Accept only essential cookies', 'Vain välttämättömät',
                                   'Continue with only necessary cookies', 'Reject all cookies',
                                   'Hyväksy vain välttämättömät', 'Vain välttämättömät evästeet',
                                   'Hylkää kaikki evästeet'])
def test_nonfinal_minimal_consent_labels_are_dismissed(label):
    frame = Mock()
    frame.evaluate.return_value = [{'label': label, 'description': '<button type="button">' + label + '</button>',
                                    'around': 'Cookie consent'}]
    assert dismiss_cookie_banner(Mock(frames=[frame])) == label
    frame.locator.return_value.first.click.assert_called_once()
