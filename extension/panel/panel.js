// Vali side panel: compose an errand, watch it run, review the result and approve the prepared steps.
// Everything the agent returns is rendered with textContent, never as HTML.

import { PROFILE_FIELDS } from "../lib/task.js";
import { numberSources, citesFor, resolveAction, fillPlaceholders, unfilledPlaceholders } from "../lib/actions.js";
import { search } from "../lib/exa.js";
import { connect, me as serverMe, pair, normalizeBaseUrl, ensureConnected, liveUrl, shotUrl, DEFAULT_BASE_URL } from "../lib/backend.js";
import { taskMascot, headerMascot, finishFlash, FLASH_MS } from "../lib/mascot.js";
import { executionView, LIVE } from "../lib/execution.js";

import { errandStatus } from "../lib/panel-state.js";

const $ = (id) => document.getElementById(id);
const PRESETS = [
  ["Flight delay", "My flight was delayed by more than 3 hours. Can I get compensation? Prepare the claim."],
  ["Address change", "I just moved to a new apartment in Helsinki. Register my change of address and tell me who else I need to notify."],
  ["Rent increase", "My landlord wants to raise my rent by 8% from next month. Is that allowed under my lease and Finnish law? Draft a reply."],
  ["Kela benefits", "I am an international student in Finland. Which Kela benefits can I get, and how do I apply?"],
  ["Sauna booking", "Find a public sauna in Helsinki for a group of 8 this Saturday evening that can be booked online."],
];
// backendUrl: the deployed Vali server unless settings point elsewhere; "" means direct mode (Exa from this browser).
const DEFAULTS = { tasks: [], profile: {}, exaKey: "", effort: "low", backendUrl: DEFAULT_BASE_URL, presence: true };
const SERVER_PRESETS = [
  ["Vali cloud", DEFAULT_BASE_URL],
  ["Local API :8000", "http://127.0.0.1:8000"],
  ["Mock :8787", "http://127.0.0.1:8787"],
];
let state = { ...DEFAULTS };
let activeTab = null;
let prefill = null;
const open = new Set();
const drafts = new Map(); // edited email bodies, keyed by task+action index; answers to the browser, keyed "q:"+task
const answered = new Map(); // task id -> question.at answered from here, until the agent picks the answer up
const pendingInline = new Map(); // action -> task snapshot and request still in flight

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

function toast(msg) {
  const t = h("div", { class: "toast", text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

function send(msg) {
  return chrome.runtime.sendMessage(msg).then((r) => {
    if (!r?.ok) throw Object.assign(new Error(r?.error || "Something went wrong."), { status: r?.status });
    return r.data;
  });
}

// ---------- the mascot ----------
// One animated Vali in the header follows the errand that matters most (lib/mascot.js); cards and the empty state use stills.
const SAYS = {
  idle: "I’m ready to help.",
  listening: "I’m listening.",
  thinking: "I’m looking into it.",
  working: "I’m working on your errand.",
  needs_approval: "I’m waiting for your OK.",
  success: "I’ve finished an errand.",
  error: "I need your help to go on.",
};
const mascot = (() => {
  const box = $("mascot");
  try {
    return globalThis.Butler.create(box, { palette: "lilac", state: "idle", reducedMotion: "auto", trackPointer: true, hoverReact: true });
  } catch (_) {
    const img = h("img", { src: "../mascot/idle.svg", alt: "" });
    box.replaceChildren(img);
    return { setState: (s) => { img.src = `../mascot/${s === "listening" ? "idle" : s}.svg`; } };
  }
})();
let lastPoses = new Map();
let flash = null;
let flashTimer = 0;
function updateMascot() {
  const f = finishFlash(lastPoses, state.tasks);
  lastPoses = new Map(state.tasks.map((t) => [t.id, taskMascot(t)]));
  if (f) {
    flash = { state: f, until: Date.now() + FLASH_MS[f] };
    clearTimeout(flashTimer);
    flashTimer = setTimeout(updateMascot, FLASH_MS[f] + 50);
  }
  const pose = headerMascot(state.tasks, { focused: document.hasFocus() && document.activeElement === $("task"), flash });
  mascot.setState(pose);
  const says = SAYS[pose] || "";
  if ($("mascotSays").textContent !== says) $("mascotSays").textContent = says;
}
$("newErrand").addEventListener("click", () => $("task").focus());
$("task").addEventListener("focus", updateMascot);
$("task").addEventListener("blur", () => setTimeout(updateMascot)); // after the blur, so hasFocus() is current

// ---------- settings ----------
function renderSettings() {
  $("exaKey").value = state.exaKey;
  $("effort").value = state.effort;
  $("presence").checked = state.presence !== false;
  $("backendUrl").value = state.backendUrl;
  $("pairInfo").hidden = true;
  $("serverPresets").replaceChildren(...SERVER_PRESETS.map(([label, url]) =>
    h("button", { type: "button", class: "v-btn v-btn--quiet v-btn--sm", text: label, title: url, onclick: () => { $("backendUrl").value = url; $("connectBtn").click(); } })));
  refreshServerStatus();
  const box = $("profileFields");
  box.replaceChildren(
    ...PROFILE_FIELDS.map(([k, label]) =>
      h("label", {}, h("span", { text: label }), h("input", { class: "v-input", type: "text", "data-k": k, value: state.profile[k] || "", placeholder: k === "language" ? "English" : "" }))
    )
  );
}
$("settingsBtn").addEventListener("click", () => {
  const s = $("settings");
  s.hidden = !s.hidden;
  if (!s.hidden) renderSettings();
});
$("saveSettings").addEventListener("click", async () => {
  const profile = {};
  for (const i of $("profileFields").querySelectorAll("input")) if (i.value.trim()) profile[i.dataset.k] = i.value.trim();
  await chrome.storage.local.set({ exaKey: $("exaKey").value.trim(), effort: $("effort").value, profile, presence: $("presence").checked });
  // The first time a server URL is saved, this browser gets a user on it (same as pressing Connect).
  const url = $("backendUrl").value.trim();
  try {
    if (!url) await useDirectMode();
    else if (normalizeBaseUrl(url) !== state.backendUrl) await connectServer(url);
  } catch (e) {
    $("backendStatus").textContent = e.message;
    toast("Saved, but the Vali server did not connect");
    return;
  }
  $("settings").hidden = true;
  toast("Saved");
});

// ---------- Vali server and WhatsApp ----------
async function useDirectMode() {
  await chrome.storage.local.set({ backendUrl: "" }); // "" = direct mode; the token stays, so saving the same URL again keeps the WhatsApp link
  state.backendUrl = "";
  refreshServerStatus();
}

async function connectServer(url) {
  const who = await connect(url);
  state.backendUrl = normalizeBaseUrl(url);
  $("backendUrl").value = state.backendUrl;
  showServerStatus(who);
  send({ type: "poll" }).catch(() => {});
  return who;
}

function showServerStatus(who) {
  $("backendStatus").textContent = "Connected";
  $("pairBtn").disabled = false;
  $("waStatus").textContent = who?.whatsapp_linked ? `Linked${who.whatsapp_last4 ? " (…" + who.whatsapp_last4 + ")" : ""}` : "Not linked yet";
}

async function refreshServerStatus() {
  const st = $("backendStatus");
  $("pairBtn").disabled = !state.backendUrl;
  if (!state.backendUrl) {
    st.textContent = "Not set: Vali talks to Exa directly.";
    $("waStatus").textContent = "Needs a Vali server.";
    return;
  }
  st.textContent = "Checking…";
  $("waStatus").textContent = "";
  try {
    await ensureConnected(); // the default server: get a user on first use
    showServerStatus(await serverMe());
  } catch (e) {
    st.textContent = "Not connected: " + e.message;
  }
}

$("connectBtn").addEventListener("click", async () => {
  const url = $("backendUrl").value.trim();
  const btn = $("connectBtn");
  if (!url) { await useDirectMode(); return; }
  btn.disabled = true;
  $("backendStatus").textContent = "Connecting…";
  try {
    await connectServer(url);
  } catch (e) {
    $("backendStatus").textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

let linkWatch = 0;
$("pairBtn").addEventListener("click", async () => {
  const info = $("pairInfo");
  info.hidden = false;
  info.textContent = "Getting a code…";
  try {
    const { code, expires_at } = await pair();
    const until = Date.parse(expires_at || "");
    const kids = ["Send ", h("code", { text: `link ${code}` }), " to Vali on WhatsApp."];
    if (Number.isFinite(until)) kids.push(h("span", { class: "muted", text: ` The code expires at ${new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` }));
    info.replaceChildren(...kids);
    watchLink(Number.isFinite(until) ? until : Date.now() + 10 * 60 * 1000);
  } catch (e) {
    info.textContent = e.message;
  }
});

// While the code is valid and settings are open, check every few seconds whether the phone sent it.
function watchLink(until) {
  clearInterval(linkWatch);
  linkWatch = setInterval(async () => {
    if (Date.now() > until || $("settings").hidden || !state.backendUrl) { clearInterval(linkWatch); return; }
    try {
      const who = await serverMe();
      if (who?.whatsapp_linked) {
        clearInterval(linkWatch);
        showServerStatus(who);
        $("pairInfo").textContent = "WhatsApp is linked. Errands from your phone now show up here.";
      }
    } catch (_) {}
  }, 4000);
}
$("testKey").addEventListener("click", async () => {
  const st = $("keyStatus");
  st.textContent = "Checking…";
  try {
    const r = await search($("exaKey").value.trim(), "Kela student financial aid amount", { numResults: 1 });
    st.textContent = r?.results?.length ? "Key works." : "Key works, but the test search was empty.";
  } catch (e) {
    st.textContent = "Key rejected: " + e.message;
  }
});

// ---------- composer ----------
$("presets").replaceChildren(
  ...PRESETS.map(([label, text]) => h("button", { type: "button", class: "v-btn v-btn--quiet v-btn--sm", text: label, onclick: () => { $("task").value = text; $("settings").hidden = true; $("task").focus(); } }))
);

async function refreshActiveTab() {
  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) { activeTab = null; }
  const readable = activeTab?.url && /^(https?|file):/.test(activeTab.url);
  $("context").hidden = !readable && !prefill?.selection;
  if (prefill?.selection) $("contextLabel").textContent = `Use the selected text: “${prefill.selection.slice(0, 60)}${prefill.selection.length > 60 ? "…" : ""}”`;
  else if (readable) $("contextLabel").textContent = `Use this page: ${(activeTab.title || activeTab.url).slice(0, 70)}`;
}
chrome.tabs.onActivated.addListener(refreshActiveTab);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === "complete" || info.title) refreshActiveTab(); });

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const task = $("task").value.trim();
  const err = $("composerError");
  err.hidden = true;
  if (!task) { $("task").focus(); return; }
  if (!state.exaKey && !state.backendUrl) { err.textContent = "Add your Exa API key or a Vali server in settings first."; err.hidden = false; $("settings").hidden = false; renderSettings(); return; }
  $("send").disabled = true;
  try {
    const usePage = !$("context").hidden && $("usePage").checked;
    const rec = await send({ type: "start", task, tabId: activeTab?.id, usePage, selection: usePage ? prefill?.selection || "" : "" });
    open.add(rec.id);
    $("task").value = "";
    prefill = null;
    chrome.storage.session.remove("prefill");
    refreshActiveTab();
  } catch (e2) {
    if (state.backendUrl) err.textContent = e2.status === 401 ? "The Vali server did not accept this browser. Press Connect in settings." : e2.message;
    else err.textContent = e2.status === 401 ? "Exa rejected the API key. Check it in settings." : e2.status === 402 ? "The Exa key is out of credits." : e2.message;
    err.hidden = false;
  } finally {
    $("send").disabled = false;
  }
});
$("task").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("composer").requestSubmit();
});

// ---------- cards ----------
function elapsed(t) {
  const s = Math.round(((t.completedAt || Date.now()) - t.createdAt) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function cites(map, prefix) {
  const { nums, confidence } = citesFor(map.byField, prefix);
  if (!nums.length) return null;
  const sup = h("sup", { class: "cite" }, ...nums.map((n) => {
    const src = map.sources[n - 1];
    return h("a", { href: src.url, target: "_blank", rel: "noopener", title: src.title, text: String(n) });
  }));
  if (confidence === "low") sup.title = "Low confidence: check this source";
  return sup;
}

function renderWorking(t) {
  const lines = (t.progress || []).slice(-6).map((p) =>
    h("div", { class: "line" }, h("i", { class: "dot", style: "animation-delay:" + Math.random().toFixed(2) + "s" }), h("span", { text: (p.kind === "source" ? "Reading " : "Searching ") + p.text }))
  );
  if (!lines.length) lines.push(h("div", { class: "line" }, h("i", { class: "dot" }), h("span", { text: t.status === "queued" ? "Starting…" : "Searching the web…" })));
  return h("div", { class: "working" }, ...lines,
    h("div", { class: "foot" }, h("span", { class: "muted", text: "Runs in the background. You can close this panel." })));
}

function renderAction(t, a, i, map) {
  const key = t.id + ":" + i;
  const r = resolveAction(a, state.profile);
  const box = h("div", { class: "action" });
  const head = h("div", { class: "head" }, h("div", {}, h("div", { class: "title" }, a.label || a.type, cites(map, `actions[${i}]`))));
  box.append(head);
  const sub = [];
  if (a.type === "email" && r.action.to) sub.push("To " + r.action.to);
  if (a.subject) sub.push(r.action.subject);
  if (a.type === "calendar" && a.start) sub.push(a.start + (a.location ? " · " + a.location : ""));
  if ((a.type === "open_link") && a.url) sub.push(a.url);
  if (a.type === "phone_call" && a.to) sub.push(a.to);
  if (sub.length) head.firstChild.append(h("div", { class: "sub", text: sub.join(" · ") }));

  const btns = h("div", { class: "btns" });
  if (r.kind === "email" || r.kind === "copy" || (a.type === "phone_call" && a.body)) {
    const ta = h("textarea", { class: "v-textarea edit", "aria-label": "Draft" });
    ta.value = drafts.get(key) ?? (r.text || "");
    ta.addEventListener("input", () => drafts.set(key, ta.value));
    box.append(ta);
    const current = () => ({ ...r.action, body: ta.value });
    if (r.kind === "email") {
      btns.append(
        h("button", { class: "v-btn v-btn--quiet v-btn--sm", text: "Open in Gmail", onclick: () => chrome.tabs.create({ url: resolveAction(current(), state.profile).gmail }) }),
        h("button", { class: "v-btn v-btn--quiet v-btn--sm", text: "Mail app", onclick: () => chrome.tabs.create({ url: resolveAction(current(), state.profile).mailto }) })
      );
    }
    btns.append(h("button", { class: "v-btn v-btn--quiet v-btn--sm", text: "Copy", onclick: () => navigator.clipboard.writeText(ta.value).then(() => toast("Copied")) }));
  }
  if (r.kind === "link" && r.url) {
    const label = a.type === "calendar" ? "Add to calendar" : a.type === "phone_call" ? "Call" : "Open";
    btns.prepend(h("button", { class: "v-btn v-btn--quiet v-btn--sm", text: label, onclick: () => chrome.tabs.create({ url: r.url }) }));
    if (a.type === "open_link") btns.append(doItButton(t, { actionIndex: i }) || "");
  }
  box.append(btns);
  if (r.missing.length) box.append(h("div", { class: "warn-note", text: `Fill in before sending: ${r.missing.join(", ")}. Add them in settings or edit the draft.` }));
  return box;
}

function renderFormFill(t, fills) {
  const labels = Object.fromEntries((t.page?.fields || []).map((f) => [f.id, f.label || f.id]));
  const dl = h("dl", { class: "fill-preview" });
  for (const f of fills.slice(0, 14)) {
    dl.append(h("dt", { text: labels[f.field_id] || f.field_id }), h("dd", { text: fillPlaceholders(f.value, state.profile) }));
  }
  const missing = unfilledPlaceholders(fills.map((f) => f.value).join(" "));
  const box = h("div", { class: "action" },
    h("div", { class: "head" }, h("div", {}, h("div", { class: "title", text: "Fill the form on this page" }), h("div", { class: "sub", text: t.page?.title || t.page?.url || "" }))),
    dl,
    h("div", { class: "btns" }, h("button", {
      class: "v-btn v-btn--quiet v-btn--sm",
      text: `Fill ${fills.length} field${fills.length === 1 ? "" : "s"}`,
      onclick: async () => {
        try {
          const res = await send({ type: "fill", taskId: t.id });
          toast(res.error ? res.error : `Filled ${res.filled} field${res.filled === 1 ? "" : "s"}. Check them, then submit yourself.`);
        } catch (e) { toast(e.message); }
      },
    }), /^https?:/.test(t.page?.url || "") ? doItButton(t, { startUrl: t.page.url, goal: "Fill in the form on this page" }) : null)
  );
  if (missing.length) box.append(h("div", { class: "warn-note", text: `Still empty: ${missing.join(", ")}. Add them in settings.` }));
  return box;
}

function renderMissing(t, questions) {
  const inputs = questions.map((q) => h("input", { class: "v-input", type: "text", "aria-label": q }));
  return h("div", { class: "missing" },
    h("h4", { text: "Vali needs" }),
    ...questions.map((q, i) => h("label", {}, q, inputs[i])),
    h("div", { class: "btns row end", style: "margin-top:8px" }, h("button", {
      class: "v-btn v-btn--quiet v-btn--sm",
      text: "Continue",
      onclick: async () => {
        const answers = questions.map((q, i) => `${q} ${inputs[i].value.trim() || "(no answer)"}`).join("\n");
        try {
          const rec = await send({ type: "start", task: `${t.task}\n\nMy answers:\n${answers}`, tabId: t.tabId, usePage: !!t.page, previousRunId: t.runId, parentId: t.id });
          open.add(rec.id);
        } catch (e) { toast(e.message); }
      },
    }))
  );
}

function renderResult(t) {
  const out = t.output || {};
  const s = out.structured;
  const map = numberSources(out.grounding);
  const body = [];
  if (!s) {
    body.push(h("p", { class: "answer", text: out.text || "No answer came back." }));
  } else {
    body.push(h("p", { class: "answer" }, s.answer || "", cites(map, "answer")));
    if (s.key_facts?.length) {
      const dl = h("dl", { class: "facts" });
      s.key_facts.forEach((f, i) => dl.append(h("dt", { text: f.label }), h("dd", {}, f.value, cites(map, `key_facts[${i}]`))));
      body.push(dl);
    }
    if (s.missing_info?.length) body.push(renderMissing(t, s.missing_info));
    const acts = [];
    if (s.form_fill?.length) acts.push(renderFormFill(t, s.form_fill));
    (s.actions || []).forEach((a, i) => acts.push(renderAction(t, a, i, map)));
    if (acts.length) body.push(h("h4", { text: "Ready for you" }), h("div", { class: "actions" }, ...acts));
    if (s.steps?.length) {
      body.push(h("h4", { text: "Steps" }), h("ol", { class: "steps" }, ...s.steps.map((st, i) =>
        h("li", { class: st.done_by_hoida ? "done" : "" },
          h("div", {}, h("strong", { text: st.title }), st.done_by_hoida ? h("span", { class: "v-badge v-badge--success", text: "prepared" }) : null, cites(map, `steps[${i}]`)),
          h("div", { class: "detail" }, st.detail || "", st.url ? h("span", {}, " ", h("a", { href: st.url, target: "_blank", rel: "noopener", text: "Open" })) : null)
        ))));
    }
  }
  if (map.sources.length) {
    body.push(h("h4", { text: "Sources" }), h("ol", { class: "sources" }, ...map.sources.map((src) =>
      h("li", {}, h("a", { href: src.url, target: "_blank", rel: "noopener", text: src.title }), " ", h("span", { class: "host", text: src.host }))
    )));
  }
  return body;
}

// ---------- the cloud browser run (task.execution) ----------
// The live <img> of each run survives re-renders (the node is moved, not rebuilt), so the picture never blinks.
const liveImgs = new Map(); // task id -> <img>
const frames = new Map(); // task id -> object URL of the newest frame
const loadingFrame = new Set();

function liveImg(t) {
  let img = liveImgs.get(t.id);
  if (!img) {
    img = h("img", { class: "live-shot v-live__shot", alt: "What Vali sees in the browser" });
    liveImgs.set(t.id, img);
  }
  const f = frames.get(t.id);
  if (f && img.src !== f) img.src = f;
  return img;
}

async function fetchImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? await res.blob() : null;
  } catch (_) {
    return null;
  }
}

// The newest live frame (GET live.jpg); before the first frame arrives, the last step's screenshot.
async function refreshFrame(t) {
  if (loadingFrame.has(t.id)) return;
  loadingFrame.add(t.id);
  try {
    let blob = await fetchImage(await liveUrl(t));
    if (!blob) {
      const n = executionView(t)?.lastShot;
      if (n != null) blob = await fetchImage(await shotUrl(t, n));
    }
    if (!blob) return;
    const old = frames.get(t.id);
    const obj = URL.createObjectURL(blob);
    frames.set(t.id, obj);
    const img = liveImgs.get(t.id);
    if (img) { img.src = obj; img.closest(".v-live")?.removeAttribute("data-empty"); }
    if (old) URL.revokeObjectURL(old);
  } finally {
    loadingFrame.delete(t.id);
  }
}

function filledList(rows, { copy = false } = {}) {
  const dl = h("dl", { class: "fill-preview exec-values" });
  for (const r of rows) {
    const dd = h("dd", {}, h("span", { class: "val", text: r.value }));
    if (r.source) dd.append(" ", h("a", { class: "src", href: r.source, target: "_blank", rel: "noopener", title: r.source, text: r.sourceHost || "source" }));
    else if (r.sourceText) dd.append(" ", h("span", { class: "src muted", text: r.sourceText }));
    if (copy) dd.append(h("button", { class: "v-btn v-btn--quiet v-btn--sm copy", type: "button", text: "Copy", onclick: () => navigator.clipboard.writeText(r.value).then(() => toast("Copied")) }));
    dl.append(h("dt", { text: r.label, title: r.label }), dd);
  }
  return dl;
}

function renderQuestion(t, q) {
  if (q.answered) return h("div", { class: "exec-question sent" }, h("strong", { text: "Vali asked: " }), q.text, h("div", { class: "muted small", text: "Answer sent. Vali reads it at the next step." }));
  const key = "q:" + t.id;
  const ta = h("textarea", { class: "v-textarea edit answer-box", rows: "2", "aria-label": "Your answer", placeholder: "Your answer" });
  ta.value = drafts.get(key) || "";
  ta.addEventListener("input", () => drafts.set(key, ta.value));
  const btn = h("button", { class: "v-btn v-btn--quiet v-btn--sm", type: "button", text: "Send answer" });
  const submit = async () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    btn.disabled = true;
    try {
      await send({ type: "message", taskId: t.id, text });
      answered.set(t.id, q.at);
      drafts.delete(key);
      ta.blur();
      render();
    } catch (e) {
      btn.disabled = false;
      toast(e.message);
    }
  };
  btn.addEventListener("click", submit);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
  return h("div", { class: "exec-question" }, h("strong", { text: "Vali asks" }), h("p", { text: q.text }), ta, h("div", { class: "btns row end" }, btn));
}

function inlineButton(t, text, cls, action) {
  const key = `${t.id}:${text}`;
  const b = h("button", { class: cls, type: "button", text, "aria-label": `${text}: ${t.task.split("\n\nMy answers:")[0]}`, "data-inline-action": key });
  b.disabled = pendingInline.has(key);
  b.addEventListener("click", async () => {
    if (b.disabled) return;
    const pending = { tasks: state.tasks, inFlight: true };
    pendingInline.set(key, pending);
    b.disabled = true;
    try {
      await action();
    } catch (e) {
      pendingInline.delete(key);
      toast(e.message);
    } finally {
      pending.inFlight = false;
      render();
    }
  });
  return b;
}

function serverButton(text, cls, msg, done, task = null) {
  if (task) return inlineButton(task, text, cls, async () => {
    await send(msg);
    if (done) toast(done);
  });
  const b = h("button", { class: cls, type: "button", text });
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await send(msg);
      if (done) toast(done);
    } catch (e) {
      toast(e.message);
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

function stillShot(t, n) {
  const img = h("img", { class: "live-shot v-live__shot", alt: "The page where Vali stopped" });
  shotUrl(t, n).then((u) => { if (u) img.src = u; }).catch(() => {});
  return h("div", { class: "v-live done" }, img);
}

function renderExecution(t) {
  const v = executionView(t, { profile: state.profile, answered: answered.get(t.id) ?? null });
  if (!v) return null;
  const box = h("section", { class: `exec exec-${v.phase}` });
  if (v.live) {
    const [status, tone] = errandStatus(t);
    const frame = h("div", { class: "v-live" + (v.phase === "approval" ? " v-live--waiting" : ""), "data-empty": frames.has(t.id) ? null : "Waiting for the first picture…" },
      liveImg(t), h("span", { class: `v-badge v-badge--dot ${tone ? "v-badge--" + tone : "v-badge--live"}`, text: status }));
    box.append(frame, h("div", { class: "exec-step" }, v.phase === "live" ? h("i", { class: "dot" }) : null, h("span", { text: v.step || (v.status === "starting" ? "Opening the browser…" : "Working…") }), v.stepCount ? h("span", { class: "muted n", text: `step ${v.stepCount}` }) : null));
    if (v.question) box.append(renderQuestion(t, v.question));
  }
  if (v.phase === "approval") {
    box.append(h("h4", { text: "Ready to send" }));
    if (v.summary) box.append(h("p", { class: "exec-summary", text: v.summary }));
    if (v.approval.length) box.append(filledList(v.approval));
  } else if (v.phase === "blocked" || v.phase === "failed") {
    const reason = v.blocker?.reason || v.result || v.error || "I couldn’t finish this errand.";
    box.append(h("p", { class: "exec-reason", text: reason }));
    const url = v.blocker?.url || v.url;
    if (url) box.append(h("div", { class: "btns row" }, h("button", { class: "v-btn v-btn--quiet v-btn--sm", type: "button", text: "Finish in your tab", title: url, onclick: () => chrome.tabs.create({ url }) })));
    if (v.filled.length) {
      box.append(h("h4", { text: "Filled so far" }), filledList(v.filled, { copy: true }),
        h("div", { class: "btns row end" }, h("button", { class: "v-btn v-btn--quiet v-btn--sm", type: "button", text: "Copy all", onclick: () => navigator.clipboard.writeText(v.filled.map((r) => `${r.label}: ${r.value}`).join("\n")).then(() => toast("Copied")) })));
    }
    if (v.lastShot != null) box.append(stillShot(t, v.lastShot));
  } else if (v.phase === "done") {
    box.append(h("p", { class: "exec-result", text: v.result || "Submitted." }));
    if (v.lastShot != null) box.append(stillShot(t, v.lastShot));
  } else if (v.phase === "stopped") {
    box.append(h("p", { class: "muted exec-result", text: v.error ? `Stopped: ${v.error}` : "Stopped. Nothing was sent." }));
  }
  return box;
}

// "Let Vali do it": start the cloud browser on a prepared link or on the page the errand came from.
function doItButton(t, opts) {
  const x = t.execution?.status;
  if (!t.backend || t.status !== "completed" || (x && (LIVE.has(x) || x === "done"))) return null;
  return serverButton(x ? "Let Vali try again" : "Let Vali do it", "v-btn v-btn--quiet v-btn--sm", { type: "execute", taskId: t.id, ...opts }, "Vali is opening the page in a cloud browser.");
}

function selectTask(t, focusAnswer = false) {
  open.delete(t.id);
  open.add(t.id);
  if (t.status === "completed" && !t.seen) send({ type: "seen", taskId: t.id }).catch((e) => toast(e.message));
  render();
  $("detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  if (focusAnswer) $("detail").querySelector("textarea.answer-box, .missing input")?.focus();
}

function renderCard(t) {
  const card = $("cardTpl").content.firstElementChild.cloneNode(true);
  const [label, tone] = errandStatus(t);
  card.dataset.tone = tone;
  card.querySelector(".still").src = `../mascot/${taskMascot(t)}.svg`;
  card.querySelector(".status").textContent = label;
  card.querySelector(".task-text").textContent = t.parentId ? "↳ " + t.task.split("\n\nMy answers:")[0] : t.task;
  card.querySelector(".meta").textContent = t.source === "whatsapp" ? " · WhatsApp" : "";
  card.querySelector(".card-head").addEventListener("click", () => selectTask(t));
  card.querySelector(".card-head").setAttribute("aria-expanded", String(t.id === selectedTask()?.id));
  const actions = card.querySelector(".v-row__actions");
  const v = executionView(t, { answered: answered.get(t.id) ?? null });
  if ((v?.question && !v.question.answered) || (!v && t.output?.structured?.missing_info?.length)) {
    actions.append(inlineButton(t, "Answer", "v-btn v-btn--quiet v-btn--sm", () => selectTask(t, true)));
  } else if (v?.phase === "approval") {
    actions.append(serverButton("Approve", "v-btn v-btn--quiet v-btn--sm", { type: "approve", taskId: t.id }, "Approved. I’m sending it now.", t));
  }
  if (v?.live || t.status === "queued" || t.status === "running") {
    actions.append(serverButton("Stop", "v-btn v-btn--danger v-btn--sm", { type: v?.live ? "stop" : "cancel", taskId: t.id }, null, t));
  }
  return card;
}

function selectedTask() {
  const selected = [...open].reverse().map((id) => state.tasks.find((t) => t.id === id)).find(Boolean);
  return selected || state.tasks.find((t) => LIVE.has(t.execution?.status)) || state.tasks[0];
}

function renderDetail(t) {
  const body = $("detail");
  const expanded = body.dataset.taskId === t?.id && body.querySelector("details")?.open;
  body.dataset.taskId = t?.id || "";
  body.hidden = !t;
  body.replaceChildren();
  if (!t) return;
  const [, tone] = errandStatus(t);
  body.classList.toggle("v-card--attention", tone === "warning");
  body.append(h("h2", { class: "v-card__title", text: t.task.split("\n\nMy answers:")[0] }));
  const exec = renderExecution(t);
  if (exec) body.append(exec);
  if (t.status === "queued" || t.status === "running") body.append(renderWorking(t));
  else if (t.status === "completed") {
    const result = renderResult(t);
    if (exec) body.append(h("details", { class: "result-details", open: expanded }, h("summary", { text: "Details and sources" }), ...result));
    else body.append(...result);
  }
  else body.append(h("p", { class: "error", text: t.error || "Stopped." }));
  if (t.status !== "queued" && t.status !== "running") {
    body.append(h("div", { class: "foot" }, h("span", { class: "muted", text: [elapsed(t), t.page?.title, t.cost != null ? "$" + Number(t.cost).toFixed(3) : null].filter(Boolean).join(" · ") }),
      serverButton("Remove", "v-btn v-btn--quiet v-btn--sm", { type: "remove", taskId: t.id })));
  }
}

function render() {
  updateMascot();
  for (const [key, pending] of pendingInline) {
    if (!pending.inFlight && pending.tasks !== state.tasks) pendingInline.delete(key);
  }
  const list = $("list");
  for (const button of list.querySelectorAll("[data-inline-action]")) button.disabled = pendingInline.has(button.dataset.inlineAction);
  const live = new Set(state.tasks.filter((t) => LIVE.has(t.execution?.status)).map((t) => t.id));
  for (const [id, url] of frames) if (!live.has(id)) { URL.revokeObjectURL(url); frames.delete(id); liveImgs.delete(id); }
  // Preserve unsent answers and the caret while polling.
  const focused = document.activeElement?.closest?.(".detail-card") ? document.activeElement : null;
  if (focused && (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT")) return;
  if (!list.contains(document.activeElement)) list.replaceChildren(...state.tasks.map(renderCard));
  $("list").hidden = !state.tasks.length;
  renderDetail(selectedTask());
  $("empty").hidden = state.tasks.length > 0;
}

$("list").addEventListener("focusout", () => setTimeout(() => {
  if (!$("list").contains(document.activeElement)) render();
}));

// ---------- state ----------
async function load() {
  const s = await chrome.storage.local.get(Object.keys(DEFAULTS));
  state = Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, s[k] ?? d]));
  const sess = await chrome.storage.session.get(["prefill", "focusTask"]);
  if (sess.prefill && Date.now() - sess.prefill.at < 5 * 60 * 1000) applyPrefill(sess.prefill);
  if (sess.focusTask) { open.add(sess.focusTask); chrome.storage.session.remove("focusTask"); }
  if (!state.exaKey && !state.backendUrl) { $("settings").hidden = false; renderSettings(); }
  if (state.backendUrl) send({ type: "poll" }).catch(() => {}); // bring in errands started on WhatsApp
  await refreshActiveTab();
  render();
}

function applyPrefill(p) {
  prefill = p;
  if (p.task) {
    // from the badge on a form page: "Help me fill in this form", with this page attached
    $("task").value = p.task;
    $("usePage").checked = p.usePage !== false;
  } else if (p.link && !p.selection) {
    $("task").value = `Help me with this link: ${p.link}\n`;
  }
  $("task").focus();
  refreshActiveTab();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    for (const k of Object.keys(DEFAULTS)) if (changes[k]) state[k] = changes[k].newValue ?? DEFAULTS[k];
    render();
  }
  if (area === "session" && changes.prefill?.newValue) applyPrefill(changes.prefill.newValue);
  if (area === "session" && changes.focusTask?.newValue) { open.delete(changes.focusTask.newValue); open.add(changes.focusTask.newValue); render(); }
});

// Poll faster than the background alarm while the panel is open and something is running.
// With a Vali server, also look for new errands from WhatsApp every ~16 s.
const BUSY_EXEC = new Set(["starting", "running", "awaiting_approval", "submitting"]);
let ticks = 0;
setInterval(() => {
  if (document.hidden) return;
  ticks++;
  const busy = state.tasks.some((t) => t.status === "queued" || t.status === "running" || BUSY_EXEC.has(t.execution?.status));
  if (busy || (state.backendUrl && ticks % 4 === 0)) {
    send({ type: "poll" }).catch(() => {});
    if (busy) render();
  }
}, 4000);

// The live browser view: a new frame about once a second for each open card whose run is live, and the run's
// steps from the server every 2 s, only while the panel is visible.
let liveTicks = 0;
setInterval(() => {
  if (document.hidden) return;
  const live = state.tasks.filter((t) => t.backend && LIVE.has(t.execution?.status));
  if (!live.length) return;
  for (const t of live) if (selectedTask()?.id === t.id) refreshFrame(t);
  if (++liveTicks % 2 === 0) send({ type: "poll" }).catch(() => {});
}, 1000);

load();
