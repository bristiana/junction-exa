// Vali side panel: compose an errand, watch it run, review the result and approve the prepared steps.
// Everything the agent returns is rendered with textContent, never as HTML.

import { PROFILE_FIELDS } from "../lib/task.js";
import { numberSources, citesFor, resolveAction, fillPlaceholders, unfilledPlaceholders } from "../lib/actions.js";
import { search } from "../lib/exa.js";
import { connect, me as serverMe, pair, normalizeBaseUrl } from "../lib/backend.js";
import { taskMascot, headerMascot, finishFlash, FLASH_MS } from "../lib/mascot.js";

const $ = (id) => document.getElementById(id);
const PRESETS = [
  ["Flight delay", "My flight was delayed by more than 3 hours. Can I get compensation? Prepare the claim."],
  ["Address change", "I just moved to a new apartment in Helsinki. Register my change of address and tell me who else I need to notify."],
  ["Rent increase", "My landlord wants to raise my rent by 8% from next month. Is that allowed under my lease and Finnish law? Draft a reply."],
  ["Kela benefits", "I am an international student in Finland. Which Kela benefits can I get, and how do I apply?"],
  ["Sauna booking", "Find a public sauna in Helsinki for a group of 8 this Saturday evening that can be booked online."],
];
const STATUS = {
  queued: ["Queued", ""],
  running: ["Working", ""],
  completed: ["Ready", "ready"],
  failed: ["Failed", "failed"],
  cancelled: ["Cancelled", "cancelled"],
};
const RESULT_PILL = {
  ready_to_approve: ["Approve", "ready"],
  needs_info: ["Needs info", "info"],
  not_possible: ["Not possible", "failed"],
  info_only: ["Answer", "ready"],
};
// Once the cloud browser has started on an errand, its status is the one that matters.
const EXEC_PILL = {
  starting: ["Starting", ""],
  running: ["Doing it", ""],
  awaiting_approval: ["Approve", "info"],
  submitting: ["Sending", ""],
  done: ["Done", "ready"],
  failed: ["Failed", "failed"],
  stopped: ["Stopped", "cancelled"],
};

const DEFAULTS = { tasks: [], profile: {}, exaKey: "", effort: "low", backendUrl: "", presence: true };
let state = { ...DEFAULTS };
let activeTab = null;
let prefill = null;
const open = new Set();
const drafts = new Map(); // edited email bodies, keyed by task+action index

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
  idle: "At your service",
  listening: "Listening",
  thinking: "Researching",
  working: "Working in the browser",
  needs_approval: "Waiting for your OK",
  success: "Done",
  error: "Something went wrong",
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
  $("mascotSays").textContent = SAYS[pose] || "";
}
$("task").addEventListener("focus", updateMascot);
$("task").addEventListener("blur", () => setTimeout(updateMascot)); // after the blur, so hasFocus() is current

// ---------- settings ----------
function renderSettings() {
  $("exaKey").value = state.exaKey;
  $("effort").value = state.effort;
  $("presence").checked = state.presence !== false;
  $("backendUrl").value = state.backendUrl;
  $("pairInfo").hidden = true;
  refreshServerStatus();
  const box = $("profileFields");
  box.replaceChildren(
    ...PROFILE_FIELDS.map(([k, label]) =>
      h("label", {}, h("span", { text: label }), h("input", { type: "text", "data-k": k, value: state.profile[k] || "", placeholder: k === "language" ? "English" : "" }))
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
  await chrome.storage.local.remove("backendUrl"); // the token stays, so saving the same URL again keeps the WhatsApp link
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
  ...PRESETS.map(([label, text]) => h("button", { type: "button", class: "chip", text: label, onclick: () => { $("task").value = text; $("task").focus(); } }))
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
  if (!lines.length) lines.push(h("div", { class: "line" }, h("i", { class: "dot" }), h("span", { text: t.status === "queued" ? "Queued at Exa…" : "Searching the web…" })));
  return h("div", { class: "working" }, ...lines,
    h("div", { class: "foot" }, h("span", { class: "muted", text: "Runs in the background. You can close this panel." }), h("button", { class: "btn quiet small", text: "Cancel", onclick: () => send({ type: "cancel", taskId: t.id }) })));
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
    const ta = h("textarea", { class: "edit", "aria-label": "Draft" });
    ta.value = drafts.get(key) ?? (r.text || "");
    ta.addEventListener("input", () => drafts.set(key, ta.value));
    box.append(ta);
    const current = () => ({ ...r.action, body: ta.value });
    if (r.kind === "email") {
      btns.append(
        h("button", { class: "btn small", text: "Open in Gmail", onclick: () => chrome.tabs.create({ url: resolveAction(current(), state.profile).gmail }) }),
        h("button", { class: "btn ghost small", text: "Mail app", onclick: () => chrome.tabs.create({ url: resolveAction(current(), state.profile).mailto }) })
      );
    }
    btns.append(h("button", { class: "btn ghost small", text: "Copy", onclick: () => navigator.clipboard.writeText(ta.value).then(() => toast("Copied")) }));
  }
  if (r.kind === "link" && r.url) {
    const label = a.type === "calendar" ? "Add to calendar" : a.type === "phone_call" ? "Call" : "Open";
    btns.prepend(h("button", { class: "btn small", text: label, onclick: () => chrome.tabs.create({ url: r.url }) }));
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
      class: "btn small",
      text: `Fill ${fills.length} field${fills.length === 1 ? "" : "s"}`,
      onclick: async () => {
        try {
          const res = await send({ type: "fill", taskId: t.id });
          toast(res.error ? res.error : `Filled ${res.filled} field${res.filled === 1 ? "" : "s"}. Check them, then submit yourself.`);
        } catch (e) { toast(e.message); }
      },
    }))
  );
  if (missing.length) box.append(h("div", { class: "warn-note", text: `Still empty: ${missing.join(", ")}. Add them in settings.` }));
  return box;
}

function renderMissing(t, questions) {
  const inputs = questions.map((q) => h("input", { type: "text", "aria-label": q }));
  return h("div", { class: "missing" },
    h("h4", { text: "Vali needs" }),
    ...questions.map((q, i) => h("label", {}, q, inputs[i])),
    h("div", { class: "btns row end", style: "margin-top:8px" }, h("button", {
      class: "btn small",
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
          h("div", {}, h("strong", { text: st.title }), st.done_by_hoida ? h("span", { class: "badge", text: "prepared" }) : null, cites(map, `steps[${i}]`)),
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

function renderCard(t) {
  const card = document.getElementById("cardTpl").content.firstElementChild.cloneNode(true);
  const s = t.output?.structured;
  const [label, cls] = EXEC_PILL[t.execution?.status]
    || (t.status === "completed" && s?.status ? RESULT_PILL[s.status] || STATUS.completed : STATUS[t.status] || [t.status, ""]);
  card.querySelector(".still").src = `../mascot/${taskMascot(t)}.svg`;
  card.querySelector(".pill").textContent = label;
  if (cls) card.querySelector(".pill").classList.add(cls);
  card.querySelector(".task-text").textContent = t.parentId ? "↳ " + t.task.split("\n\nMy answers:")[0] : t.task;
  const meta = [elapsed(t)];
  if (t.page?.title) meta.push(t.page.title.slice(0, 40));
  if (t.cost != null) meta.push("$" + Number(t.cost).toFixed(3));
  const metaEl = card.querySelector(".meta");
  metaEl.textContent = meta.join(" · ");
  if (t.source === "whatsapp") metaEl.prepend(h("span", { class: "tag", text: "WhatsApp" }));
  if (t.status === "completed" && !t.seen) card.classList.add("unseen");
  if (!open.has(t.id)) card.classList.add("collapsed");
  card.querySelector(".card-head").addEventListener("click", () => {
    open.has(t.id) ? open.delete(t.id) : open.add(t.id);
    if (t.status === "completed" && !t.seen) send({ type: "seen", taskId: t.id });
    render();
  });
  const body = card.querySelector(".card-body");
  if (t.status === "queued" || t.status === "running") body.append(renderWorking(t));
  else if (t.status === "completed") body.append(...renderResult(t));
  else body.append(h("p", { class: "error", text: t.error || "Cancelled." }));
  if (t.status !== "queued" && t.status !== "running") {
    body.append(h("div", { class: "foot" }, h("span", { class: "muted", text: t.stopReason && t.stopReason !== "schema_satisfied" ? `Stopped: ${t.stopReason.replace(/_/g, " ")}` : "" }),
      h("button", { class: "btn quiet small", text: "Remove", onclick: () => send({ type: "remove", taskId: t.id }) })));
  }
  return card;
}

function render() {
  updateMascot();
  const list = $("list");
  // keep focus and scroll inside text areas stable while polling re-renders
  const focused = document.activeElement?.closest?.(".card") ? document.activeElement : null;
  if (focused && focused.tagName === "TEXTAREA") return;
  list.replaceChildren(...state.tasks.map(renderCard));
  $("empty").hidden = state.tasks.length > 0;
}

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
  if (area === "session" && changes.focusTask?.newValue) { open.add(changes.focusTask.newValue); render(); }
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

load();
