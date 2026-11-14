# Vali desktop

A plain Electron companion for errands in Finland. The extension remains the source of the mascot, panel, API client, and WhatsApp pairing UI; `prepare` copies them into ignored `vendor/` before installation/start/packaging. Desktop adapters live in `renderer/`.

```sh
cd desktop
npm install
npm start
npm test
```

The lilac mascot starts at the bottom right and stays above windows on all macOS Spaces (including fullscreen). Drag its dotted handle to move it; Vali remembers the spot (if that display is still connected). A badge shows how many errands are running, and a ring with a ringing bell means one needs you. A speech bubble says what he is doing in one line. Hover or click the mascot for the list of every errand (what needs you first, then what is working, then what is done today), each with one status line in the words the extension uses (Waiting for your OK, Needs your answer, Needs login, Working, Done, Couldn't finish) and Approve, Stop, Answer or Open the site right there; the live view of the run in progress sits inside its errand; double-click opens the chat. The menu bar offers Open chat, New errand, Talk to Vali, Say an errand, Pause/Resume and Quit.

Vali on screen (`valet.mjs` decides, `stage.mjs` moves the window):

- He breathes and blinks while idle, works on his laptop while an errand runs, holds the tray and rings the bell when one needs your OK, bows when it is done and fusses when it failed. The poses are the states of `extension/lib/butler.js`.
- When you type near him (keyboard input with the pointer still, within 160 pt, for 1.6 s) he walks to the nearest screen edge (left, right or bottom) and leaves 64 pt showing. Hover the part that shows and he comes back. If an errand needs you while he is aside, he peeks further in with the bell. Only the system idle time and the pointer position are read: no keystrokes, no extra permission. Typing in Vali's own windows and the first five seconds after you hover or click him never count.
- After five minutes with nothing running, nothing waiting for you and no talking, he falls asleep (eyes closed, a few z's). A hover, a click or a new errand wakes him.
- On hover, with a browser in front, the bubble offers help with that site (the address only, never the page).
- With Reduce motion on, he stands still, does not glide and the bell does not swing.

Giving Vali an errand:

- **Talk to Vali**: click Talk on the mascot (it shows on hover) or press Alt+Shift+V, and talk with Vali's ElevenLabs agent. It can start an errand, read back what it found or what it will submit, approve, stop, and answer a question; the list beside the mascot updates as it does. The ring and his mouth follow the voice, the bubble shows his last line, and Stop (or Alt+Shift+V again) ends the conversation. The app asks the Vali server for a one-off credential (`POST /v1/voice/session`) and connects with `@elevenlabs/client` over WebRTC. macOS asks for the microphone once; if it is off, the bubble says so and opens the setting.
- **Type**: Alt+Space opens the quick box in the middle of the screen (Alt+V if Alt+Space is taken). Suggestions follow what you type; arrows pick one, Enter sends, Escape closes. If Chrome, Safari, Arc, Brave or Edge is the app in front, its tab title and address come along as a chip you can remove.
- **Say an errand**: hold Alt+Shift+Space, say the errand, let go (a quick tap keeps listening until you press again), or click the microphone. The audio goes to `POST /v1/voice` with `create=1`; with a page or selection attached, Vali transcribes first and sends the text with that context. macOS asks for the microphone once.
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

Drives `api.mjs` (the client the app uses) against the live server with a throwaway account: new account, link/voice/letters endpoints, a Talk to Vali credential (`POST /v1/voice/session`), a find errand, a claim errand, and a cloud browser run on httpbin's test form (https://httpbin.org/forms/post) that it approves. It approves nothing else.

## Talk check

```sh
VALI_USER_DATA=/tmp/vali-talk npm run talk-check
```

Starts one real conversation on a throwaway account in that folder, with Chromium's fake microphone (a tone): it passes when the session connects and the agent's first line arrives as a caption. It cannot check speech recognition, what you hear or the agent's errand tools; that needs a person talking.

## Smoke captures

```sh
SMOKE_OUT=/private/tmp/vali-desktop npm start -- --smoke
```

Smoke uses isolated temporary userData and a clearly local fixture, sends no API requests and registers no shortcuts. It writes the mascot (`mascot`, `mascot-working`, `mascot-talk`, `mascot-done`, `mascot-error`, `mascot-sleep`), the list (`glance`, `glance-question`, `glance-all` with every status at once), the chat and settings (`chat`, `chat-question`, `settings`, `settings-profile`, `settings-imessage`) and the quick box (`quick`, `quick-empty`, `quick-pick`, `quick-letter`, `quick-listening`) as PNGs, plus `-light` copies of `glance-all`, `chat`, `quick-pick`, `mascot-working` and `mascot-talk`, checks that Vali walks to the edge and back, then quits. Missing output, renderer errors, empty captures, or timeout fail the command. It checks the UI only; it does not prove live API calls, the microphone, AppleScript permissions, notifications or all-Spaces behavior.

## Package with electron-builder

```sh
npm run pack  # unpacked Vali.app in dist/mac-<arch>/
npm run dist  # unsigned dmg in dist/, e.g. dist/Vali-0.1.0-arm64.dmg
```

The config is in `package.json`. `npm run icon` rebuilds `build/icon.icns` from `extension/icons/icon-mascot.svg` (needs `rsvg-convert` and macOS `iconutil`; otherwise the committed icon is used). The build is unsigned (`identity: null`): on first open, right-click Vali.app and choose Open, or allow it in System Settings > Privacy & Security. The Info.plist carries the microphone and Automation usage texts. For distribution, set up Apple signing and notarization in your build environment; no credentials are in this repository.
