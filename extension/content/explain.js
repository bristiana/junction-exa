// Explain this: select text on a page and a small "Ask Vali" button appears next to it. A click opens the side panel
// with the selection attached and "What does this mean and what should I do?" ready to send as an errand.
// Never for text inside fields or editors (what the user typed), never on the sites presence.js blocks, off when
// settings.presence === false. Classic content script; runs after content/presence.js, which defines the site rules
// and adds the "Vali Jakarta" font.
(function () {
  "use strict";
  if (globalThis.__valiExplain || typeof document === "undefined" || window.top !== window) return;
  globalThis.__valiExplain = true;
  const ext = globalThis.chrome;
  const rules = globalThis.__valiPresence;
  if (!ext?.runtime?.id || !rules || !/^(https?|file):$/.test(location.protocol)) return;
  if (location.protocol !== "file:" && rules.blockedHost(location.hostname)) return;

  const MIN_CHARS = 3;
  const MAX_CHARS = 4000;
  const CSS = `
  :host { all: initial; }
  .pill { position: fixed; z-index: 2147483646; display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px 4px 4px;
    border: 1px solid #e6dcef; border-radius: 999px; background: #fff; color: #34305a; cursor: pointer;
    font: 600 12.5px/1 "Vali Jakarta", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 8px 24px rgba(52,48,90,.16), 0 1px 3px rgba(52,48,90,.10);
    opacity: 0; transform: translateY(4px); transition: opacity .15s ease, transform .2s cubic-bezier(.16,1,.3,1); }
  .pill.in { opacity: 1; transform: none; }
  .pill:hover { background: #f6effa; }
  .pill:focus-visible { outline: 2px solid #8b76e0; outline-offset: 2px; }
  .pill img { width: 22px; height: 22px; border-radius: 50%; }
  @media (prefers-reduced-motion: reduce) { .pill { transition: none; transform: none; } }
  @media print { .pill { display: none; } }`;

  const ui = { host: null, pill: null, label: null, text: "", off: false };

  function inEditable(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!el?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false])");
  }
  // The selected page text and where it ends on screen, or null.
  function currentSelection() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    if (inEditable(sel.anchorNode) || inEditable(sel.focusNode) || inEditable(document.activeElement)) return null;
    const text = String(sel).replace(/\s+/g, " ").trim();
    if (text.length < MIN_CHARS || text.length > MAX_CHARS) return null;
    const rect = sel.getRangeAt(sel.rangeCount - 1).getBoundingClientRect();
    return rect.width || rect.height ? { text, rect } : null;
  }

  function mount() {
    if (ui.host) return;
    const host = document.createElement("vali-explain");
    host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "pill";
    const icon = document.createElement("img");
    icon.alt = "";
    icon.src = ext.runtime.getURL("icons/icon-48.png");
    const label = document.createElement("span");
    label.textContent = "Ask Vali about this";
    pill.append(icon, label);
    pill.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the selection
    pill.addEventListener("click", onAsk);
    root.append(style, pill);
    (document.documentElement || document.body).appendChild(host);
    Object.assign(ui, { host, pill, label });
  }

  // Under the end of the selection, or above it near the bottom of the window.
  function place(rect) {
    const x = Math.min(Math.max(8, rect.right - 80), innerWidth - 170);
    const y = rect.bottom + 44 > innerHeight ? Math.max(8, rect.top - 40) : rect.bottom + 8;
    ui.pill.style.left = x + "px";
    ui.pill.style.top = y + "px";
  }
  function show(s) {
    mount();
    ui.text = s.text;
    ui.label.textContent = "Ask Vali about this";
    place(s.rect);
    requestAnimationFrame(() => ui.pill && ui.pill.classList.add("in"));
  }
  function hide() {
    if (!ui.host) return;
    ui.host.remove();
    Object.assign(ui, { host: null, pill: null, label: null, text: "" });
  }
  function check() {
    const s = !ui.off && currentSelection();
    if (s) show(s);
    else hide();
  }

  function onAsk(e) {
    e.stopPropagation();
    // Sent inside the click, so the background can open the side panel as part of this user gesture.
    try {
      ext.runtime.sendMessage({ type: "explain", selection: ui.text, title: document.title }, (res) => {
        void ext.runtime.lastError;
        if (res?.data?.opened) { hide(); return; }
        if (ui.label) ui.label.textContent = "Open Vali with Alt+V";
        setTimeout(hide, 4000);
      });
    } catch (_) {
      hide(); // the extension was reloaded
    }
  }

  const ours = (e) => ui.host && e.composedPath().includes(ui.host);
  addEventListener("mouseup", (e) => { if (!ours(e)) setTimeout(check, 10); }, true);
  addEventListener("keyup", (e) => { if (e.shiftKey || e.key === "Shift") setTimeout(check, 10); }, true);
  addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); }, true);
  addEventListener("scroll", hide, { passive: true, capture: true });
  document.addEventListener("selectionchange", () => { if (ui.host && !currentSelection()) hide(); });

  try {
    ext.storage.local.get("presence").then((r) => { ui.off = r.presence === false; }, () => {});
    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.presence) return;
      ui.off = changes.presence.newValue === false;
      if (ui.off) hide();
    });
  } catch (_) {}
})();
