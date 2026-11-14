from types import SimpleNamespace as NS
import pytest
from hoida_agent import AgentHooks, run_browser_agent


class Responses:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.histories = []

    def next(self, system, tools, messages):
        self.histories.append(list(messages))
        return next(self.responses)


def response(reason, content=None):
    return NS(stop_reason=reason, content=content or [NS(type='text', text='Continue')])


def tool(identifier, name, args):
    return NS(type='tool_use', id=identifier, name=name, input=args)


def test_pause_and_batched_results_are_append_only(local_site):
    thinking = NS(type='thinking', thinking='Preserved thought', signature='preserved-signature')
    paused = response('pause_turn', [thinking])
    batch = response('tool_use', [tool('a', 'read_page', {}), tool('b', 'read_page', {})])
    model = Responses([paused, batch, response('tool_use', [tool('c','finish',{'result':'Ready'})])])
    result = run_browser_agent('Read page',local_site+'/claim.html',{},AgentHooks(lambda *args:None,lambda *args:True,lambda:False),model)
    assert result.status == 'done'
    assert model.histories[1][1]['content'] is paused.content
    assert model.histories[2][2]['content'] is batch.content
    results = model.histories[2][3]['content']
    assert [block['tool_use_id'] for block in results] == ['a','b']
    assert all(block['type'] == 'tool_result' for block in results)


@pytest.mark.parametrize('reason,expected', [('end_turn','without calling'),('refusal','refused'),('max_tokens','token limit')])
def test_stop_reasons(local_site, reason, expected):
    model = Responses([response(reason) for _ in range(3)])
    result = run_browser_agent('Read page',local_site+'/claim.html',{},AgentHooks(lambda *args:None,lambda *args:True,lambda:False),model)
    assert result.status == 'failed' and expected in result.result
    assert len(model.histories) == (3 if reason == 'end_turn' else 1)


def test_step_limit(local_site):
    # Page actions count toward max_steps; reading the page does not.
    model = Responses([response('tool_use', [tool('a','scroll',{'direction':'down'}),tool('b','scroll',{'direction':'down'})])])
    result = run_browser_agent('Read page',local_site+'/claim.html',{},AgentHooks(lambda *args:None,lambda *args:True,lambda:False),model,max_steps=1)
    assert result.status == 'failed' and result.steps == 1


def test_look_image_tool_result(local_site):
    model = Responses([
        response('tool_use', [tool('a','look',{})]),
        response('tool_use', [tool('b','finish',{'result':'Inspected page'})])])
    result = run_browser_agent('Inspect page',local_site+'/claim.html',{'name':'Test Person'},AgentHooks(lambda *args:None,lambda *args:True,lambda:False),model)
    assert result.status == 'done'
    result_block = model.histories[1][-1]['content'][0]
    assert result_block['tool_use_id'] == 'a'
    image = result_block['content'][0]
    assert image['type'] == 'image'
    assert image['source']['type'] == 'base64'
    assert image['source']['media_type'] == 'image/jpeg'
    assert image['source']['data']
