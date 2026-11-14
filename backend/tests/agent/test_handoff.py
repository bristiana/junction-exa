"""Continue in my browser: the agent hands over the page and its site's cookies at approval or a payment stop."""
from types import SimpleNamespace as NS

from vali_agent import AgentHooks, run_browser_agent
from vali_agent.jev import Jev
from vali_agent.web import ExaTools


class Scripted:
    def __init__(self, calls):
        self.calls, self.turn = iter(calls), 0

    def next(self, system, tools, messages):
        self.turn += 1
        name, args = next(self.calls)
        return NS(content=[NS(type='tool_use', id=f't{self.turn}', name=name, input=args)], stop_reason='tool_use')


def seeded(local_site):
    return [{'name': 'cart', 'value': 'CART-SECRET', 'url': local_site + '/'},
            {'name': 'tracker', 'value': 'OTHER-SITE', 'domain': 'other.test', 'path': '/'}]


def run(local_site, page, calls, approve=False):
    handoffs, steps = [], []
    hooks = AgentHooks(lambda t, j: steps.append(t), lambda s, f: approve, lambda: False,
                       on_handoff=lambda url, cookies: handoffs.append((url, cookies)))
    result = run_browser_agent('Book it', local_site + page, {}, hooks, Scripted(calls), cookies=seeded(local_site),
                               exa=ExaTools(api_key=''), jev=Jev(api_key=''))
    return result, handoffs, steps


def test_approval_hands_over_the_page_and_only_its_site_cookies(local_site):
    result, handoffs, steps = run(local_site, '/claim.html', [('request_approval', {'summary': 'Pay for 2 seats', 'filled': []})])
    assert result.status == 'stopped'
    [(url, cookies)] = handoffs
    assert url == local_site + '/claim.html'
    assert [(c['name'], c['value']) for c in cookies] == [('cart', 'CART-SECRET')]  # other.test stays in the cloud
    assert 'CART-SECRET' not in repr(result) + repr(steps)


def test_payment_blocker_hands_over_too(local_site):
    result, handoffs, _ = run(local_site, '/payment.html', [('fail', {'reason': 'needs payment: finish by hand'})])
    assert result.status == 'failed' and result.result.startswith('needs payment')
    assert len(handoffs) == 1 and handoffs[0][0].endswith('/payment.html')
    assert handoffs[0][1][0]['value'] == 'CART-SECRET'


def test_other_failures_hand_nothing_over(local_site):
    result, handoffs, _ = run(local_site, '/claim.html', [('fail', {'reason': 'missing: the venue'})])
    assert result.status == 'failed' and handoffs == []
