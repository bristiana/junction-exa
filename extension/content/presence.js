// Vali presence: on pages with a real form (a claim, an application, a booking, a registration, a complaint),
// a small Vali badge slides in once at the bottom-right and offers to fill it in. "Yes" opens the side panel with
// "Help me fill in this form" ready; "Not now" silences the site for 7 days.
// Rules: only after ~8 s on the page, never while the user types or scrolls, at most once per page and 3 times per
// site per day, never on search, mail, chat, payment or banking sites, off when settings.presence === false.
// Classic content script: no imports. The badge lives in a closed shadow root so page CSS cannot reach it.
(function () {
  "use strict";
  if (globalThis.__hoidaPresence) return;

  // ---------- rules (pure; test/presence.test.mjs loads this file to check them) ----------
  const BLOCKED = [
    // search and the Web Store
    "google.com", "google.fi", "bing.com",
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
  globalThis.__hoidaPresence = { blockedHost, formWords, siteOf };

  // ---------- only on ordinary top-level pages ----------
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.top !== window) return;
  if (!/^(https?|file):$/.test(location.protocol)) return;
  if (blockedHost(location.hostname) && location.protocol !== "file:") return;
  const ext = globalThis.chrome;
  if (!ext?.runtime?.id) return;

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

  // ---------- the badge ----------
  const CSS = `
  :host { all: initial; }
  .wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; display: flex; align-items: flex-end; gap: 10px;
    --card: #ffffff; --text: #17171c; --muted: #6b6b78; --line: #e5e5ee; --accent: #5b4cf0; --accent-soft: #eeecff;
    font: 500 13.5px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text);
    transform: translateX(calc(100% + 40px)); opacity: 0; pointer-events: none;
    transition: transform .5s cubic-bezier(.16,1,.3,1), opacity .25s ease; }
  @media (prefers-color-scheme: dark) {
    .wrap { --card: #1b1b22; --text: #ececf3; --muted: #9a9aab; --line: #2c2c37; --accent: #8e83ff; --accent-soft: #26233f; }
  }
  .wrap.in { transform: none; opacity: 1; pointer-events: auto; }
  .bubble { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; max-width: 240px;
    box-shadow: 0 10px 30px rgba(20,20,40,.18), 0 1px 3px rgba(20,20,40,.12); }
  .line { margin: 0; }
  .btns { display: flex; gap: 6px; margin-top: 8px; }
  .btns[hidden] { display: none; }
  button { font: inherit; font-weight: 600; border: 0; border-radius: 9px; padding: 6px 12px; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .yes { background: var(--accent); color: #fff; }
  .no { background: var(--accent-soft); color: var(--accent); }
  .face { width: 100px; height: 100px; flex: none; display: block; margin: 0 -16px -8px -18px;
    filter: drop-shadow(0 4px 10px rgba(20,20,40,.22)); }
  @media (prefers-reduced-motion: reduce) { .wrap { transition: opacity .15s linear; transform: none; } }
  @media print { .wrap { display: none; } }`;

  const ui = { host: null, wrap: null, line: null, btns: null, shown: false, answered: false, timer: 0 };

  function mount() {
    if (ui.host) return;
    const host = document.createElement("hoida-presence");
    host.style.cssText = "all:initial;position:fixed;right:0;bottom:0;width:0;height:0;z-index:2147483646;";
    const root = host.attachShadow({ mode: "closed" });
    try { const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet]; }
    catch (_) { const st = document.createElement("style"); st.textContent = CSS; root.appendChild(st); }

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Vali");
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    const line = document.createElement("p");
    line.className = "line";
    line.setAttribute("role", "status");
    line.textContent = "Want me to fill this in?";
    const btns = document.createElement("div");
    btns.className = "btns";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "yes";
    yes.textContent = "Yes";
    const no = document.createElement("button");
    no.type = "button";
    no.className = "no";
    no.textContent = "Not now";
    btns.append(yes, no);
    bubble.append(line, btns);
    const face = document.createElement("img");
    face.className = "face";
    face.alt = "";
    face.width = 100;
    face.height = 100;
    face.src = ext.runtime.getURL("mascot/needs_approval.svg"); // Vali bowing with a card on a tray
    wrap.append(bubble, face);
    root.appendChild(wrap);

    yes.addEventListener("click", onYes);
    no.addEventListener("click", onNotNow);
    (document.documentElement || document.body).appendChild(host);
    Object.assign(ui, { host, wrap, line, btns });
  }

  function show() {
    mount();
    ui.shown = true;
    ui.answered = false;
    requestAnimationFrame(() => requestAnimationFrame(() => ui.wrap && ui.wrap.classList.add("in")));
    clearTimeout(ui.timer);
    ui.timer = setTimeout(hide, 30000);
  }
  function hide() {
    if (!ui.host) return;
    clearTimeout(ui.timer);
    const { host, wrap } = ui;
    Object.assign(ui, { host: null, wrap: null, line: null, btns: null, shown: false });
    wrap.classList.remove("in");
    setTimeout(() => host.remove(), 600);
  }
  function fallback() {
    if (!ui.line) return;
    ui.line.textContent = "Open Vali with Alt+V";
    ui.btns.hidden = true;
    clearTimeout(ui.timer);
    ui.timer = setTimeout(hide, 8000);
  }

  function onYes(e) {
    e.stopPropagation();
    ui.answered = true;
    clearTimeout(ui.timer);
    // Send right away, inside the click, so the background can open the side panel as part of this user gesture.
    try {
      ext.runtime.sendMessage({ type: "presence-open", url: location.href, title: document.title }, (res) => {
        void ext.runtime.lastError;
        if (res?.data?.opened) hide();
        else fallback();
      });
    } catch (_) {
      fallback();
    }
    readSite().then((s) => s && writeSite({ ...s, yesAt: Date.now() }));
  }
  function onNotNow(e) {
    e.stopPropagation();
    ui.answered = true;
    hide();
    readSite().then((s) => s && writeSite({ ...s, snoozeUntil: Date.now() + SNOOZE_MS }));
  }

  // ---------- when to show ----------
  const page = { shown: false, busy: false, checkedAt: 0, off: false, href: location.href };
  async function maybeShow() {
    if (page.off || page.shown || page.busy || ui.shown) return;
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
      show();
    } finally {
      page.busy = false;
    }
  }

  const tick = setInterval(() => {
    if (!alive()) { clearInterval(tick); hide(); return; } // the extension was reloaded or removed
    const now = Date.now();
    if (document.visibilityState === "visible") act.visibleMs += now - act.lastTick;
    act.lastTick = now;
    if (location.href !== page.href) {
      // single-page apps: a new URL is a new page
      Object.assign(page, { href: location.href, shown: false, checkedAt: 0 });
      act.visibleMs = 0;
      if (ui.shown && !ui.answered) hide();
    }
    maybeShow();
  }, 1000);

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
