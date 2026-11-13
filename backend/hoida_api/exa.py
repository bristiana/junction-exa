"""Small synchronous Exa client with injectable HTTP transport."""
import httpx


class ExaError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = self.status_code = status


class ExaClient:
    def __init__(self, api_key, transport=None):
        self.client = httpx.Client(base_url='https://api.exa.ai', headers={'x-api-key': api_key}, transport=transport, timeout=60)

    def request(self, method, path, **kwargs):
        try:
            response = self.client.request(method, path, **kwargs)
        except httpx.RequestError as exc:
            raise ExaError(502, 'Research service unavailable') from exc
        if not response.is_success:
            raise ExaError(response.status_code, 'Research service request failed')
        return response.json()

    def create_run(self, body):
        return self.request('POST', '/agent/runs', json=body)

    def get_run(self, run_id):
        return self.request('GET', f'/agent/runs/{run_id}')

    def get_events(self, run_id):
        return self.request('GET', f'/agent/runs/{run_id}/events', params={'limit': 100})

    def cancel_run(self, run_id):
        return self.request('POST', f'/agent/runs/{run_id}/cancel')

    def search(self, body):
        return self.request('POST', '/search', json=body)

    def contents(self, urls):
        return self.request('POST', '/contents', json={'urls': urls, 'text': {'maxCharacters': 8000}})

    def close(self):
        self.client.close()
