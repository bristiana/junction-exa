# Vali desktop

A plain Electron companion for errands in Finland. The extension remains the source of the mascot, panel, API client, and WhatsApp pairing UI; `prepare` copies them into ignored `vendor/` before installation/start/packaging. Desktop adapters live in `renderer/`.

```sh
cd desktop
npm install
npm start
npm test
```

The lilac mascot starts at the bottom right and stays above windows on all macOS Spaces (including fullscreen). Drag its dotted handle to move it. A badge shows how many errands are running and an amber ring means one needs you. Hover or click the mascot for the list of every errand (running, waiting for you, done today) with Approve, Stop and Answer right there, plus the live view of the run in progress; double-click opens the chat. The menu bar offers Open chat, New errand, Talk to Vali, Pause/Resume and Quit.

Giving Vali an errand:

- **Type**: Alt+Space opens the quick box in the middle of the screen (Alt+V if Alt+Space is taken). Suggestions follow what you type; arrows pick one, Enter sends, Escape closes. If Chrome, Safari, Arc, Brave or Edge is the app in front, its tab title and address come along as a chip you can remove.
- **Talk**: hold Alt+Shift+Space, say the errand, let go (a quick tap keeps listening until you press again), or click the microphone. The audio goes to `POST /v1/voice` with `create=1`; with a page or selection attached, Vali transcribes first and sends the text with that context. macOS asks for the microphone once.
- **Drop a letter**: drop a photo or PDF (JPEG, PNG, WebP, HEIC, PDF, up to 10 MB) on the mascot, or on the quick box to add a note first. It goes to `POST /v1/letters`.
- **Ask Vali about this**: select text anywhere and press Alt+Shift+A. Vali copies the selection (a simulated Cmd+C, then your clipboard is put back) and opens the quick box with it attached. This needs Accessibility for Vali (System Settings > Privacy & Security > Accessibility); without it Vali offers what is already on your clipboard. Reading the browser tab needs the Automation permission macOS asks for the first time. Without either permission the context is simply left out.

The default server is `https://bogdan-c-2206--vali-web.us-east.modal.run`. On first launch Vali creates an account with `POST /v1/users` and offers to link with the extension instead. Settings > Link with the extension: type the code the extension shows (`POST /v1/link`), or press Show this Mac's code (`POST /v1/link/code`) and type it in the extension. If the server does not have those endpoints yet, the app says linking is coming soon; Advanced still accepts an account token. Advanced also holds the server URL and research depth.

Settings > Profile holds your name, address, birth date, email, phone, personal ID and the rest of the extension's fields. They stay on this Mac: settings live in `app.getPath('userData')/settings.json` (normally `~/Library/Application Support/Vali`, mode 0600) and the account token and profile are encrypted with Electron safeStorage (your login keychain). As in the extension, the AI only sees placeholders like `{{name}}`; the profile is sent only with "Let Vali do it" (`POST /v1/tasks/{id}/execute`), so the cloud browser can type the values. macOS may request Keychain access.

The task list refreshes every four seconds. Questions from the cloud browser can be answered in the list or in the chat (`/v1/tasks/{id}/messages`). Desktop opens external links in your default browser. Pause suspends desktop polling and notifications; cloud errands continue. Notifications fire on approval, a new question and completion; clicking one opens the list. Closing chat keeps Vali running; Quit exits.

`VALI_USER_DATA=/some/dir npm start` runs a separate instance with its own account, for testing.

## Live check

```sh
npm run live-check
```

Drives `api.mjs` (the client the app uses) against the live server with a throwaway account: new account, link/voice/letters endpoints, a find errand, a claim errand, and a cloud browser run on httpbin's test form (https://httpbin.org/forms/post) that it approves. It approves nothing else.

## Smoke captures

```sh
SMOKE_OUT=/private/tmp/vali-desktop npm start -- --smoke
```

Smoke uses isolated temporary userData and a clearly local fixture, sends no API requests and registers no shortcuts. It writes `mascot.png`, `chat.png`, `glance.png`, `chat-question.png`, `glance-question.png`, `settings.png`, `settings-profile.png`, `quick.png` and `quick-listening.png`, then quits. Missing output, renderer errors, empty captures, or timeout fail the command. It checks the UI only; it does not prove live API calls, the microphone, AppleScript permissions, notifications or all-Spaces behavior.

## Package with electron-builder

```sh
npm run pack  # unpacked Vali.app in dist/mac-<arch>/
npm run dist  # unsigned dmg in dist/, e.g. dist/Vali-0.1.0-arm64.dmg
```

The config is in `package.json`. `npm run icon` rebuilds `build/icon.icns` from `extension/icons/icon-mascot.svg` (needs `rsvg-convert` and macOS `iconutil`; otherwise the committed icon is used). The build is unsigned (`identity: null`): on first open, right-click Vali.app and choose Open, or allow it in System Settings > Privacy & Security. The Info.plist carries the microphone and Automation usage texts. For distribution, set up Apple signing and notarization in your build environment; no credentials are in this repository.
