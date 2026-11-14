# Vali design system

Load `tokens.css` then `components.css`; put `.v-app` on `body`. No build step. Open `preview.html` to see every state.

1. Use tokens only (`--v-*`). No raw hex, px font sizes or ad-hoc shadows in surface CSS.
2. One `.v-btn` (primary) per view, for the next step. Everything else is `--quiet`; `--danger` only for Stop / Delete.
3. Every errand in a list is a `.v-row`: title, one status line (`<b>Status</b> · detail`), at most two inline actions.
4. Row tone follows who acts: Vali working = default, needs the user = `warning`, done = `success`, failed = `danger`.
5. `.v-card` holds one errand's detail; add `--attention` only while it waits for the user.
6. `.v-badge` for status words and `--count` for numbers; `--live` (pulsing dot) only while something is running.
7. `.v-live` shows the cloud browser; its chip says what happens now. Add `--waiting` when it is held for the user's OK.
8. `.v-bubble` is the mascot talking: one or two short sentences, first person, never a question it cannot act on.
9. `.v-empty` gets a mascot, a 3-word title, one sentence, one button.
10. Copy is plain and short: "Working", "Waiting for your OK", "Needs login", "Done", "Couldn't finish", "Stopped". Say what was or wasn't sent.

Theme: follows the OS; set `data-theme="light|dark"` on any element to force it. Motion turns off under `prefers-reduced-motion`.
