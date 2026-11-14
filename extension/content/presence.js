// Vali presence: Vali comes with you. Once per page a small Vali peeks in at the bottom-right with a speech bubble:
// - a tip for this page (POST /v1/companion via the background) with its sources and "Do it", which starts the errand;
// - or, on pages with a real form and no tip, the offer to fill it in ("Yes" opens the side panel; "Not now" silences
//   the site for 7 days, and the offer shows at most 3 times per site per day).
// What leaves the page for a tip: address, title, h1-h3 headings, language and the selected text. Never form values.
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
  // Selected page text, never text inside a field or an editor (that is what the user typed).
  function selectedText() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || inEditable(sel.anchorNode) || inEditable(document.activeElement)) return "";
    return clipText(sel, 1000);
  }
  function pageContext() {
    const headings = [...document.querySelectorAll("h1, h2, h3")]
      .filter((h) => !inEditable(h) && !h.closest("form"))
      .map((h) => clipText(h.textContent, 120))
      .filter(Boolean)
      .slice(0, 12);
    return { url: location.href, title: clipText(document.title, 200), headings, lang: document.documentElement.lang || "", selection: selectedText() };
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
  addEventListener("scroll", () => { act.scrollAt = Date.now(); }, { passive: true, capture: true });
  addEventListener("wheel", () => { act.scrollAt = Date.now(); }, { passive: true, capture: true });
  addEventListener("keydown", (e) => {
    act.keyAt = Date.now();
    if (e.key === "Escape" && ui.shown) hide();
  }, true);
  addEventListener("input", () => {
    act.keyAt = Date.now();
    if (ui.shown && !ui.answered) hide(); // they are filling it in themselves
  }, true);
  function focusedField() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return !!a && a !== ui.host && (a.isContentEditable || /^(input|textarea|select)$/i.test(a.localName || ""));
  }
  function quiet() {
    const now = Date.now();
    return document.visibilityState === "visible" && !focusedField() && now - act.keyAt > 3000 && now - act.scrollAt > 1500;
  }

  // ---------- the bubble ----------
  const CSS = `
  :host { all: initial; }
  .wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; display: flex; align-items: flex-end; gap: 6px;
    --card: #ffffff; --text: #17171c; --muted: #6b6b78; --line: #e5e5ee; --accent: #5b4cf0; --accent-soft: #eeecff;
    font: 500 13.5px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text);
    transform: translateX(calc(100% + 40px)); opacity: 0; pointer-events: none;
    transition: transform .5s cubic-bezier(.16,1,.3,1), opacity .25s ease; }
  @media (prefers-color-scheme: dark) {
    .wrap { --card: #1b1b22; --text: #ececf3; --muted: #9a9aab; --line: #2c2c37; --accent: #8e83ff; --accent-soft: #26233f; }
  }
  .wrap.in { transform: none; opacity: 1; pointer-events: auto; }
  .bubble { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px;
    max-width: 280px; box-shadow: 0 10px 30px rgba(20,20,40,.18), 0 1px 3px rgba(20,20,40,.12); }
  .line { margin: 0; }
  .tip .line { padding-right: 18px; }
  .srcs { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0; }
  .srcs a { font-size: 12px; color: var(--accent); background: var(--accent-soft); border-radius: 999px; padding: 1px 8px; text-decoration: none; }
  .srcs a:hover { text-decoration: underline; }
  .btns { display: flex; gap: 6px; margin-top: 8px; }
  button { font: inherit; font-weight: 600; border: 0; border-radius: 9px; padding: 6px 12px; cursor: pointer; }
  button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button:disabled { opacity: .6; cursor: default; }
  .yes { background: var(--accent); color: #fff; }
  .no { background: var(--accent-soft); color: var(--accent); }
  .close { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; padding: 0; border-radius: 50%;
    background: transparent; color: var(--muted); font-size: 16px; line-height: 24px; }
  .close:hover { background: var(--accent-soft); color: var(--accent); }
  .face { width: 88px; height: 88px; flex: none; margin: 0 -8px -6px 0; filter: drop-shadow(0 4px 10px rgba(20,20,40,.18)); }
  .face svg, .face img { display: block; width: 100%; height: 100%; overflow: visible; }
  @media (prefers-reduced-motion: reduce) { .wrap { transition: opacity .15s linear; transform: none; } }
  @media print { .wrap { display: none; } }`;

  const ui = { host: null, wrap: null, bubble: null, mascot: null, shown: false, answered: false, hovered: false, timer: 0 };

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
    const b = button("close", "×", () => { ui.answered = true; hide(); });
    b.setAttribute("aria-label", "Close");
    return b;
  }

  // The animated Vali (lib/butler.js, lilac); the still picture if it cannot draw here.
  function drawVali(box) {
    try {
      return globalThis.Butler.create(box, { palette: "lilac", state: "needs_approval", reducedMotion: "auto", trackPointer: true, hoverReact: true });
    } catch (_) {
      const img = el("img");
      img.alt = "";
      img.src = ext.runtime.getURL("mascot/needs_approval.svg");
      box.replaceChildren(img);
      return null;
    }
  }

  function mount() {
    if (ui.host) return;
    const host = document.createElement("vali-presence");
    host.style.cssText = "all:initial;position:fixed;right:0;bottom:0;width:0;height:0;z-index:2147483646;";
    const root = host.attachShadow({ mode: "closed" });
    try { const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet]; }
    catch (_) { const st = document.createElement("style"); st.textContent = CSS; root.appendChild(st); }
    const wrap = el("div", "wrap");
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Vali");
    const bubble = el("div", "bubble");
    const face = el("div", "face");
    face.setAttribute("aria-hidden", "true");
    wrap.append(bubble, face);
    wrap.addEventListener("pointerenter", () => { ui.hovered = true; });
    wrap.addEventListener("pointerleave", () => { ui.hovered = false; });
    root.appendChild(wrap);
    (document.documentElement || document.body).appendChild(host);
    Object.assign(ui, { host, wrap, bubble, mascot: drawVali(face) });
  }

  // Hides after ms, but never while the pointer is on it.
  function hideAfter(ms) {
    clearTimeout(ui.timer);
    ui.timer = setTimeout(() => (ui.hovered ? hideAfter(4000) : hide()), ms);
  }
  function show(kind, kids, ms) {
    mount();
    ui.bubble.className = "bubble " + kind;
    ui.bubble.replaceChildren(...kids);
    ui.shown = true;
    ui.answered = false;
    requestAnimationFrame(() => requestAnimationFrame(() => ui.wrap && ui.wrap.classList.add("in")));
    hideAfter(ms);
  }
  function hide() {
    if (!ui.host) return;
    clearTimeout(ui.timer);
    const { host, wrap, mascot } = ui;
    Object.assign(ui, { host: null, wrap: null, bubble: null, mascot: null, shown: false, hovered: false });
    wrap.classList.remove("in");
    setTimeout(() => { mascot?.destroy(); host.remove(); }, 600);
  }
  // Vali says one thing (after an answer, or from the background), then goes.
  function say(text, ms = 8000) {
    const answered = ui.answered;
    show("say", [closeButton(), line(text)], ms);
    ui.answered = answered;
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
      if (res.data?.opened) hide();
      else say("Open Vali with Alt+V");
    });
    readSite().then((s) => s && writeSite({ ...s, yesAt: Date.now() }));
  }
  function onNotNow() {
    ui.answered = true;
    hide();
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
  function showTip() {
    page.shown = true;
    show("tip", tipView(page.tip), 45000);
    send({ type: "companion-seen" }); // one tip per page: not again for 6 h
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
      if (!quiet() || page.off) return;
      page.shown = true;
      await writeSite({ ...s, n: s.n + 1 });
      show("offer", offerView(), 30000);
    } finally {
      page.busy = false;
    }
  }
  function maybeShow() {
    if (page.off || page.shown || page.busy || ui.shown) return;
    if (!page.asked) {
      if (act.visibleMs >= TIP_DWELL_MS && document.readyState === "complete") askTip();
      return;
    }
    if (page.tip) { if (quiet()) showTip(); return; }
    maybeOffer();
  }

  const tick = setInterval(() => {
    if (!alive()) { clearInterval(tick); hide(); return; } // the extension was reloaded or removed
    const now = Date.now();
    if (document.visibilityState === "visible") act.visibleMs += now - act.lastTick;
    act.lastTick = now;
    if (location.href !== page.href) {
      // single-page apps: a new URL is a new page
      Object.assign(page, { href: location.href, shown: false, checkedAt: 0, asked: false, tip: null });
      act.visibleMs = 0;
      if (ui.shown && !ui.answered) hide();
    }
    maybeShow();
  }, 1000);

  // After "Fill it here" in the panel: "Check and send it yourself."
  ext.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "vali-say" && typeof msg.text === "string") say(msg.text.slice(0, 200), 10000);
  });

  // ---------- the setting ----------
  try {
    ext.storage.local.get("presence").then((r) => { if (r.presence === false) { page.off = true; hide(); } }, () => {});
    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.presence) return;
      page.off = changes.presence.newValue === false;
      if (page.off) hide();
    });
  } catch (_) {}
})();
