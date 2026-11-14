# Vali desktop

A plain Electron companion for errands in Finland. The extension remains the source of the mascot, panel, API client, and WhatsApp pairing UI; `prepare` copies them into ignored `vendor/` before installation/start/packaging. Desktop adapters live in `renderer/`.

```sh
cd desktop
npm install
npm start
npm test
```

The lilac mascot starts at the bottom right, stays above windows on all macOS Spaces (including fullscreen), and opens chat when clicked. Drag its dotted handle to move it. The menu bar offers Open chat, New errand, Pause/Resume, and Quit. Alt+Space opens the task box beside the mascot, with Alt+V as fallback if registration fails. If both are occupied, use New errand in the menu bar. Enter sends; Escape closes. Chat supports Cmd/Ctrl+Enter.

The default server is `https://bogdan-c-2206--vali-web.us-east.modal.run`. On first launch Vali creates a user with `POST /v1/users`, keeps the bearer token, and verifies it with `/v1/me`. Settings supports another server, an existing account token (to share the extension's account), and Link WhatsApp (`/v1/pair`, then send the displayed code to Vali on WhatsApp). A new desktop account does not automatically share an existing extension account. Use the same token or pair this desktop account with your phone. Server URLs and settings live in Electron's `app.getPath('userData')/settings.json` (normally `~/Library/Application Support/Vali`); the token is encrypted with Electron safeStorage and the file is mode 0600. No credentials belong in this repository. macOS may request Keychain access.

The task list refreshes every four seconds. Expand a task to review research, sources, drafts, browser steps, live screenshots, approval details, and questions. Approve permits submission; Stop stops the browser; Send answer posts to `/v1/tasks/{id}/messages`. URL actions offer “Let Vali do it” to start cloud execution. Browser form-fill actions belong to the extension. Desktop opens external links in your default browser.

Pause suspends desktop polling and notifications; cloud errands continue. Resume catches up. Notifications fire on approval, a new question, and completion, with the first fetched list as a quiet baseline. Click a notification to open its task. Enable notifications for Vali in macOS System Settings if needed. Closing chat keeps the tray companion running; Quit exits.

## Smoke captures

```sh
SMOKE_OUT=/private/tmp/vali-desktop npm start -- --smoke
```

Smoke uses isolated temporary userData and a clearly local fixture, sends no API requests, opens both windows, waits for UI readiness and a decoded fixture browser frame, writes `mascot.png`, `chat.png`, `chat-question.png`, and `quick.png`, then quits. Missing output, renderer errors, empty captures, or timeout fail the command. It checks Electron/UI startup; it does not prove live API execution, notification permissions, all-Spaces behavior, or successful packaging/signing.

## Package with electron-builder

```sh
npm run pack  # unpacked app in dist/, useful for local testing
npm run dist  # macOS dmg in dist/
```

The config is in `package.json`. Package on macOS for the dmg. Configure Apple signing/notarization credentials in your build environment for distribution; they are not included here. No dmg is built by the smoke check. Dependencies resolve the current stable Electron at install time; the lockfile records the exact version.
