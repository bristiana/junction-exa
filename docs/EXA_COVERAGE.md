# Exa coverage in Vali

Audited 15 November 2026 against the current public [documentation index](https://exa.ai/docs/llms.txt), [changelog](https://exa.ai/docs/changelog), [product blog](https://exa.ai/blog?category=product+updates), and this checkout. Current documentation is served at `exa.ai/docs` (the requested `docs.exa.ai` material is represented there).

**Counting rule:** one row per named mode, filter, output feature, or grouped workflow below. These are capability rows, not an endpoint count or a percentage of Exa's engineering surface. Working legacy modes count; retired, deprecated-only, or unconfirmed features are listed separately and excluded. Plan-gated and beta features count as documented available, with their restrictions stated. Integrations and data domains are grouped explicitly rather than pretending each is a new endpoint.

**Coverage: 28 used / 95 documented available capability rows; 67 unused.** The nine lifecycle-warning rows are excluded. At the product-family level, Vali calls Search, Contents, Agent and standalone Monitors.

**“Yes” means a reachable call or response consumer exists in Vali's source, not that a production call succeeded today.** No paid Exa requests or deployment checks were made. “No” means no call/consumer found in the audited production code; generic request wrappers alone do not count. Paths and line numbers refer to the checkout at audit time. “—” means no implementation evidence. Student benefits on unused rows are potential uses, not shipped claims.

## Capability coverage

| Capability | What it does (plain words) | Used in Vali (yes/no) | Where (file:line) | How it helps a foreign student (one line) |
|---|---|---|---|---|
| [Search: `/search`][search] | Finds web pages from a natural-language question. | yes | `backend/vali_api/exa.py:131`; `backend/vali_api/app.py:204` | Finds the next page needed for an errand. |
| [Search: `auto`][sq] | Balances speed and search quality. | yes | `backend/vali_api/app.py:204`; `backend/vali_agent/web.py:68`; `extension/lib/exa.js:55` | Handles ordinary student questions. |
| [Search: `lite`][sq] | Low-latency indexed retrieval with a restricted option set. | no | — | Could make simple lookups quicker. |
| [Search: `fast` (working legacy)][sq] | Older low-latency mode; new integrations should consider Lite. | yes | `backend/vali_api/companion.py:91` | Provides sourced tips about the page being viewed. |
| [Search: `instant` (working legacy)][sq] | Older minimum-latency mode. | no | — | Could serve very short lookup interactions. |
| [Search: `deep-lite`][deep] | Lightweight multi-step search with synthesis. | no | — | Could compare a small set of services. |
| [Search: `deep`][deep] | Searches iteratively for harder questions. | no | — | Could investigate complicated eligibility rules. |
| [Search: `deep-reasoning` (working legacy)][deep] | Older stronger-reasoning search mode. | no | — | Could support difficult comparisons; Deep or Agent is preferred. |
| [Search category: `company`][search] | Focuses on company pages and company records. | no | — | Could help find employers. |
| [Search category: `people`][search] | Focuses on professional profiles. | no | — | Could help locate university contacts. |
| [Search category: `news`][data] | Focuses on reporting and recent stories. | no | — | Could find student policy announcements. |
| [Search category: `publication`][publications] | Finds scholarly works with publication metadata. | no | — | Could find papers for coursework. |
| [Search category: `personal site`][search] | Focuses on personal websites. | no | — | Could find a supervisor's own page. |
| [Search category: `financial report`][data] | Focuses on financial reporting. | no | — | Could support finance assignments. |
| [Search: `includeDomains`][search] | Restricts sources to specified domains or paths. | yes | `backend/vali_api/services/__init__.py:61`; `backend/vali_agent/web.py:71` | Keeps service facts tied to official sites. |
| [Search: `excludeDomains`][search] | Removes specified domains or paths. | no | — | Could avoid known irrelevant sites. |
| [Search: publication-date filters][sq] | `startPublishedDate` / `endPublishedDate` constrain publication dates. | no | — | Could focus on this year's announcements. |
| [Search: `userLocation`][sq] | Biases results toward a country or location. | yes | `backend/vali_agent/web.py:68`; `backend/vali_api/companion.py:91` | Uses Finland context for local lookups. |
| [Search: `numResults`][sq] | Sets the result count; public maximum is 100, varying by mode. | yes | `backend/vali_api/app.py:204`; `backend/vali_api/services/__init__.py:61`; `extension/panel/panel.js:242` | Keeps the result list manageable. |
| [Search with inline contents][sq] | Returns page extracts with the search results. | yes | `backend/vali_api/app.py:205`; `backend/vali_agent/web.py:69` | Supplies evidence without a separate page read. |
| [Search: schema synthesis and instructions][deep] | `outputSchema` and `systemPrompt` shape the answer. | yes | `backend/vali_api/app.py:205`; `backend/vali_api/research.py:256`; `backend/vali_api/companion.py:92` | Turns results into prices, options, and next steps. |
| [Search: synthesis streaming][best] | Streams synthesized output over SSE when using a schema. | no | — | Could show an answer sooner. |
| [Search: `additionalQueries`][deep] | Supplies query variations for deep search. | no | — | Could cover Finnish and English wording together. |
| [Search: `objective`][best] | Explains the larger task behind an individual search. | no | — | Could make a fee lookup more relevant to the actual application. |
| [Search: `moderation`][search] | Filters unsafe search material. | no | — | Could reduce unsuitable results. |
| [Usage attribution: `userIdentifier`][best] | Associates API usage with an opaque user identifier. | no | — | Could support fair per-student usage limits. |
| [Search diagnostics: warnings/notices][best] | Explains ignored options and retrieval limitations. | no | — | Could make incomplete research easier to explain. |
| [Contents: `/contents`, including URL batches][contents] | Reads known URLs as machine-readable page content. | yes | `backend/vali_api/exa.py:134`; `backend/vali_api/citations.py:157`; `backend/vali_agent/web.py:94` | Reopens cited pages to check claims. |
| [Contents: body text][contents] | Returns readable page text with size controls. | yes | `backend/vali_api/exa.py:135`; `backend/vali_agent/web.py:90` | Gives the browser assistant actual page evidence. |
| [Contents: compact text rendering][contentref] | `verbosity` reduces page text to useful content. | yes | `backend/vali_agent/web.py:90` (`verbosity: compact`) | Fits more useful text into the form-filling context. |
| [Contents: HTML, link and section rendering][contentref] | `includeHtmlTags`, `linkStyle`, `includeSections` / `excludeSections` tune the text. | no | — | Could preserve useful links while removing navigation. |
| [Contents/Search: highlights][highlights] | Returns question-relevant passages with a character budget. | yes | `backend/vali_agent/web.py:69`; `backend/vali_agent/web.py:93`; `backend/vali_api/services/__init__.py:62` | Shows the relevant part of a long service page. |
| [Highlights: dynamic allocation and verbosity beta][highlights] | Shares an excerpt budget across results; requires the documented beta header. | no | — | Could fit more evidence into a small answer. |
| [Contents: summary][contents] | Summarizes a page, optionally guided by `summary.query`. | no | — | Could shorten long instructions. |
| [Contents: structured summary][contents] | `summary.schema` extracts JSON fields from a page. | no | — | Could extract required documents into a checklist. |
| [Contents: freshness and crawl timeout][contents] | `maxAgeHours` controls cache age; `livecrawlTimeout` limits fetching time. | yes | `backend/vali_agent/web.py:91` (six-hour default at line 12) | Refreshes evidence used while completing forms. |
| [Contents: subpages][contents] | `subpages` / `subpageTarget` follow related site pages. | no | — | Could read eligibility and application instructions together. |
| [Contents: `extras.links`][contentref] | Extracts outgoing page links. | no | — | Could find the actual application page. |
| [Contents: `extras.imageLinks`][contentref] | Extracts image URLs. | no | — | Could retrieve a useful campus diagram. |
| [Contents: rich links/images and code blocks][contentref] | Adds anchor text, image descriptions, or extracted code. | no | — | Could provide clearer link labels or study examples. |
| [Contents: representative `image` / `favicon`][contents] | Returns page artwork and domain icons where available. | no | — | Could make source cards easier to recognize. |
| [Contents: per-URL statuses][contents] | Reports success or an error for each URL. | yes | `backend/vali_agent/web.py:97` | Explains when a page could not be read. |
| [Result publication metadata][contents] | Returns a page's publication date when available. | yes | `backend/vali_api/citations.py:169`; `backend/vali_agent/web.py:77` | Helps judge the age of evidence; this is not a date filter. |
| [Snapshot: `snapshotAsOf`][snapshot] | Reads stored historical versions through Search or Contents; access limits apply. | no | — | Could compare earlier and current application rules. |
| [Answer: `/answer` with citations][answer] | Searches and writes a source-backed answer. | no | — | Could answer simple questions through one dedicated endpoint. |
| [Answer: streaming][answer] | `stream: true` sends answer tokens over SSE. | no | — | Could display a direct answer progressively. |
| [Answer: structured output][answer] | `outputSchema` returns a requested JSON shape. | no | — | Could produce a small checklist. |
| [Answer: model/instruction/location controls][answer] | Selects `exa`, `exa-pro`, `exa-research`, or `exa-fast`; supports instructions, location and source text. | no | — | Could tune a direct answer for a student in Finland. |
| [Agent: asynchronous research runs][agent] | `/agent/runs` performs multi-step research. | yes | `backend/vali_api/exa.py:116`; `backend/vali_api/app.py:534`; `extension/background.js:115` | Researches an errand before proposing an action. |
| [Agent: structured output and instructions][create] | `outputSchema` and `systemPrompt` define the result. | yes | `backend/vali_api/research.py:243`; `extension/lib/task.js:141` | Returns consistent facts, steps, drafts and form data. |
| [Agent: field-level grounding/citations][create] | Attaches evidence to output fields. | yes | `backend/vali_api/citations.py:138`; `backend/vali_api/research.py:292` | Lets the student inspect the source behind a claim. |
| [Agent: effort selection and metadata][create] | Controls research depth and tags runs. | yes | `backend/vali_api/research.py:245`; `backend/vali_api/app.py:57` | Lets errands use different research effort levels. |
| [Agent: explicit budgets][ultra] | Caps run cost or duration with `budget`. | no | — | Could cap the cost of a difficult question. |
| [Agent: Ultra effort][ultra] | Uses `effort: ultra` for extensive research; budget limits apply. | yes | `backend/vali_api/app.py:57`; `backend/vali_api/research.py:245` | Can request deeper research; not the default and not live-tested here. |
| [Agent: continuation][agent] | `previousRunId` carries earlier research into a new run. | yes | `backend/vali_api/app.py:230`; `backend/vali_api/app.py:533`; `extension/background.js:114` | Refines an answer without starting without context. |
| [Agent: input enrichment and exclusions][create] | `input.data` enriches existing rows; `input.exclusion` avoids known entries. | no | — | Could enrich a shortlist of housing providers. |
| [Agent: get/poll a run][agent] | Reads completion status and output. | yes | `backend/vali_api/exa.py:122`; `backend/vali_api/app.py:167`; `extension/background.js:200` | Keeps long research running in the background. |
| [Agent: stored progress events][events] | Retrieves the run's recorded search/read activity. | yes | `backend/vali_api/exa.py:125`; `backend/vali_api/app.py:175`; `extension/background.js:206` | Shows what Vali has looked up. |
| [Agent: SSE creation/event replay][events] | Streams events directly instead of polling. | no | — | Could reduce delay in the progress display. |
| [Agent: cancel][agent] | Cancels a queued or running research job. | yes | `backend/vali_api/exa.py:128`; `backend/vali_api/app.py:660`; `extension/background.js:470` | Lets the student stop an errand. |
| [Agent: graceful stop][stop] | Stops eligible deeper runs while retaining partial findings. | no | — | Could keep useful findings when time runs out. |
| [Agent: list/delete stored runs][index] | Lists team research history or removes stored runs. | no | — | Could support history cleanup. |
| [Monitors: scheduled search and deduplication][monitors] | Repeats searches and delivers newly discovered results. | yes | `backend/vali_api/monitors.py:59` (`1d` interval; five results) | Watches for new student-relevant information. |
| [Monitors: signed webhook delivery][monitors] | Pushes completed runs to a callback. | yes | `backend/vali_api/monitors.py:63`; `backend/vali_api/monitors.py:127`; `backend/vali_api/app.py:982` | Can notify the student without reopening the app. |
| [Monitors: manual trigger][trigger] | Runs a monitor immediately. | yes | `backend/vali_api/monitors.py:124`; `backend/vali_api/app.py:828` | Supports “check now.” |
| [Monitors: delete][index] | Removes a recurring search. | yes | `backend/vali_api/monitors.py:110`; `backend/vali_api/app.py:858` | Stops an unwanted watch. |
| [Monitors: list/get/update/pause][index] | Inspects monitors and changes their search, schedule or status. | no | — | Could let students pause a watch during holidays. |
| [Monitors: batch actions and run history][index] | Manages groups of monitors and retrieves past runs. | no | — | Could restore missed watch updates. |
| [Monitors v2: structured synthesis/grounding][monitors] | Can return structured findings with supporting evidence. | no | `backend/vali_api/monitors.py:60` sends no schema | Could turn new announcements into a clear action. |
| [Monitors: source and contents controls][monitors] | The nested search supports domain filters and Contents options, not every Search parameter. | no | `backend/vali_api/monitors.py:60` only supplies query/count | Could keep a watch focused on official service sources. |
| [Websets: verified dataset/search lifecycle][websets] | Creates, previews, searches, lists, updates, cancels and deletes persistent result sets. | no | — | Could build a verified accommodation directory. |
| [Websets: item management][index] | Reads, lists or deletes individual dataset entries. | no | — | Could maintain a personal shortlist. |
| [Websets: enrichments][enrich] | Adds text, date, number, options, email, phone or URL fields; manages/cancels jobs. | no | — | Could add application requirements to each housing option. |
| [Websets: imports, scope and exclusions][imports] | Imports URL/CSV records, searches within them or excludes them. | no | — | Could research a university-provided list. |
| [Websets: monitors and run history][webmonitor] | Searches/refreshes items on cron/timezone schedules, with append/override and enable/disable controls. | no | — | Could keep a resource directory growing. |
| [Websets: webhooks, events and delivery attempts][index] | Sends dataset events with signature verification and inspectable deliveries. | no | — | Could notify students when a shortlist changes. |
| [Websets: team/concurrency information][index] | Reports dataset workload and limits. | no | — | Could keep a shared student service within capacity. |
| [Exa Connect: self-serve data partners][connect] | Agent `dataSources` adds premium external datasets; see partner list below. | no | — | Could add live travel prices or product information. |
| [Exa Connect: request-only partners][partners] | Adds further providers after commercial enablement. | no | — | Could support specialized research when justified. |
| [MCP server][mcp] | Hosted search/fetch; advanced search opt-in; Agent/Connect with authentication. | no | — | Could make Exa available inside another student assistant. |
| [Batch API (Enterprise beta)][batch] | Runs Search/Agent requests asynchronously; create/list/get/cancel/delete and JSONL results. | no | — | Could precompute many service lookups. |
| [Team Management API][team] | Manages keys, rotation, limits, key usage and remaining credits. | no | — | Could control shared service spending. |
| [OpenAI-compatible Chat Completions][compat] | `/chat/completions` maps to Answer. | no | — | Could reuse an existing chat integration. |
| [OpenAI-compatible Responses][compat] | `/responses` maps to Agent, including streaming/background jobs. | no | — | Could reuse an existing agent integration. |
| [OpenAI SDK wrapper][compat] | Python `exa.wrap(openai)` adds search to chat, with `use_exa` controls. | no | — | Could add retrieval to an existing chat workflow. |
| [Places data in Search][places] | Searches local places with addresses, hours, ratings and contact details. | no | `backend/vali_api/links.py:11` uses a local coordinate map instead | Could find nearby services with actual location data. |
| [Podcasts/transcripts in Search][podcasts] | Finds episodes and transcript passages with speaker information. | no | — | Could find useful study material. |
| [Sports/weather and expanded specialist datasets][data] | Searches public-web and specialist data domains; not separate endpoints. | no | — | Could support local plans and coursework. |
| [EU Search/Contents endpoint][eu] | `api.eu.exa.ai` provides EU processing with EU team/key; currently Auto/Lite Search and Contents. | no | `backend/vali_api/exa.py:81`; `backend/vali_agent/web.py:19` use the global host | Could support a future EU-resident retrieval setup. |
| [Official SDKs and agent skills][index] | Python/JavaScript clients and installable implementation/search/contents skills. | no | `backend/vali_api/exa.py:81`; `extension/lib/exa.js:15` use HTTP directly | Could reduce integration maintenance. |
| [Framework/app integrations][index] | Connects Exa to existing models, agents, workflow tools and apps. | no | — | Could bring research to tools students already use. |
| [Alternative payment/access protocols][index] | Supports x402, World AgentKit, Tempo MPP and Nevermined access paths. | no | — | Could let other agents pay for individual lookups. |
| [Enterprise Zero Data Retention][zdr] | Team-enabled retention controls for Search, Contents, Answer and Agent, with restrictions. | no | — (account setting not verified) | Could support stricter handling of sensitive questions. |
| [Enterprise HIPAA request mode][hipaa] | `compliance: hipaa` permits eligible cache-only Search/Contents requests. | no | — | Could support an eligible health workflow after proper enablement. |
| [Enterprise managed MCP authentication][ema] | Connects Claude to Exa through an organization's identity provider. | no | — | Could support university-managed access. |

### Lifecycle corrections: do not count these as available current capabilities

| Capability | What it does (plain words) | Used in Vali (yes/no) | Where (file:line) | How it helps a foreign student (one line) |
|---|---|---|---|---|
| [`neural` / `keyword` search types][search] | Historical named types; current named-mode docs do not establish separate operational support. | no | — | Use documented current modes instead. |
| [`category: research paper`][changes] | Replaced by `publication` in July 2026. | no | — | Use the current category for academic searches. |
| [`category: pdf`, `github`, `tweet`][changes] | Deprecated category values; PDFs and GitHub content remain searchable normally. | no | — | Search the document or domain without claiming a special category. |
| [Crawl-date filters][changes] | `startCrawlDate` / `endCrawlDate` are ignored. | no | — | Use publication dates or Contents freshness instead. |
| [Text filters][best] | `includeText` / `excludeText` are deprecated approximate restrictions. | no | — | Put the requirement into the query. |
| [`livecrawl` and old highlight knobs][contents] | Deprecated freshness strings and `numSentences` / `highlightsPerUrl`; use current controls. | no | — | Vali already uses `maxAgeHours` in the browser loop. |
| [`/findSimilar`][similar] | Historical URL-similarity endpoint; current reference redirects to Search and the endpoint is absent from the index. Current availability is unconfirmed. | no | — | Do not promise related-page lookup through this endpoint. |
| [`/research`][changes] | Retired 1 April 2026; current multi-step workflow is Agent. | no | — | Vali uses the current Agent API. |
| [Deep Max][max] | April announcement said forthcoming; no current named public mode verified. | no | — | Do not show it as an available Vali feature. |

### Partner and integration inventory

Connect's self-serve partners are **Fiber.ai** (companies/people), **Similarweb** (traffic/competitors), **Baselayer** (US business verification), **Polymarket** (prediction markets), **Macrobond** (economic time series), **Affiliate.com** (product catalogs), **Particle** (podcast transcripts), **Financial Datasets** (US market/company data), and **Jinko** (flights/hotels). They are Agent data sources, not nine independent Vali integrations. [Connect overview][connect]

The request-only partner list is **Crunchbase, Definitive Healthcare, Faraday AI, Harmonic, Intellizence, Kernel, and ZoomInfo**. Their current guide does not specify exact callable tools; do not present them as self-serve. [Additional providers][partners]

The current MCP tools are `web_search_exa` and `web_fetch_exa` by default, `web_search_advanced_exa` by opt-in, and `agent_run` by default only when authenticated through OAuth or an API key. The hosted endpoint is `https://mcp.exa.ai/mcp`. [MCP reference][mcp]

Websets remains documented for existing integrations, with Agent recommended for new workflows; it is not labeled retired. Its API base is `https://api.exa.ai/websets/v0`, distinct from standalone `/monitors`. Batch requires Enterprise enablement and `Exa-Beta: batches-2026-06-06`; its supported items are Search and Agent requests. Team Management requires separate service-key authorization and enablement. [Websets][websets], [Batch][batch], [Team Management][team]

The current docs also list integrations for Codex/ChatGPT, Claude, Fireworks, OpenAI/Anthropic tool calling, Vercel AI SDK/Gateway/fx, Stripe Projects, Slack, Hermes Agent, n8n, OpenClaw, OpenRouter, Baseten, Gumloop, Google Sheets, CrewAI, AG2, ElevenLabs, OpenHuman, TrueFoundry, Snowflake, Grok Build, LlamaIndex, Pydantic AI, LangChain and Browserbase. This is the public integration catalog, not a claim Vali uses those Exa adapters. Vali's own Anthropic tools, ElevenLabs channel, and browser automation do not establish use of the corresponding Exa integration. [Documentation index][index]

Data coverage also spans code/docs, finance, publications, legal/public records, cybersecurity, news, companies/people and the multilingual web. These are retrieval domains; a free-text errand about a place is not proof that Vali consumes Exa's structured Places data. [Data index][data]

## What Vali actually wires together

- The fast “find” path is `/search` plus `outputSchema`, not `/answer` (`backend/vali_api/app.py:204`). Service facts restrict the domain and request highlights (`backend/vali_api/services/__init__.py:60`).
- Research uses Agent runs, structured output, continuation and polled events (`backend/vali_api/exa.py:116`; `backend/vali_api/research.py:243`). Progress polling is not direct Exa SSE streaming.
- The quote check re-reads cited URLs using Contents (`backend/vali_api/citations.py:157`). This is Vali's own checking layer, not an Exa guarantee that every sentence is correct. Its backend client caches responses for ten minutes (`backend/vali_api/exa.py:14`); do not promise that every check fetches a page live.
- The cloud browser looks up facts without navigating away from the form, using Auto, Finland location, optional official domains and focused highlights, then compact Contents with freshness controls (`backend/vali_agent/agent.py:459`; `backend/vali_agent/web.py:68`).
- Watches use standalone `/monitors`, not Websets monitors. Creation, daily intervals, signed callbacks, manual triggering and deletion are implemented (`backend/vali_api/monitors.py:54`). A watch can be **saved locally without live provisioning** if the public HTTPS URL or API access is unavailable (`backend/vali_api/monitors.py:69`); show the real active state before recording a live alert demo.
- The extension has direct Agent create/poll/events/cancel paths (`extension/lib/exa.js:31`; `extension/background.js:115`). Its `getContents` helper (`extension/lib/exa.js:49`) has no call site; do not treat that helper as additional shipped use. Contents use is proven by the backend/browser calls.
- `web/exa-uses.js:9` has seven **product labels**, not seven Exa endpoints. Its per-task counters read persisted task fields (`web/exa-uses.js:20`). “Live facts,” “Form fill,” and “Fast search” reuse existing endpoints. `links.py` builds HSL/Google Maps URLs locally; that is not Exa Places or `findSimilar`.

## Quick wins we are not using yet

1. **Explain the search objective.** Add an `objective` string to the body in `backend/vali_agent/web.py:68`, describing that the lookup supports a Finnish student completing the current form. Smallest change: one body key; keep personal details out of it. Compare source relevance on the existing browser fixtures before enabling it.
2. **Moderate student-facing search results.** Add `'moderation': True` to the search bodies in `backend/vali_api/app.py:204`, `backend/vali_api/companion.py:91`, and `backend/vali_agent/web.py:68`. Smallest change: one key per call; check that official service results remain available.
3. **Use dates for explicitly time-bound searches.** Add `startPublishedDate` to a targeted news/announcement search body at `backend/vali_api/app.py:204` when the errand provides a time boundary. Smallest API change: one ISO-date key; do not apply globally, because valid official instructions may have old dates and company/people categories reject date filters.
4. **Make quote-check freshness explicit.** Add a positive `maxAgeHours` and `livecrawlTimeout` to the Contents body in `backend/vali_api/exa.py:135`. Smallest change: two keys; the ten-minute local cache remains, and a failed fresh fetch may still return cached content. This cannot justify “always live.”
5. **Extract the real application links.** Add `'extras': {'links': 5}` to `backend/vali_agent/web.py:90`, then append the returned `extras.links` to the text passed back at line 103. Smallest useful change: request field plus a small response-formatting block; treat links as untrusted page data. This could reduce guesses about where the application starts.

Do not blindly replace `fast` with `lite` in the companion: that call uses `outputSchema` and `systemPrompt`, which Lite rejects. Migrating it requires changing synthesis, not just the mode string. [Lite restrictions][sq]

## For the slides

- Vali uses Exa to find the pages behind a student's errand.
- Official-domain filters keep service facts tied to the relevant service website.
- Agent research turns findings into structured facts, steps and drafts with citations.
- Vali reads cited pages again and checks claims against quoted text.
- The cloud browser can search and read sources while preparing a form.
- Live-configured watches repeat searches and deliver signed updates; the app distinguishes saved watches from active ones.

## For the video

“Ask Vali about a student errand, and Exa finds sources for the answer.”

“Open the citations to see the pages behind the facts, then review the next step.”

“While Vali prepares a form, it can look up missing facts with Exa and show you the sources.”

## Sources

The linked references support the capability rows; source code establishes Vali usage. The changelog and blog were both checked because newer blog announcements extend beyond the latest changelog entry. November's EU rollout, October's Podcasts/Places/Monitors v2, September's Snapshot/Agent Ultra, August's Dynamic Highlights, June's Agent, and October's Lite/legacy distinctions are reflected above.

## Verification

- `npm test` — **pass**, 131 tests.
- `backend/.venv/bin/python -m pytest backend/tests -q` — **pass**, 946 passed and 5 expected failures.
- Initial sandbox runs could not bind localhost or run the local browser fixtures. Both full suites were rerun with the necessary execution permissions and exited successfully. These are offline tests, not evidence of live Exa access.
- Only this report was edited. Pre-existing changes in `scripts/evals/scorecard.md`, `scripts/harness/latest.md`, `.claude/`, and `scripts/harness/out/` were left alone. No commit or push.
- Report references, row counts, section counts and whitespace were verified. Repository-wide `git diff --check` flags pre-existing trailing whitespace in `scripts/harness/latest.md:15`; that unrelated file was not changed.

[index]: https://exa.ai/docs/llms.txt
[search]: https://exa.ai/docs/reference/search
[sq]: https://exa.ai/docs/search/quickstart
[deep]: https://exa.ai/docs/search/deep-search
[best]: https://exa.ai/docs/search/best-practices
[data]: https://exa.ai/docs/search/data/overview
[publications]: https://exa.ai/docs/search/data/research
[contents]: https://exa.ai/docs/contents/quickstart
[contentref]: https://exa.ai/docs/reference/get-contents
[highlights]: https://exa.ai/docs/search/highlights
[snapshot]: https://exa.ai/docs/search/snapshot
[answer]: https://exa.ai/docs/reference/answer
[agent]: https://exa.ai/docs/agent/quickstart
[create]: https://exa.ai/docs/reference/agent-api/create-a-run
[events]: https://exa.ai/docs/reference/agent-api/list-run-events
[stop]: https://exa.ai/docs/reference/agent-api/stop-a-run
[ultra]: https://exa.ai/docs/agent/agent-ultra
[monitors]: https://exa.ai/docs/monitors/quickstart
[trigger]: https://exa.ai/docs/reference/monitors/trigger-a-monitor
[websets]: https://exa.ai/docs/websets/quickstart
[enrich]: https://exa.ai/docs/websets/api/websets/enrichments/create-an-enrichment
[imports]: https://exa.ai/docs/websets/imports-and-search
[webmonitor]: https://exa.ai/docs/websets/api/monitors/create-a-monitor
[connect]: https://exa.ai/docs/agent/connect/overview
[partners]: https://exa.ai/docs/agent/connect/additional-partners
[mcp]: https://exa.ai/docs/get-started/exa-mcp
[batch]: https://exa.ai/docs/batch/quickstart
[team]: https://exa.ai/docs/admin/team-management
[compat]: https://exa.ai/docs/integrations/openai-sdk
[places]: https://exa.ai/blog/places-search
[podcasts]: https://exa.ai/blog/podcast-search
[eu]: https://exa.ai/blog/eu-data-residency
[zdr]: https://exa.ai/docs/admin/security/zero-data-retention
[hipaa]: https://exa.ai/docs/admin/security/hipaa
[ema]: https://exa.ai/docs/admin/mcp-enterprise-managed-auth
[changes]: https://exa.ai/docs/changelog
[similar]: https://exa.ai/docs/reference/find-similar-links
[max]: https://exa.ai/blog/deep-max
