"""Selection must not offer an alternate route to an unapproved click."""
from types import SimpleNamespace
from unittest.mock import Mock
import pytest
from vali_agent.browser import Browser


def test_selection_rejects_plain_send_button_before_click():
    element = Mock()
    element.evaluate.side_effect = [False, False]
    browser = Browser.__new__(Browser)
    browser._element = lambda ref: element
    with pytest.raises(ValueError, match='validated combobox'):
        browser.select('e1', 'Anything')
    element.click.assert_not_called()


@pytest.mark.parametrize('label', ['Send', 'Pay', 'Vahvista', 'Boka'])
def test_selection_guards_combobox_opener(label):
    element = Mock()
    element.evaluate.side_effect = [False, True, '', ('<div role=combobox>', label)]
    browser = Browser.__new__(Browser)
    browser._element = lambda ref: element
    browser._refs = {'e1': SimpleNamespace()}
    with pytest.raises(ValueError, match='request_approval'):
        browser.select('e1', 'Anything')
    element.click.assert_not_called()


def test_selection_guards_internal_option_click():
    option = Mock()
    option.inner_text.return_value = 'Send'
    option.evaluate.side_effect = ['', ('<div role=option>Send</div>', 'Send')]
    candidates = Mock()
    candidates.all.return_value = [option]
    opener = Mock()
    opener.evaluate.side_effect = [False, True, '', ('<div role=combobox>', 'Destination'), '']
    frame = Mock()
    frame.locator.return_value.locator.return_value.filter.return_value = candidates
    browser = Browser.__new__(Browser)
    browser._element = lambda ref: opener
    browser._refs = {'e1': frame}
    with pytest.raises(ValueError, match='request_approval'):
        browser.select('e1', 'Send')
    opener.click.assert_called_once()
    option.click.assert_not_called()


def test_final_click_timeout_never_retries(monkeypatch):
    from playwright.sync_api import TimeoutError as BrowserTimeout
    element = Mock()
    element.click.side_effect = BrowserTimeout('Timed out after possible submission')
    browser = Browser.__new__(Browser)
    browser._element = lambda ref: element
    browser._fallback_click = Mock()
    browser._guard_click = Mock(return_value=True)
    monkeypatch.setattr('vali_agent.browser.expect', lambda el: Mock())
    with pytest.raises(BrowserTimeout):
        browser.click('e1', approved=True)
    element.click.assert_called_once()
    browser._fallback_click.assert_not_called()


@pytest.mark.parametrize('chosen,blocked', [('Morning', False), ('Send', True)])
def test_native_selection_guards_only_chosen_option(chosen, blocked):
    element = Mock()
    element.evaluate.return_value = True
    element.locator.return_value.evaluate_all.return_value = [
        {'value': 'morning', 'text': 'Morning'}, {'value': 'send', 'text': 'Send'}]
    browser = Browser.__new__(Browser)
    browser._element = lambda ref: element
    browser._settle = Mock()
    if blocked:
        with pytest.raises(ValueError, match='request_approval'):
            browser.select('e1', chosen)
        element.select_option.assert_not_called()
    else:
        browser.select('e1', chosen)
        element.select_option.assert_called_once_with(value='morning')
