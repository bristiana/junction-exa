// Vali presence: Vali comes with you. A small Vali rests at the bottom-right of the page; click it to ask anything
// ("Ask Vali anything": only the typed question and the page address are sent). Once per page it also speaks up:
// - a tip for this page (POST /v1/companion via the background) with its sources and "Do it", which starts the errand;
// - or, on pages with a real form and no tip, the offer to fill it in ("Yes" opens the side panel; "Not now" silences
//   the site for 7 days, and the offer shows at most 3 times per site per day).
// What leaves the page for a tip: site and first path segment, title, h1-h3 headings and language. Never the selection
// or form values.
// Rules: only once the page settled, never while the user types or scrolls, never on search, mail, chat, payment or
// banking sites, off when settings.presence === false ("Vali tips while you browse").
// Classic content script: no imports; lib/butler.js runs first and draws Vali. The bubble lives in a closed shadow root
// so page CSS cannot reach it.
(function () {
  "use strict";
  if (globalThis.__valiPresence) return;

  // ---------- rules (pure; test/presence.test.mjs loads this file to check them) ----------
  const BLOCKED = [
    // search and the Web Store
    "google.com", "google.fi", "bing.com", "duckduckgo.com", "ecosia.org",
    // mail and chat
    "outlook.live.com", "outlook.office.com", "outlook.office365.com", "mail.yahoo.com", "proton.me", "protonmail.com",
    "icloud.com", "whatsapp.com", "messenger.com", "telegram.org", "discord.com", "slack.com", "teams.microsoft.com",
    "teams.live.com", "chatgpt.com", "claude.ai",
    // banks in Finland and strong identification
    "op.fi", "nordea.fi", "nordea.com", "danskebank.fi", "s-pankki.fi", "aktia.fi", "saastopankki.fi", "omasp.fi",
    "handelsbanken.fi", "poppankki.fi", "alandsbanken.fi", "tunnistus.suomi.fi",
    // payment pages
    "paytrail.com", "klarna.com", "stripe.com", "paypal.com", "mobilepay.fi", "nets.eu",
  ];
  const FORM_WORDS_EN = /(?<![a-z])(claim|refund|compensation|apply|application|booking|reservation|regist(?:er|ration)|complain)/i;
  // Finnish stems match inside compounds and inflected forms: asumistukihakemus, korvauksen, varaukset, palautteen
  const FORM_WORDS_FI = /(hakemu|korvau|varau|ilmoittautu|muuttoilmoitu|palaut)/i;

  function siteOf(host) {
    return String(host || "").toLowerCase().replace(/^www\d?\./, "").replace(/\.$/, "");
  }
  function blockedHost(host) {
    const h = siteOf(host);
    if (!h) return true;
    if (/^(mail|webmail)\./.test(h)) return true;
    return BLOCKED.some((d) => h === d || h.endsWith("." + d));
  }
  function formWords(text) {
    const s = String(text || "");
    return FORM_WORDS_EN.test(s) || FORM_WORDS_FI.test(s);
  }
  globalThis.__valiPresence = { blockedHost, formWords, siteOf };

  // ---------- only on ordinary top-level pages ----------
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.top !== window) return;
  if (!/^(https?|file):$/.test(location.protocol)) return;
  if (blockedHost(location.hostname) && location.protocol !== "file:") return;
  const ext = globalThis.chrome;
  if (!ext?.runtime?.id) return;

  const TIP_DWELL_MS = 2500;
  const DWELL_MS = 8000;
  const MAX_PER_DAY = 3;
  const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
  const AFTER_YES_MS = 60 * 60 * 1000;
  const KEY = "presenceSites";
  const site = siteOf(location.hostname) || "file";
  const alive = () => { try { return !!ext.runtime?.id; } catch (_) { return false; } };

  // ---------- is there a form worth filling? ----------
  const TEXTLIKE = new Set(["text", "email", "tel", "number", "date", "url", "datetime-local", "month", "time", "week", "textarea", "select-one", "select-multiple", "select"]);
  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  }
  function scanFields() {
    let count = 0;
    let payment = false;
    let looked = 0;
    for (const el of document.querySelectorAll("input, select, textarea")) {
      if (++looked > 300) break;
      const type = (el.type || el.localName || "").toLowerCase();
      if (!TEXTLIKE.has(type) || el.disabled || el.readOnly) continue;
      if (el.closest("[role=search], form[role=search], form[action*=search i]")) continue;
      const hint = `${el.autocomplete || ""} ${el.name || ""} ${el.id || ""}`.toLowerCase();
      if (/\bcc-|card.?number|cardnumber|cvc|cvv/.test(hint)) payment = true;
      if (!visible(el)) continue;
      count++;
    }
    return { count, payment };
  }
  function pageSignals() {
    let url = location.pathname + " " + location.search;
    try { url = decodeURIComponent(url); } catch (_) {}
    const heads = [...document.querySelectorAll("h1, h2")].slice(0, 3).map((h) => h.textContent || "").join(" ");
    return `${url} ${document.title} ${heads}`.replace(/\s+/g, " ").slice(0, 600);
  }
  function isFormPage() {
    const f = scanFields();
    if (f.payment || !f.count) return false;
    return f.count >= 3 || formWords(pageSignals());
  }

  // ---------- what a tip is asked with ----------
  const clipText = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  function inEditable(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!el?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false])");
  }
  function pageContext() {
    const headings = [...document.querySelectorAll("h1, h2, h3")]
      .filter((h) => !inEditable(h) && !h.closest("form, nav, header, dialog, [role=dialog], [aria-modal=true]")) // not menus or cookie banners
      .map((h) => clipText(h.textContent, 120))
      .filter(Boolean)
      .slice(0, 12);
    return { url: location.href, title: clipText(document.title, 200), headings, lang: document.documentElement.lang || "" };
  }
  function send(msg) {
    return new Promise((resolve) => {
      try {
        ext.runtime.sendMessage(msg, (res) => { void ext.runtime.lastError; resolve(res || { ok: false }); });
      } catch (_) {
        resolve({ ok: false });
      }
    });
  }

  // ---------- caps (chrome.storage.local) ----------
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }; // local day
  async function readSite() {
    try {
      const r = await ext.storage.local.get(KEY);
      const s = (r[KEY] || {})[site] || {};
      return { day: today(), n: s.day === today() ? s.n || 0 : 0, snoozeUntil: s.snoozeUntil || 0, yesAt: s.yesAt || 0 };
    } catch (_) {
      return null;
    }
  }
  async function writeSite(s) {
    try {
      const r = await ext.storage.local.get(KEY);
      const all = r[KEY] || {};
      const now = Date.now();
      for (const k of Object.keys(all)) {
        const v = all[k] || {};
        if (v.day !== today() && (v.snoozeUntil || 0) < now && now - (v.yesAt || 0) > AFTER_YES_MS) delete all[k];
      }
      all[site] = s;
      await ext.storage.local.set({ [KEY]: all });
    } catch (_) {}
  }

  // ---------- when it's polite ----------
  const act = { visibleMs: 0, lastTick: Date.now(), scrollAt: 0, keyAt: 0 };
  // Events from inside Vali reach the page retargeted to the host element; they are not the user using the page.
  const fromVali = (e) => !!ui.host && e.target === ui.host;
  addEventListener("scroll", () => { act.scrollAt = Date.now(); }, { passive: true, capture: true });
  addEventListener("wheel", () => { act.scrollAt = Date.now(); }, { passive: true, capture: true });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.mode) { closeBubble(); return; }
    if (!fromVali(e)) act.keyAt = Date.now();
  }, true);
  addEventListener("input", (e) => {
    if (fromVali(e)) return;
    act.keyAt = Date.now();
    if ((ui.mode === "tip" || ui.mode === "offer") && !ui.answered) closeBubble(); // they are filling it in themselves
  }, true);
  // A click anywhere else on the page closes the ask bubble.
  addEventListener("pointerdown", (e) => { if (ui.mode === "ask" && !fromVali(e)) closeBubble(); }, true);
  function focusedField() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return !!a && a !== ui.host && (a.isContentEditable || /^(input|textarea|select)$/i.test(a.localName || ""));
  }
  function quiet() {
    const now = Date.now();
    return document.visibilityState === "visible" && !focusedField() && now - act.keyAt > 3000 && now - act.scrollAt > 1500;
  }

  // ---------- Vali in the corner, and its bubble ----------
  // Vali rests in the bottom-right corner. Clicking it opens "Ask Vali anything"; a tip, the form offer or a message
  // from the background shows in the same bubble. One bubble at a time: the ask bubble replaces the tip while open.
  const CSS = `
  :host { all: initial; }
  .wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; display: flex; align-items: flex-end; gap: 6px;
    --card: #ffffff; --text: #34305a; --muted: #6e6890; --line: #e6dcef; --ink: #34305a; --on-ink: #ffffff;
    --accent: #7656c9; --fill: #f1eafb; --fill-2: #f6effa; --ring: #b9a3ec;
    --shadow: 0 12px 32px rgba(52,48,90,.14), 0 1px 3px rgba(52,48,90,.08);
    font: 500 13.5px/1.45 "Vali Jakarta", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text);
    transform: translateX(calc(100% + 40px)); opacity: 0; pointer-events: none;
    transition: transform .5s cubic-bezier(.16,1,.3,1), opacity .25s ease; }
  @media (prefers-color-scheme: dark) {
    .wrap { --card: #1e1a29; --text: #ece8f6; --muted: #a49cba; --line: #3d3552; --ink: #b7a6f4; --on-ink: #1d1733;
      --accent: #b7a6f4; --fill: #2d2650; --fill-2: #272236; --ring: #b7a6f4;
      --shadow: 0 8px 24px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.3); color-scheme: dark; }
  }
  .wrap.in { transform: none; opacity: 1; pointer-events: auto; }
  .bubble { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 12px 14px;
    max-width: 290px; box-shadow: var(--shadow); margin-bottom: 18px; animation: pop .22s cubic-bezier(.3,1.4,.5,1); }
  .bubble[hidden] { display: none; }
  .bubble::after { content: ""; position: absolute; right: -7px; bottom: 26px; width: 12px; height: 12px; background: var(--card);
    border: solid var(--line); border-width: 1px 1px 0 0; transform: rotate(45deg); border-radius: 0 3px 0 0; }
  @keyframes pop { from { transform: scale(.94) translateX(8px); opacity: 0; } }
  .line { margin: 0; }
  .tip .line, .say .line { padding-right: 20px; }
  .srcs { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0; }
  .srcs a { font-size: 12px; font-weight: 600; color: var(--accent); background: var(--fill); border-radius: 999px; padding: 2px 9px; text-decoration: none; }
  .srcs a:hover { text-decoration: underline; }
  .btns { display: flex; gap: 6px; margin-top: 8px; }
  button { font: inherit; font-weight: 700; border: 0; border-radius: 12px; padding: 7px 14px; cursor: pointer; }
  button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  button:disabled { opacity: .6; cursor: default; }
  .yes { background: var(--ink); color: var(--on-ink); }
  .no { background: var(--fill); color: var(--text); }
  .close { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; padding: 0; border-radius: 50%;
    background: transparent; color: var(--muted); font-size: 16px; line-height: 24px; }
  .close:hover { background: var(--fill-2); color: var(--text); }
  .face { all: unset; box-sizing: border-box; display: block; width: 76px; height: 76px; flex: none; margin: 0 -8px -6px 0; cursor: pointer;
    border-radius: 50%; filter: drop-shadow(0 4px 10px rgba(52,48,90,.18)); transition: width .3s cubic-bezier(.16,1,.3,1), height .3s cubic-bezier(.16,1,.3,1); }
  .face:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .wrap.open .face { width: 112px; height: 112px; margin: 0 -14px -10px -8px; }
  .face svg, .face img { display: block; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  /* Ask Vali anything */
  .ask { width: 300px; max-width: calc(100vw - 150px); box-sizing: border-box; }
  .ask-form { display: flex; gap: 6px; align-items: center; margin: 0; }
  .ask-input { all: unset; box-sizing: border-box; flex: 1; min-width: 0; height: 38px; padding: 0 12px; border-radius: 12px;
    background: var(--fill-2); border: 1px solid var(--line); color: var(--text); font: inherit; font-size: 14px; cursor: text; }
  .ask-input::placeholder { color: var(--muted); opacity: 1; }
  .ask-input:focus { border-color: var(--ring); }
  .send { flex: none; width: 38px; height: 38px; padding: 0; border-radius: 12px; background: var(--ink); color: var(--on-ink);
    display: grid; place-items: center; }
  .send svg { width: 18px; height: 18px; display: block; }
  .q { margin: 0 22px 6px 0; color: var(--muted); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .answer { margin: 0 0 0; font-size: 14px; padding-right: 4px; }
  .status { margin: 0; display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .dots { display: inline-flex; gap: 3px; }
  .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: dot 1.1s infinite ease-in-out; }
  .dots i:nth-child(2) { animation-delay: .15s; } .dots i:nth-child(3) { animation-delay: .3s; }
  @keyframes dot { 0%, 80%, 100% { opacity: .25; transform: none; } 40% { opacity: 1; transform: translateY(-2px); } }
  .err { margin: 0; padding-right: 20px; }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
  .foot .yes { padding: 6px 16px; }
  .link { background: none; padding: 2px 4px; margin-left: -4px; border-radius: 6px; color: var(--accent); font-weight: 600; font-size: 12.5px; }
  .link:hover { text-decoration: underline; }
  .hint { color: var(--muted); font-size: 12px; }
  @media (prefers-reduced-motion: reduce) { .wrap { transition: opacity .15s linear; transform: none; } .bubble, .dots i { animation: none; } }
  @media print { .wrap { display: none; } }`;

  const ui = { host: null, wrap: null, bubble: null, face: null, mascot: null, img: null, mode: null, answered: false, hovered: false, timer: 0 };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(cls, text, onClick) {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e, b); });
    return b;
  }
  function line(text) {
    const p = el("p", "line", text);
    p.setAttribute("role", "status");
    return p;
  }
  function row(...buttons) {
    const d = el("div", "btns");
    d.append(...buttons);
    return d;
  }
  function closeButton() {
    const b = button("close", "×", () => { ui.answered = true; closeBubble(); });
    b.setAttribute("aria-label", "Close");
    return b;
  }

  // The animated Vali (lib/butler.js, lilac); the still picture of the same state if it cannot draw here.
  function drawVali(box) {
    try {
      return { mascot: globalThis.Butler.create(box, { palette: "lilac", state: "idle", reducedMotion: "auto", trackPointer: true, hoverReact: true }), img: null };
    } catch (_) {
      const img = el("img");
      img.alt = "";
      img.src = ext.runtime.getURL("mascot/idle.svg");
      box.replaceChildren(img);
      return { mascot: null, img };
    }
  }
  function setMood(state) {
    if (ui.mascot) ui.mascot.setState(state);
    else if (ui.img) ui.img.src = ext.runtime.getURL(`mascot/${state}.svg`);
  }
  // How Vali looks with no bubble open: still working on a question, an answer waiting to be read, or at rest.
  function restMood() {
    if (ask.state === "thinking" || ask.state === "searching") return ask.state;
    if (ask.unseen) return ask.state === "done" ? "success" : "error";
    return "idle";
  }

  // Plus Jakarta Sans for the bubble and the selection button, under its own name so the page's fonts stay as they are.
  function addFont() {
    try {
      const url = ext.runtime.getURL("shared/fonts/plus-jakarta-sans.woff2");
      document.fonts.add(new FontFace("Vali Jakarta", `url("${url}") format("woff2")`, { weight: "200 800" }));
    } catch (_) {}
  }

  function mount() {
    if (ui.host || page.off || !alive()) return;
    const host = document.createElement("vali-presence");
    host.style.cssText = "all:initial;position:fixed;right:0;bottom:0;width:0;height:0;z-index:2147483646;";
    const root = host.attachShadow({ mode: "closed" });
    try { const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet]; }
    catch (_) { const st = document.createElement("style"); st.textContent = CSS; root.appendChild(st); }
    const wrap = el("div", "wrap");
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Vali");
    const bubble = el("div", "bubble");
    bubble.hidden = true;
    const face = el("button", "face");
    face.type = "button";
    face.setAttribute("aria-label", "Ask Vali anything");
    face.setAttribute("aria-expanded", "false");
    face.addEventListener("click", (e) => { e.stopPropagation(); if (ui.mode === "ask") closeBubble(); else openAsk(); });
    wrap.append(bubble, face);
    wrap.addEventListener("pointerenter", () => { ui.hovered = true; });
    wrap.addEventListener("pointerleave", () => { ui.hovered = false; });
    // Keys typed into the bubble stay in the bubble: page shortcuts never see them (Escape is handled above).
    for (const type of ["keydown", "keyup", "keypress"]) wrap.addEventListener(type, (e) => e.stopPropagation());
    root.appendChild(wrap);
    (document.documentElement || document.body).appendChild(host);
    Object.assign(ui, { host, wrap, bubble, face, ...drawVali(face) });
    setMood(restMood());
    requestAnimationFrame(() => requestAnimationFrame(() => ui.wrap && ui.wrap.classList.add("in")));
  }
  // The extension went away or the setting was turned off: Vali leaves the page.
  function teardown() {
    if (!ui.host) return;
    clearTimeout(ui.timer);
    const { host, wrap, mascot } = ui;
    Object.assign(ui, { host: null, wrap: null, bubble: null, face: null, mascot: null, img: null, mode: null, hovered: false });
    wrap.classList.remove("in");
    setTimeout(() => { mascot?.destroy(); host.remove(); }, 600);
  }

  // Closes the bubble after ms, but never while the pointer is on it.
  function hideAfter(ms) {
    clearTimeout(ui.timer);
    if (ms) ui.timer = setTimeout(() => (ui.hovered ? hideAfter(4000) : closeBubble()), ms);
  }
  function show(kind, kids, ms) {
    mount();
    if (!ui.host) return;
    ui.bubble.className = "bubble " + kind;
    ui.bubble.replaceChildren(...kids);
    ui.bubble.hidden = false;
    ui.wrap.classList.add("open");
    ui.face.setAttribute("aria-expanded", String(kind === "ask"));
    ui.mode = kind;
    ui.answered = false;
    if (kind !== "ask") setMood("needs_approval");
    hideAfter(ms);
  }
  function closeBubble() {
    if (!ui.host || !ui.mode) return;
    clearTimeout(ui.timer);
    const was = ui.mode;
    if (was === "ask") {
      clearTimeout(ask.focusTimer);
      if (ask.state === "done" || ask.state === "failed") ask.unseen = false;
      const tip = ask.restore;
      ask.restore = null;
      if (tip && ask.state === "form") { ui.mode = null; showTip(tip, false); return; } // never asked: the tip comes back
    }
    ui.mode = null;
    ui.bubble.hidden = true;
    ui.bubble.replaceChildren();
    ui.wrap.classList.remove("open");
    ui.face.setAttribute("aria-expanded", "false");
    setMood(restMood());
  }
  // Vali says one thing (after an answer, or from the background), then goes back to rest. Never over the ask bubble.
  function say(text, ms = 8000) {
    if (ui.mode === "ask") return;
    const answered = ui.answered;
    show("say", [closeButton(), line(text)], ms);
    ui.answered = answered;
  }

  // ---------- Ask Vali anything ----------
  // Only the typed question and the page address go to the background (which adds nothing from the page either).
  // state: form | thinking | searching | done | failed. The errand runs on even when the bubble closes, and the answer
  // waits behind the mascot (success face) until it is opened again.
  const ask = { state: "form", question: "", draft: "", id: null, view: null, error: "", note: "", startedAt: 0, poll: 0, focusTimer: 0, unseen: false, restore: null };
  const ASK_POLL_MS = 2500;
  const ASK_GIVE_UP_MS = 5 * 60 * 1000;
  const THINK_MIN_MS = 2500; // the thinking face first, then searching once the server reports the run

  function sendIcon() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M5 12h14M13 6l6 6-6 6");
    svg.append(path);
    return svg;
  }

  function openAsk() {
    if (ui.mode === "tip" && page.tip) ask.restore = page.tip;
    if (ask.state === "done" || ask.state === "failed") ask.unseen = false;
    renderAsk(true);
  }
  function askForm() {
    const form = el("form", "ask-form");
    const input = el("input", "ask-input");
    input.type = "text";
    input.placeholder = "Ask Vali anything";
    input.setAttribute("aria-label", "Ask Vali anything");
    input.maxLength = 500;
    input.autocomplete = "off";
    input.spellcheck = true;
    input.name = "q";
    if (ask.draft) input.setAttribute("value", ask.draft);
    // Read through FormData of Vali's own form: this file never reads a field value property (test/fill-guard.test.mjs).
    const typed = () => String(new FormData(form).get("q") || "");
    input.addEventListener("input", () => { ask.draft = typed(); });
    const go = el("button", "send");
    go.type = "submit";
    go.setAttribute("aria-label", "Send");
    go.append(sendIcon());
    form.append(input, go);
    form.addEventListener("submit", (e) => { e.preventDefault(); e.stopPropagation(); submitAsk(typed()); });
    return { form, input };
  }
  function foot(left, right) {
    const d = el("div", "foot");
    d.append(left || el("span"), right || el("span"));
    return d;
  }
  function openPanelLink() {
    return button("link", "Open panel", (_e, b) => {
      b.disabled = true;
      send({ type: "open-panel" }).then((res) => {
        if (res.data?.opened) closeBubble();
        else { ask.note = "Open Vali with Alt+V."; renderAsk(); }
      });
    });
  }
  function openErrandButton(primary) {
    return button(primary ? "yes" : "link", primary ? "Open" : "Follow in panel", (_e, b) => {
      b.disabled = true;
      // Sent inside the click, so the background can open the side panel as part of this user gesture.
      send({ type: "ask-open", id: ask.id }).then((res) => {
        if (res.data?.opened) closeBubble();
        else { ask.note = "Open Vali with Alt+V to see it."; renderAsk(); }
      });
    });
  }
  function renderAsk(focus = false) {
    const kids = [];
    let input = null;
    if (ask.state === "form") {
      const f = askForm();
      input = f.input;
      kids.push(f.form, foot(openPanelLink(), el("span", "hint", "Esc to close")));
    } else {
      kids.push(closeButton(), el("p", "q", `“${ask.question}”`));
      if (ask.state === "thinking" || ask.state === "searching") {
        const st = el("p", "status");
        st.setAttribute("role", "status");
        const dots = el("span", "dots");
        dots.append(el("i"), el("i"), el("i"));
        st.append(dots, document.createTextNode(ask.state === "thinking" ? "Thinking…" : "Searching official sources…"));
        kids.push(st, foot(ask.id ? openErrandButton(false) : el("span"), el("span", "hint", "Esc to close")));
      } else if (ask.state === "done") {
        const v = ask.view || {};
        const p = el("p", "answer", v.text);
        p.setAttribute("role", "status");
        kids.push(p);
        if (v.source?.url) {
          const srcs = el("p", "srcs");
          const a = el("a", "", v.source.domain);
          a.href = v.source.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.title = v.source.url;
          srcs.append(a);
          kids.push(srcs);
        }
        kids.push(foot(button("link", "New question", () => newQuestion()), openErrandButton(true)));
      } else {
        const p = el("p", "err", ask.error || "Vali could not answer that.");
        p.setAttribute("role", "status");
        kids.push(p, foot(button("link", "Try again", () => newQuestion(ask.question)), ask.id ? openErrandButton(false) : openPanelLink()));
      }
    }
    if (ask.note) kids.push(el("p", "hint", ask.note));
    ask.note = "";
    show("ask", kids, 0);
    setMood(ask.state === "form" ? "idle" : ask.state === "done" ? "success" : ask.state === "failed" ? "error" : ask.state);
    if (focus && input) {
      clearTimeout(ask.focusTimer);
      ask.focusTimer = setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (_) {} }, 30);
    }
  }
  function newQuestion(draft = "") {
    clearTimeout(ask.poll);
    Object.assign(ask, { state: "form", question: "", draft, id: null, view: null, error: "", unseen: false });
    renderAsk(true);
  }
  function setAskState(state) {
    if (ask.state === state) return;
    ask.state = state;
    if (ui.mode === "ask") renderAsk();
    else setMood(restMood());
  }
  async function submitAsk(text) {
    const question = String(text || "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (question.length < 2 || ask.state === "thinking" || ask.state === "searching") return;
    clearTimeout(ask.poll);
    Object.assign(ask, { state: "thinking", question, draft: "", id: null, view: null, error: "", startedAt: Date.now(), unseen: false });
    page.shown = true; // they are talking to Vali: no tip pops up on this page after this
    renderAsk();
    const res = await send({ type: "ask", question });
    if (ask.question !== question || ask.id) return;
    if (!res.ok || !res.data?.id) {
      ask.error = res.error || "That didn’t start. Try again.";
      finishAsk("failed");
      return;
    }
    ask.id = res.data.id;
    if (ui.mode === "ask") renderAsk(); // shows "Follow in panel"
    pollAsk();
  }
  function pollAsk() {
    clearTimeout(ask.poll);
    ask.poll = setTimeout(async () => {
      const id = ask.id;
      if (!id || !alive()) return;
      const res = await send({ type: "ask-status", id });
      if (ask.id !== id) return; // a new question since
      const v = res.ok ? res.data : null;
      if (v?.state === "done") { ask.view = v; finishAsk("done"); return; }
      if (v?.state === "failed") { ask.error = v.error; finishAsk("failed"); return; }
      if (Date.now() - ask.startedAt > ASK_GIVE_UP_MS) {
        ask.error = "Still working on it. Follow it in the panel.";
        finishAsk("failed");
        return;
      }
      if (v?.state === "searching" && Date.now() - ask.startedAt > THINK_MIN_MS) setAskState("searching");
      pollAsk();
    }, ASK_POLL_MS);
  }
  function finishAsk(state) {
    ask.unseen = ui.mode !== "ask";
    ask.state = "";
    setAskState(state);
  }

  // ---------- a tip for this page ----------
  function tipView(tip) {
    const kids = [closeButton(), line(tip.text)];
    if (tip.sources?.length) {
      const srcs = el("p", "srcs");
      for (const s of tip.sources) {
        const a = el("a", "", s.domain);
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.title = s.quote ? `“${s.quote}” (${s.title || s.domain})` : s.title || s.url;
        srcs.append(a);
      }
      kids.push(srcs);
    }
    if (tip.action) kids.push(row(button("yes", tip.action.label, (_e, b) => onDoIt(tip.action, b))));
    return kids;
  }
  function onDoIt(action, b) {
    ui.answered = true;
    b.disabled = true;
    // Sent inside the click, so the background can open the side panel as part of this user gesture.
    send({ type: "companion-do", task: action.task, title: document.title }).then((res) => {
      if (!res.ok) say(res.error || "That didn’t start. Try again from the side panel.");
      else say(res.data?.opened ? "On it. Follow it in the side panel." : "On it. Open Vali with Alt+V to follow it.", 5000);
    });
  }

  // ---------- the offer on form pages ----------
  function offerView() {
    return [line("Want me to fill this in?"), row(button("yes", "Yes", onYes), button("no", "Not now", onNotNow))];
  }
  function onYes() {
    ui.answered = true;
    send({ type: "presence-open", url: location.href, title: document.title }).then((res) => {
      if (res.data?.opened) closeBubble();
      else say("Open Vali with Alt+V");
    });
    readSite().then((s) => s && writeSite({ ...s, yesAt: Date.now() }));
  }
  function onNotNow() {
    ui.answered = true;
    closeBubble();
    readSite().then((s) => s && writeSite({ ...s, snoozeUntil: Date.now() + SNOOZE_MS }));
  }

  // ---------- when to show ----------
  const page = { shown: false, busy: false, checkedAt: 0, off: false, href: location.href, asked: false, tip: null };
  async function askTip() {
    page.asked = true;
    page.busy = true;
    const href = location.href;
    try {
      const res = await send({ type: "companion-tip", page: pageContext() });
      if (res.ok && res.data?.text && href === page.href) page.tip = res.data;
    } finally {
      page.busy = false;
    }
  }
  function showTip(tip = page.tip, first = true) {
    page.shown = true;
    show("tip", tipView(tip), 45000);
    if (first) send({ type: "companion-seen" }); // one tip per page: not again for 6 h
  }
  async function maybeOffer() {
    if (act.visibleMs < DWELL_MS || !quiet()) return;
    if (Date.now() - page.checkedAt < 4000) return; // don't scan the DOM every second
    page.checkedAt = Date.now();
    if (!isFormPage()) return;
    page.busy = true;
    try {
      const s = await readSite();
      if (!s) return;
      const now = Date.now();
      if (s.snoozeUntil > now || s.n >= MAX_PER_DAY || now - s.yesAt < AFTER_YES_MS) { page.shown = true; return; }
      if (!quiet() || page.off || ui.mode || page.shown) return;
      page.shown = true;
      await writeSite({ ...s, n: s.n + 1 });
      show("offer", offerView(), 30000);
    } finally {
      page.busy = false;
    }
  }
  function maybeShow() {
    if (page.off || page.shown || page.busy || ui.mode) return;
    if (!page.asked) {
      if (act.visibleMs >= TIP_DWELL_MS && document.readyState === "complete") askTip();
      return;
    }
    if (page.tip) { if (quiet()) showTip(); return; }
    maybeOffer();
  }

  addFont();
  const tick = setInterval(() => {
    if (!alive()) { clearInterval(tick); clearTimeout(ask.poll); teardown(); return; } // the extension was reloaded or removed
    if (ui.host && !ui.host.isConnected) (document.documentElement || document.body).appendChild(ui.host); // the page re-rendered
    const now = Date.now();
    if (document.visibilityState === "visible") act.visibleMs += now - act.lastTick;
    act.lastTick = now;
    if (location.href !== page.href) {
      // single-page apps: a new URL is a new page (an open ask bubble stays)
      Object.assign(page, { href: location.href, shown: false, checkedAt: 0, asked: false, tip: null });
      act.visibleMs = 0;
      if ((ui.mode === "tip" || ui.mode === "offer" || ui.mode === "say") && !ui.answered) closeBubble();
    }
    maybeShow();
  }, 1000);

  // After "Fill it here" in the panel: "Check and send it yourself."
  ext.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "vali-say" && typeof msg.text === "string") say(msg.text.slice(0, 200), 10000);
  });

  // ---------- the setting ("Vali tips while you browse"): off means no Vali on pages at all ----------
  try {
    ext.storage.local.get("presence").then((r) => {
      if (r.presence === false) { page.off = true; teardown(); }
      else mount();
    }, () => mount());
    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.presence) return;
      page.off = changes.presence.newValue === false;
      if (page.off) teardown();
      else mount();
    });
  } catch (_) {}
})();
