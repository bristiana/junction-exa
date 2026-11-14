"""PRH YTJ v3: https://avoindata.prh.fi/fi/ytj/swagger-ui.

Live endpoint verified with a company-name search. A match is not a trust check.
"""
from .http import request_json

URL = 'https://avoindata.prh.fi/opendata-ytj-api/v3/companies'


def search_companies(name, *, transport=None):
    payload = request_json('GET', URL, params={'name': name}, transport=transport)
    valid = payload is not None and isinstance(payload.get('companies'), list)
    return {'available': valid, 'companies': payload['companies'] if valid else [],
            'total': payload.get('totalResults') if valid else None,
            'source': 'PRH / Finnish Business Information System (YTJ)', 'source_url': URL,
            'notice': 'Registry data may include ceased companies. Check current register entries and business ID. '
                      'A match does not establish landlord ownership or trustworthiness; absence is not proof of fraud.'}
