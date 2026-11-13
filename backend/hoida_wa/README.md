# Hoida WhatsApp channel

Requires Python 3.13 and `httpx`. Import `hoida_wa` from the backend directory.
This package has no dependency on the application or media packages.

`parse_webhook(payload)` returns a `ParsedWebhook` with `messages` and `statuses`.
Verify the signature against the **original request bytes** before decoding JSON
or calling the flow. `verify_challenge(params, verify_token)` returns the challenge
string on success, or `None` on rejection; the HTTP adapter chooses the response
status. Status-only deliveries require no flow invocation.

Create `GraphAPIClient(phone_number_id, token, transport=...)` using credentials
from the caller's environment. Client methods and `WhatsAppFlow.handle` are
async. Close the client with `await client.aclose()` or an async context manager.
The transport is injectable for offline tests. HTTP errors expose `status_code`
and the upstream numeric `code`; transport failures use status zero. Only 5xx
responses are retried, once. Media redirects are rejected so the bearer token
is not forwarded to a redirect target.

Inject task, pairing and media callables into `WhatsAppFlow`; each can be sync or
async. `execute(task_id, action_index)` receives a **zero-based** index. Mutation
callbacks may return the updated Task for rendering or `None` for a short
acknowledgement. Store callbacks must enforce task ownership and atomic approval
state transitions. The HTTP adapter owns event deduplication and error handling;
exceptions propagate so it can decide whether to acknowledge or retry delivery.
`handle` marks the inbound message read first and returns the exact outgoing
message payloads it sent, excluding the read receipt.

Status uses the injected `get_active_task(user_id)` lookup. With the specified
active-task lookup it reports the latest actionable task; showing a newer,
non-actionable task would require a separate latest-task lookup in the adapter.

All renderers return `list[str]`, split at 4096 characters. Optional profile
dictionaries substitute placeholders; unsupplied values appear as `‹name›`.
`number_sources` and `cites_for` mirror the extension's grounding traversal,
field normalization, duplicate handling and confidence precedence. Results show
at most eight sources and omit markers outside that visible source list.

Run offline checks from the backend directory:

```sh
.venv/bin/python -m pytest tests/wa -q
```
