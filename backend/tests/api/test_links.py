from vali_api.links import hsl_url, maps_url, prefill_links, route_link
from vali_wa.render import render_result, result_buttons


def test_known_places_go_to_hsl_with_coordinates():
    link = route_link("I land at Helsinki Airport on Friday for the Junction hackathon at Dipoli in Otaniemi. "
                      "How do I get there and which HSL ticket do I buy?")
    assert link['label'] == 'Route in HSL'
    assert link['url'] == ('https://reittiopas.hsl.fi/reitti/Helsinki-Vantaa%20Airport%3A%3A60.3172%2C24.9633/'
                           'Dipoli%2C%20Espoo%3A%3A60.1848%2C24.8326?locale=en')


def test_from_to_order_wins():
    link = route_link("How do I get from Dipoli to the airport by bus?")
    assert link['url'].startswith('https://reittiopas.hsl.fi/reitti/Dipoli')
    assert 'Helsinki-Vantaa%20Airport' in link['url'].split('/reitti/')[1].split('/')[1]


def test_unknown_places_go_to_google_maps_transit():
    link = route_link("How do I get from Vallila to Kumpula campus by tram?")
    assert link == {'label': 'Directions', 'url': maps_url('Vallila', 'Kumpula campus')}
    assert link['url'] == ('https://www.google.com/maps/dir/?api=1&origin=Vallila&destination=Kumpula%20campus'
                           '&travelmode=transit')


def test_not_a_route_question():
    assert route_link("Book a sauna at Kulttuurisauna on Friday") is None
    assert route_link("Kela benefits for students") is None
    assert route_link("How do I get a library card?") is None


def test_prefill_puts_route_first_and_shifts_grounding():
    output = {'structured': {'actions': [{'type': 'open_link', 'label': 'HSL app', 'url': 'https://www.hsl.fi/en/app'}]},
              'grounding': [{'field': 'actions[0]', 'citations': [{'url': 'https://hsl.fi'}]}, {'field': 'answer'}]}
    out = prefill_links("How do I get from Helsinki Airport to Kamppi by train?", output)
    actions = out['structured']['actions']
    assert actions[0]['prefilled'] and actions[0]['url'] == hsl_url(('Helsinki-Vantaa Airport', 60.3172, 24.9633),
                                                                     ('Kamppi, Helsinki', 60.1690, 24.9320))
    assert actions[1]['label'] == 'HSL app'
    assert out['grounding'][0]['field'] == 'actions[1]'
    assert out['grounding'][1]['field'] == 'answer'


def test_prefill_leaves_other_errands_alone():
    output = {'structured': {'actions': [{'type': 'open_link', 'url': 'https://kela.fi'}]}, 'grounding': []}
    assert prefill_links("Kela benefits for students", output) == output
    assert prefill_links("How do I get from A place to B place?", None) is None


def test_whatsapp_shows_the_ready_link_and_no_button_for_it():
    task = {'id': 't1', 'mode': 'find', 'task': 'How do I get from Helsinki Airport to Dipoli?', 'research': {
        'status': 'completed', 'output': prefill_links('How do I get from Helsinki Airport to Dipoli?', {
            'structured': {'answer': 'Take the train and the metro.', 'actions': [
                {'type': 'open_link', 'label': 'HSL app', 'url': 'https://www.hsl.fi/en/app'}]}, 'grounding': []})}}
    text = '\n'.join(render_result(task, buttons=True))
    assert 'Route in HSL: https://reittiopas.hsl.fi/reitti/Helsinki-Vantaa%20Airport' in text
    assert [b for b in result_buttons(task) if b[1] == 'Route in HSL'] == []
