from vali_api.research import FIND_SCHEMA


def count_properties(schema):
    properties = schema.get('properties') or {}
    return len(properties) + sum(count_properties(child.get('items') or child) for child in properties.values())


def test_find_schema_fits_exa_search_limits():
    # Exa /search outputSchema: at most 10 properties in total and 2 levels of nesting.
    assert count_properties(FIND_SCHEMA) <= 10
    assert 'description' in FIND_SCHEMA['properties']['options']
