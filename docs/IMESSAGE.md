# iMessage channel for Vali

Status: design, not built. Owner of the build: desktop (`desktop/imessage.mjs`).

WhatsApp is parked. Meta blocks sending from our unverified business portfolio.
This doc proposes iMessage as the chat channel, built as a local bridge inside the
Vali Mac app. It covers the official option, how the bridge works, identity, the
mapping from the WhatsApp flow, a build plan, tests, and a channel comparison.

Short version:

- There is no official iMessage bot API we can use this week.
- The bridge reads `~/Library/Messages/chat.db` and sends with AppleScript.
  It needs Full Disk Access and Automation permission, and a Mac that stays on.
- Users link their iMessage handle to their Vali account with a 6-digit code.
- It works only for people with an iPhone, iPad or Mac.
- Research covers reports up to macOS 26 (Tahoe). The demo laptop runs
  macOS 27.0.1. Everything below must be checked on that machine first.

## 1. Official API: Apple Messages for Business

Apple has one official business channel: Apple Messages for Business.

- A business cannot use it directly. It must go through an Apple-approved
  Messaging Service Provider (MSP). [1]
- The business registers in Apple Business Register and gets reviewed. [1][2]
- The customer must start every conversation. You cannot text a phone number to
  open a thread. The business gets an opaque ID, not the phone number. [1]
- A live agent escalation path is mandatory. Apple states that deployments
  without live agent support will not be approved. [1]
- Becoming an MSP yourself means a regional capability review, an integration
  review against Apple standards, a pilot with clients and a launch review.
  The onboarding page lists three registered clients as a step. [2]
- Apple gives no fixed timeline. Vendors quote a few business days for brand
  review once you already have an MSP account. [1][3]

Why it does not fit a hackathon:

- We have no MSP contract, no registered brand and no live agent team.
- Review time is open-ended and outside our control.
- A bot-only service with no human agents is not approvable.
- MSPs charge for the service even though Apple does not. [1]

Verdict: not an option for Junction. Revisit only if Vali becomes a real company.

## 2. The local bridge approach

Projects like BlueBubbles and `imsg` (steipete, now under openclaw) all work the
same way. A Mac signed in to Messages acts as the server. Reads come from the
Messages SQLite database. Sends go through Messages.app automation. [4][5][6]

BlueBubbles also has a "Private API" mode for typing indicators, reactions and
more. It requires disabling System Integrity Protection (SIP). [7] We will not do
that on a team laptop. AppleScript only.

### 2.1 Reading chat.db

Path: `~/Library/Messages/chat.db`, in WAL mode (`chat.db-wal`, `chat.db-shm`
next to it). Apple does not publish the schema. Everything here is
reverse-engineered. [8]

Tables we need:

| Table | Columns we use |
|---|---|
| `message` | `ROWID`, `guid`, `text`, `attributedBody`, `handle_id`, `is_from_me`, `date`, `service`, `cache_has_attachments`, `is_audio_message`, `associated_message_type`, `item_type`, `error` |
| `handle` | `ROWID`, `id` (phone in E.164 or email), `service` |
| `chat` | `ROWID`, `guid`, `style` (43 = 1:1 iMessage, 45 = group), `chat_identifier` |
| `chat_message_join` | `chat_id`, `message_id` |
| `attachment` | `ROWID`, `filename`, `mime_type`, `uti`, `transfer_state`, `total_bytes` |
| `message_attachment_join` | `message_id`, `attachment_id` |

Facts that matter [8]:

- `date` is nanoseconds since 2001-01-01 UTC. Unix seconds = `date / 1e9 + 978307200`.
- `is_from_me` is 1 for sent, 0 for received.
- `attachment.filename` starts with `~/Library/Messages/Attachments/...`.
  Expand `~` before reading.
- With iCloud "Optimize Storage" a file can be missing on disk.
- Voice memos are CAF (older ones AMR).
- New rows land in `chat.db-wal` first. A reader must not open the file with
  `immutable=1`, or it misses new messages.

Inbound query (one short-lived read-only connection per tick):

```sql
SELECT m.ROWID AS rowid, m.guid, m.text, m.attributedBody, m.date,
       m.service, m.cache_has_attachments, m.is_audio_message,
       m.associated_message_type, m.item_type,
       h.id AS sender, c.style
FROM message m
JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
JOIN chat c ON c.ROWID = cmj.chat_id
LEFT JOIN handle h ON h.ROWID = m.handle_id
WHERE m.ROWID > ? AND m.is_from_me = 0
ORDER BY m.ROWID
LIMIT 50;
```

Attachments for one message:

```sql
SELECT a.filename, a.mime_type, a.uti, a.transfer_state, a.total_bytes
FROM attachment a
JOIN message_attachment_join j ON j.attachment_id = a.ROWID
WHERE j.message_id = ?;
```

Skip rules, applied before any text is decoded:

- `c.style != 43` (group chats and SMS threads).
- `associated_message_type != 0` (tapbacks and their removals).
- `item_type != 0` (group events, renames).
- Sender not linked and not on the allowed list (see section 3), except a
  `link 123456` message or a first help reply.
- Message `date` older than the bridge start time. This guards against old
  history syncing in from iCloud with new ROWIDs.

SQLite in Electron: the bundled Electron 45.3.2 runs Node 24.22.2 with
`node:sqlite` and SQLite 3.53.4. Verified locally with
`ELECTRON_RUN_AS_NODE=1`. No native module is needed.
Use `new DatabaseSync(path, { readOnly: true })`.

### 2.2 The attributedBody blob

Since macOS 13 (Ventura), `message.text` is often NULL. The body lives in
`attributedBody`, an `NSMutableAttributedString` serialized in the old
`typedstream` (NSArchiver) format. [8][9] Reports from macOS 26 say `text` is
NULL for nearly every message, so the decoder is required, not a fallback. [10]

Decode algorithm (byte scan, same as several Rust and Python decoders) [11][12]:

1. Find the ASCII bytes `NSString`. Move past them.
2. Scan forward to byte `0x2B` (`+`). Step past it.
3. Read a length tag byte:
   - `0x81`: next 2 bytes, little-endian, are the length.
   - `0x82`: next 4 bytes, little-endian.
   - otherwise the byte itself is the length.
4. Read that many bytes as UTF-8.
5. Strip `U+FFFC` (the attachment placeholder character).

```js
export function decodeAttributedBody(buf) {
  if (!buf?.length) return null;
  let i = buf.indexOf('NSString');
  if (i < 0) return null;
  i += 8;
  while (i < buf.length && buf[i] !== 0x2b) i++;
  if (++i >= buf.length) return null;
  let len = buf[i++];
  if (len === 0x81) { len = buf.readUInt16LE(i); i += 2; }
  else if (len === 0x82) { len = buf.readUInt32LE(i); i += 4; }
  if (i + len > buf.length) return null;
  return buf.subarray(i, i + len).toString('utf8').replace(/￼/g, '').trim();
}
```

Known trap: parsers that read only one length byte truncate every message over
127 bytes. A macOS 15 bug report shows exactly this. [10] Our fixture tests
must include a long message. Read the 2-byte length as unsigned.

Order: use `text` when it is non-empty and not just `U+FFFC`. Otherwise decode
`attributedBody`.

### 2.3 Polling vs FSEvents

- `imsg watch` follows file events on the database and the WAL file, with a
  polling fallback "when macOS drops an event or rotates a sidecar file". [5]
- The Fatbobman deep dive polls read-only and notes the main file can lag the
  WAL by seconds or minutes. [13]

Plan: both. `fs.watch` on `~/Library/Messages` triggers a debounced tick when a
`chat.db*` file changes. A 2 second interval tick runs anyway. A single `busy`
flag prevents overlapping ticks. File events are a speed-up, never the source of
truth.

One unverified report says macOS 26 terminates Messages.app when outside
processes hold long-lived connections to the database. [14] Open, query and close
on every tick. Never keep the database open.

### 2.4 Permissions

Full Disk Access (FDA):

- macOS blocks any app from reading chat.db without FDA. [4][5]
- An app cannot request FDA with a prompt. The user must add it in
  System Settings > Privacy & Security > Full Disk Access.
- Detect it by trying to open chat.db. A permission error means no FDA.
- In dev (`npm start` from Terminal), the grant that counts is usually the
  terminal app, because it is the responsible process. For the packaged app,
  grant FDA to `Vali.app`.
- macOS ties the grant to the code signature. An unsigned or ad-hoc rebuild can
  silently lose it. Re-check after every rebuild of the demo build.
- Restart the app after granting. [13]

Automation (Apple Events to Messages):

- The first `osascript` call that targets Messages shows a prompt
  "Vali wants access to control Messages". `imsg` lists this as required for
  sending. [5]
- A packaged app must declare `NSAppleEventsUsageDescription` in Info.plist.
  With electron-builder that goes in `build.mac.extendInfo`. [15][16]
- If the user clicks Don't Allow, `osascript` fails with error -1743
  (not authorized to send Apple events). Show the fix message below.
  macOS does not prompt again on its own. The user must flip the switch in
  System Settings > Privacy & Security > Automation.

UI messages (exact strings):

| Check | Message |
|---|---|
| No FDA | Vali needs Full Disk Access to read messages sent to Vali. Open System Settings, Privacy & Security, Full Disk Access, turn on Vali, then restart Vali. |
| Automation denied | Vali needs permission to control Messages to send replies. Open System Settings, Privacy & Security, Automation, and turn on Messages under Vali. |
| No iMessage account | Messages has no active iMessage account. Sign in to the Vali Apple ID in Messages, Settings, iMessage. |
| Send failed | Vali could not send to {handle}. Check that Messages is signed in and online. |

Add a "Open System Settings" button for the first two. The deep link pattern
`x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`
(and `?Privacy_Automation`) is widely used but undocumented. Test it on
macOS 27.

### 2.5 Sending with AppleScript

The current Messages dictionary uses `account` and `participant`. `buddy` and
`service` are older names that still appear in examples. [17][18]

Text:

```applescript
on run argv
  set theHandle to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set theAccount to 1st account whose service type = iMessage
    send theText to participant theHandle of theAccount
  end tell
end run
```

Run it with `execFile('osascript', ['-e', SCRIPT, handle, text])`. Arguments
go through `argv`, so message text is never spliced into script source. This
removes the quoting and injection problem.

File (screenshot):

```applescript
on run argv
  set theHandle to item 1 of argv
  set theFile to POSIX file (item 2 of argv)
  tell application "Messages"
    set theAccount to 1st account whose service type = iMessage
    send theFile to participant theHandle of theAccount
  end tell
end run
```

Attachment caveats:

- On Sequoia, sending a file from `~/Documents` showed "Not Delivered".
  Copying it into `~/Pictures` first worked. Posters said no other folder
  worked. [19]
- Fatbobman copies to `~/Pictures` for the same sandbox reason and waits
  2 to 5 seconds by file size so the upload can finish. [13]
- Sending to a chat instead of a participant reported success but the file
  never arrived. [19] Always target the participant.
- Plan: write outbound files to `~/Pictures/Vali Outbox/`, send, delete after
  2 minutes.

Other send caveats:

- `osascript` exit 0 does not prove delivery. One `imsg` fork re-reads chat.db
  for the new outgoing row to confirm. [20] We do the same: after a send, look for
  the latest `is_from_me = 1` row to that handle and log if `error != 0`.
- AppleScript cannot pick the outgoing number if one Apple ID has several. [5]
  A dedicated Apple ID avoids this.
- Newer macOS stores 1:1 chat GUIDs with an `any;-;` prefix that the AppleScript
  API does not recognize. [21] Another reason to send by participant, not chat id.
- No typing indicators, read receipts, tapbacks, edits or buttons without the
  Private API. [5][13]

### 2.6 Rate, reliability, and what breaks

- Apple publishes no iMessage rate limit. Users report Apple ID blocks for
  "spam or sending too many messages". [22] Vendors cite identical text to many
  new numbers and "Report Junk" taps as the triggers. Their numbers are not
  official. [23]
- Rules for Vali: never message a handle that has not texted Vali first.
  At most one help reply per unknown handle per 24 hours. Serial send queue
  with a gap of about 1.5 seconds. Cap 20 messages per handle per 10 minutes.
- AppleScript sending is known to be unstable under concurrency. Fatbobman caps
  concurrent sends to avoid crashing Messages. [13] We send one at a time.
- BlueBubbles reports occasional double sends with no known cause. [4]
- The Mac must stay awake and online. BlueBubbles suggests its keep-awake option
  or Amphetamine on laptops. [4] For the demo, plug in and run
  `caffeinate -dimsu` while the bridge is on.
- What has broken on recent macOS:
  - Ventura (13): `text` NULL, body in `attributedBody`. [8][9]
  - Sequoia (15): attachments outside `~/Pictures` fail. [19] Naive blob parsers
    truncate long messages. [10]
  - Tahoe (26): `text` NULL almost always. [10] `any;-;` chat GUIDs. [21]
    Unknown Senders screening is a Messages feature now. [24] Unverified report of
    Messages quitting when outside processes hold the database. [14]
  - macOS 27: no reports found. The demo laptop runs 27.0.1. Test first.
- Unknown Senders: on the Vali Apple ID, almost every user is unknown. We did
  not find whether filtered messages still land in chat.db as normal rows.
  Check this on day one. If they are hidden, turn screening off in Messages
  settings for the Vali account.

## 3. Identity model

### 3.1 One Apple ID for Vali

- Create a dedicated Apple ID for Vali (an iCloud email). Users text that email.
  An iPhone is not required on Vali's side. An email handle works for iMessage.
- Sign it in to Messages on the demo laptop. Messages holds one Apple ID at a
  time, so do this in a separate macOS user account named Vali.
- Benefit: that user's chat.db only holds Vali conversations. "Never read other
  chats" becomes a structural guarantee, not a promise in code.
- Run the Vali app in that macOS user. Keep the laptop plugged in and awake.
- Risk: brand-new Apple IDs sometimes sit in "waiting for activation" for iMessage.
  Create the ID today, not on demo day.

### 3.2 Linking a sender to a Vali account

The backend now has device linking (seen in `backend/vali_api/app.py`):

- `POST /v1/link/code` (authenticated) returns `{code, expires_in: 600}`.
  The 6-digit code seals the caller's bearer token.
- `POST /v1/link` with `{code}` (no auth) returns `{token}` once, then deletes the
  code.

Flow:

1. User opens the Vali extension or desktop app on their own device and taps
   Link iMessage. It calls `POST /v1/link/code` and shows the code.
2. User texts `link 123456` to the Vali Apple ID.
3. The bridge parses it with the same grammar as `parse.py`
   (`link` or `linkki`, 6 digits, spaces allowed).
4. The bridge calls `POST /v1/link`. On success it stores
   `handle -> token`, encrypted with Electron `safeStorage`, in `settings.json`.
5. Reply: "Linked! Your Vali app and iMessage now share one task list.
   Send me an errand."
6. On 404 reply with the link-failed text.

From then on the bridge calls the API with that user's token. No backend
iMessage channel is needed. The trade-off: the demo laptop holds bearer tokens
for every linked user. Fine for a hackathon. Add an Unlink action that deletes
the token.

Handle normalization: phone numbers to E.164 (`+358...`), emails lowercased
and trimmed. chat.db already stores phones as E.164 in `handle.id`. [8]

### 3.3 Allowed senders

Two modes in settings:

- `open` (default for judging): anyone may send `link NNNNNN` or get one help
  reply per 24 hours. Only linked handles can create errands.
- `allowlist`: only handles in `imessage.allowed` get any reply at all.
  Use this if spam or a stranger shows up during the demo.

### 3.4 Privacy rules

- Skip group chats and non-iMessage threads before decoding any text.
- Never log message bodies. Log rowid, handle last 4, and outcome only.
- Never copy chat.db. Never write to it. Open read-only, close every tick.
- Delete outbound screenshots from `~/Pictures/Vali Outbox/` after sending.

## 4. Mapping the WhatsApp flow

`backend/vali_wa/flow.py` (`WhatsAppFlow._handle`) and `render.py` hold the
logic. The bridge ports it to JS and calls the public API with the user's token.

| WhatsApp | iMessage bridge |
|---|---|
| Webhook POST from Meta | chat.db row with `ROWID > lastRowId` |
| `claim_whatsapp_message(id)` dedupe | `lastRowId` persisted, plus a `guid` set for the session |
| `mark_read` | Not possible without Private API. Skip. |
| `link 123456` -> `store.link_number` | `link 123456` -> `POST /v1/link`, store token per handle |
| Unknown number -> `render_help` | Unknown handle -> help text, once per 24 hours |
| Text errand -> `create_task(source='whatsapp')` | `POST /v1/tasks {task}`; remember the task id as bridge-owned |
| Voice note (ogg) -> `transcribe` | Audio attachment (`.caf`) -> convert -> `POST /v1/voice` with `create=1` |
| Image -> `read_letter` | Image attachment -> `POST /v1/letters` with the file |
| Reply `1`..`9` -> `execute(task, n-1)` | `POST /v1/tasks/{id}/execute {action_index: n-1}` |
| `da`/`yes`/`ok`/`kyllä`/`joo`/thumbs up -> `approve` | `POST /v1/tasks/{id}/approve` |
| `stop`/`nu`/`no`/`ei`/`cancel`/`lopeta` -> `stop` | `POST /v1/tasks/{id}/stop` |
| `status`/`tila`/`?` | `GET /v1/tasks/{id}`, render status |
| Free text during a running errand or open question -> `message` | `POST /v1/tasks/{id}/messages {text}` |
| Approve/Stop interactive buttons | Not available. Text replies only. |
| `push_task` after state change | Bridge polls its own active tasks and pushes changes |
| Approval live frame as image + caption | `GET /v1/tasks/{id}/live.jpg` -> `~/Pictures/Vali Outbox/` -> send file, then text |

Keep the exact precedence from `flow.py`:

1. `link` command first, before any user lookup.
2. Unlinked sender gets help.
3. Media becomes errand text. It is never an approval or a link command.
4. Short answers go to an open question or running execution, except `stop` and
   `status`. Exception: `no`, `nu`, `ei` answer an open question instead of
   stopping.
5. Then help, choose, approve, stop, status, in that order, with the same
   status guards (`awaiting_approval` for approve, active states for stop).
6. Anything else is a new errand.

Active task selection must match `active_task()` in `app.py`: latest task with an
active execution, else latest completed research with no execution, else latest.

### 4.1 Results out

- After creating a task, add its id to `imessage.tasks[handle]`.
- Every 5 seconds, `GET /v1/tasks/{id}` for each bridge-owned task that is not
  terminal. Drop it from the list when terminal.
- Diff with the previous snapshot. Reuse `notificationEvents` from
  `desktop/logic.mjs` (approval, question, done).
- Research finished: send `render_result` text.
- Question: send the question text once (WhatsApp uses `wa_question_sent`;
  keep a local equivalent).
- Awaiting approval: send the live frame as a file, then the summary text ending
  with "Reply da or yes to submit, or stop."
- Done, failed, stopped: send the matching `render_execution_update` text.

### 4.2 Rendering

`render.py` is Python and WhatsApp-flavored. Two options:

- A. Port `render_ack`, `render_result`, `render_execution_update`,
  `render_help`, `render_linked`, `render_link_failed`, `render_error` and
  `parse_command` to `desktop/imessage-text.mjs`. The extension already has
  `numberSources` and `citesFor` in `extension/lib/actions.js`, vendored into
  `desktop/vendor/lib/`.
- B. Ask the backend owner for a small endpoint that returns rendered chat
  bodies for a task, reusing `render.py`.

Recommendation: A. It has no backend dependency and stays offline-testable.
Port the tests in `backend/tests/wa` for the parser so the vocabulary cannot
drift.

iMessage changes to the text:

- Drop `*bold*` markers. iMessage shows asterisks literally.
- Replace "Vali extension" in help with "Vali app".
- Split long bodies at about 1500 characters on line breaks.

### 4.3 Voice memos

- iMessage audio messages are CAF. [8] The backend accepts
  `audio/webm, ogg, mp4, m4a, x-m4a, wav, x-wav` (`backend/vali_api/uploads.py`).
  CAF is not on the list.
- Convert on the Mac with the built-in `afconvert`:
  `afconvert -f m4af -d aac in.caf out.m4a`, then upload as `audio/mp4`.
- Wait for the file: the attachment row can appear before the download
  finishes. Retry for up to 15 seconds while the file is missing or growing.
- Unverified: that `afconvert` decodes the Opus-in-CAF voice memos from current
  iOS. Test with one real voice memo sent to the Vali Apple ID.
- Transcript empty or 400: reply "I could not hear that. Please type your errand."

## 5. Build plan: `desktop/imessage.mjs`

Main process only. No renderer code touches chat.db or `osascript`.

### 5.1 Files

| File | Contents |
|---|---|
| `desktop/imessage-core.mjs` | Pure: `decodeAttributedBody`, `normalizeHandle`, `parseCommand`, renderers, `eligible(row, settings)`, `appleToUnix(date)`. No Electron, no fs. |
| `desktop/imessage.mjs` | `createBridge({ dbPath, openDb, runScript, api, settings, save, now, log })`. Owns the poll loop, send queue, permission checks, task follow-up. |
| `desktop/test/imessage.test.mjs` | Fixture-based tests (section 6). |
| `desktop/test/fixtures/chatdb.mjs` | Builds a tiny chat.db in a temp dir. |

Every side effect is injected. Tests pass fakes. `main.mjs` passes the real ones.

Wiring needed elsewhere (not in this doc's scope, flag to the desktop owner):

- `main.mjs`: start the bridge after `connect()` when `config.imessage.enabled`.
  Never start it in `--smoke`.
- `preload.cjs`: expose `imessageStatus()`, `imessageToggle(on)`, `onImessage`.
- `package.json`: add the new files to `build.files` (the list is explicit, so a
  packaged app breaks without them). Add
  `build.mac.extendInfo.NSAppleEventsUsageDescription`.

### 5.2 Settings

Stored in `settings.json` next to the existing config:

```json
{
  "imessage": {
    "enabled": false,
    "mode": "open",
    "allowed": ["+358401234567"],
    "lastRowId": 0,
    "startedAt": 0,
    "links": { "+358401234567": "<safeStorage base64>" },
    "tasks": { "+358401234567": ["task-id"] },
    "helpSentAt": { "+358409999999": 0 }
  }
}
```

- Off by default.
- Toggle in Settings ("iMessage bridge") and in the tray menu
  ("iMessage: On / Off / Needs permission").
- On enable: run checks, set `startedAt = now`, set `lastRowId = MAX(ROWID)`,
  so history is never replayed.

### 5.3 Permission checks

Run on enable and every 60 seconds while enabled. Publish the result to the UI.

1. FDA: open chat.db read-only and run `SELECT MAX(ROWID) FROM message`.
   Permission error -> `needs_fda`.
2. iMessage account: `osascript` returning
   `count of (accounts whose service type = iMessage and enabled is true)`.
   Error -1743 -> `needs_automation`. Zero -> `needs_account`.
3. All good -> `running`.

The status drives the messages in section 2.4. The bridge never polls while not
`running`.

### 5.4 Poll loop

```js
async function tick() {
  if (busy || status !== 'running') return;
  busy = true;
  try {
    const db = openDb(dbPath);                 // read-only, short-lived
    let rows;
    try { rows = readSince(db, s.lastRowId, 50); } finally { db.close(); }
    for (const row of rows) {
      s.lastRowId = Math.max(s.lastRowId, row.rowid);
      await save();                            // persist before handling
      if (seen.has(row.guid) || !eligible(row, s)) continue;
      seen.add(row.guid);
      try { await handle(row); } catch (e) { log('handle failed', row.rowid, e.name); }
    }
  } finally { busy = false; }
}
watch(messagesDir, (_, f) => f?.startsWith('chat.db') && debounce(tick, 250));
setInterval(tick, 2000);
setInterval(followTasks, 5000);
```

- Dedupe by ROWID, persisted. Saving before handling gives at-most-once:
  a crash may drop one message but never creates a duplicate errand.
- SQLite can reuse the highest ROWID if that row is deleted. The `guid` set
  covers this within a session.
- Ignore rows with `date` before `startedAt`.

### 5.5 Send queue

- One FIFO queue, one `osascript` at a time, 20 second timeout each.
- Gap of 1.5 seconds between sends. Files wait 3 to 5 seconds by size after send.
- Retry once on a non-permission error. On -1743, stop the queue and set
  `needs_automation`.
- Per-handle cap: 20 messages per 10 minutes. Over the cap, drop and log.
- After each send, confirm via chat.db (latest outgoing row to the handle,
  `error = 0`). Log failures. Do not resend automatically.

### 5.6 API budget

The backend limits each IP to 300 requests per 10 minutes
(`SlidingWindow` in `backend/vali_api/guard.py`). The desktop app already polls
`/v1/tasks` every 4 seconds, which is 150 requests per 10 minutes. The bridge
follows tasks every 5 seconds, which adds 120 per active task. Two active
errands plus the desktop poll exceed the limit, and the laptop gets 429s.

Fixes, pick one before the demo:

- Ask the backend owner to raise the IP limit or exempt authenticated requests.
- Follow tasks every 10 seconds and only while they are active.

Also: `POST /v1/link` is limited to 10 per IP per 10 minutes. All judges link
through the one laptop IP, so at most 10 links per 10 minutes. Behind Modal's
proxy `request.client.host` may not be the real client IP. Check this.

## 6. Test strategy

All offline, with `node --test` (the existing `npm test`). No real chat.db, no
real `osascript`, no network.

Fixture builder `test/fixtures/chatdb.mjs`:

- Creates a temp `chat.db` with `node:sqlite`, WAL mode on.
- Creates only the columns listed in 2.1.
- `blob(text)` builds a synthetic `attributedBody`: a `streamtyped` header,
  `NSString`, `0x01 0x2B`, then the length (one byte, or `0x81` plus 2 bytes),
  then UTF-8 bytes.
- Helpers: `addHandle`, `addChat(style)`, `addMessage({...})`, `addAttachment`.

Fakes:

- `runScript(script, args)` records calls and returns scripted results,
  including a -1743 failure.
- `api` with canned task objects for each status.
- `now()` controllable.

Cases:

1. `text` set -> used as is.
2. `text` NULL, short blob -> decoded.
3. `text` NULL, 300-byte message with `0x81` length -> full text, no truncation.
4. Emoji and Finnish characters (ä, ö) survive decoding.
5. `text` is only `U+FFFC` with an image -> treated as an attachment message.
6. Group chat row (style 45) -> ignored, no decode, no send.
7. `is_from_me = 1` -> ignored.
8. Tapback row (`associated_message_type = 2000`) -> ignored.
9. Row dated before `startedAt` -> ignored.
10. Restart: `lastRowId` persisted, same rows never handled twice.
11. Unknown sender twice in a day -> one help reply.
12. `allowlist` mode, unknown sender -> no reply.
13. `link 123 456` -> `POST /v1/link` with `123456`, token stored, linked reply.
14. Bad code (404) -> link-failed reply, nothing stored.
15. Linked sender errand -> `POST /v1/tasks`, ack reply, task id tracked.
16. `da` while awaiting approval -> approve call. `da` with nothing pending ->
    "no submission awaiting approval".
17. `no` while a question is open -> forwarded as an answer, not a stop.
18. Approval follow-up -> file copied to the outbox path, file send, then text.
19. CAF attachment -> `afconvert` invoked (faked), upload to `/v1/voice`.
20. Send failure -1743 -> queue stops, status `needs_automation`.
21. Parser parity: the `parse.py` cases from `backend/tests/wa`, ported.

Manual check on the demo laptop (team does this, from a teammate's phone):

1. FDA and Automation prompts appear and the status UI updates.
2. Text from a known and an unknown handle.
3. Long message (300+ characters) arrives whole.
4. Screenshot arrives on the phone, not just "Delivered" on the Mac.
5. Voice memo transcribes.
6. Unknown Senders screening does not hide rows from chat.db.

## 7. Channel comparison

| Channel | Setup time | Approval needed | Works for judges | Risk |
|---|---|---|---|---|
| iMessage bridge | About 1 day to build, 1 hour to set up | None | Only iPhone, iPad or Mac users | Laptop must stay on. Fragile AppleScript. Apple ID can be flagged. Untested on macOS 27. |
| WhatsApp Cloud API | Already built | Meta business verification | Not now: sending is blocked | Blocked until Meta verifies the portfolio |
| Telegram bot | 2 to 4 hours (webhook into the backend, reuse `flow.py`) | None. BotFather gives a token in minutes [25] | Anyone who installs Telegram | Low technical risk. Many judges will not have Telegram. |
| Apple Messages for Business | Weeks or more | MSP, Apple review, live agents | No | Not feasible |

Recommendation:

- Build the iMessage bridge for the stage demo. It looks native on an iPhone,
  needs no approval, and reuses the flow logic.
- Run the demo from a teammate's iPhone. Do not promise judges self-service.
  Android judges cannot use it at all.
- Push back on one assumption: iMessage is not lower risk than Telegram. It is
  higher risk with a better look. Telegram is the safer channel and runs in the
  cloud with no laptop dependency. If there are 3 or more hours left after the
  bridge works, add Telegram as the fallback for Android judges.
- Do day-one checks before writing much code: macOS 27 decoding,
  Unknown Senders behavior, attachment delivery from `~/Pictures`, and Apple ID
  activation. Any one of these failing changes the plan.

## Sources

1. Apple, Messages for Business FAQ. https://register.apple.com/resources/messages/messaging-documentation/faq
2. Apple, MSP onboarding. https://register.apple.com/resources/messages/msp-onboarding/
3. mluvii docs, Apple Messages for Business setup (approval in 1 to 2 business days). https://docs.mluvii.com/en/for-administrators/tenant-management/settings/apple-messages-for-business
4. BlueBubbles FAQ. https://bluebubbles.app/faq/
5. openclaw/imsg README (formerly steipete/imsg). https://github.com/openclaw/imsg
6. steipete/imsg. https://github.com/steipete/imsg/
7. BlueBubbles, Private API installation (SIP). https://docs.bluebubbles.app/private-api/installation
8. Jachimo, Apple iMessage Databases on macOS and iOS. https://jachimo.github.io/research/imessage-chatdb-reference
9. r/osx, chat.db message.text values suddenly mostly NULL. https://www.reddit.com/r/osx/comments/1jvgaa0/
10. Bug reports: "parseAttributedBody truncates messages >127 bytes on macOS 15" and "messages not detected on macOS 26 (text column is NULL)". https://claudeissues.com/issue/41520-imessage-plugin-parseattributedbody-truncates-messages-127-bytes-on-macos-15 and https://claudeissues.com/issue/41783-imessage-channel-plugin-messages-not-detected-on-macos-26-text-column-is-null
11. dkdc-io-imessage, `attributed.rs` decoder. https://docs.rs/crate/dkdc-io-imessage/0.1.1/source/src/attributed.rs
12. imessage-max, `parsing.py` (NSString and NSMutableString markers). https://glama.ai/mcp/servers/@cyberpapiii/imessage-max/blob/f13c315f32c9d33eaf87106446f201bdab9305ec/src/imessage_max/parsing.py
13. Fatbobman, Deep dive into iMessage. https://fatbobman.com/en/posts/deep-dive-into-imessage/
14. imessage-max CLAUDE.md (Tahoe terminates Messages with open connections, unverified). https://glama.ai/mcp/servers/@cyberpapiii/imessage-max/blob/6cf97e056a1af9e3fd311184adbd42010aa3788c/CLAUDE.md
15. electron-builder, mac configuration (`extendInfo`). https://www.electron.build/v26/docs/mac
16. node-mac-permissions README (`NSAppleEventsUsageDescription`). https://cdn.jsdelivr.net/npm/@fork-anyone/node-mac-permissions@2.7.1/README.md
17. Keyboard Maestro forum, Send iMessage reliability 2023 (participant and account). https://forum.keyboardmaestro.com/t/send-imessage-action-2023-reliability-and-alternate-methods/32267
18. MacScripter, Sending an iMessage via osascript to multiple recipients. https://www.macscripter.net/t/sending-an-imessage-via-osascript-to-multiple-recipients/74772
19. MacScripter, Sequoia: Messages send file. https://www.macscripter.net/t/sequoia-messages-send-file/76468
20. digimata/imsg (confirms sends by re-reading chat.db). https://github.com/digimata/imsg
21. Bug report: reply fails with `any;-;` chat GUID format. https://claudeissues.com/issue/46747-imessage-plugin-reply-fails-on-macos-with-any-chat-guid-format
22. Apple Community, Apple ID for iMessage and FaceTime blocked. https://discussions.apple.com/thread/255044633
23. Blooio, Messaging safety limits and recovery (vendor, not official). https://docs.blooio.com/guides/messaging-safety
24. Apple, Messages User Guide for macOS Tahoe (screening unknown senders). https://support.apple.com/en-ie/guide/messages/ichtf161aa4d/14.0/mac/26
25. Telegram, From BotFather to Hello World. https://core.telegram.org/bots/tutorial

Local facts come from this repo: `backend/vali_wa/flow.py`, `render.py`,
`parse.py`, `backend/vali_api/app.py` (`/v1/link/code`, `/v1/link`, `/v1/voice`,
`active_task`), `backend/vali_api/uploads.py`, `backend/vali_api/guard.py`,
`desktop/main.mjs`, `desktop/logic.mjs`, `desktop/package.json`.
