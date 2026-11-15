// Vali side panel: a chat. The errand is the user's bubble, Vali answers in bubbles with its sources, the Exa line
// and the next steps as buttons; Vali's questions are bubbles too, answered from the composer at the bottom.
// Everything the agent returns is rendered with textContent, never as HTML.

import { PROFILE_FIELDS } from "../lib/task.js";
import { numberSources, citesFor, resolveAction, fillPlaceholders, unfilledPlaceholders, hostOf } from "../lib/actions.js";
import { search } from "../lib/exa.js";
import { connect, me as serverMe, pair, normalizeBaseUrl, ensureConnected, liveUrl, shotUrl, DEFAULT_BASE_URL, linkCode, stats as serverStats } from "../lib/backend.js";
import { taskMascot, headerMascot, finishFlash, FLASH_MS } from "../lib/mascot.js";
import { executionView, LIVE } from "../lib/execution.js";

import { linkCodeInput, codeCountdown, linkError } from "../lib/device-link.js";
import { exaActivity } from "../lib/exa-activity.js";
import { exaUses, EXA_USES } from "../shared/exa-uses.js";
import { panelStatus as errandStatus } from "./errand-status.js";
import { conversations, conversationOf, pendingAsk, composerMessage, executionTurns, rememberQuestion, shortAnswer, chatStats, money, ago, userText, titleOf } from "../lib/chat.js";

const $ = (id) => document.getElementById(id);
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
// The conversation on screen: any errand id in it; null = the newest conversation; "new" = an empty thread.
let currentTask = null;
const drafts = new Map(); // edited email bodies, keyed by task+action index
const answered = new Map(); // task id -> question.at answered from here, until the agent picks the answer up
const pendingInline = new Map(); // action -> task snapshot and request still in flight
const replyOff = new Set(); // questions the user chose not to answer from the composer (a new errand instead)
let asked = {}; // task id -> [{ text, at }]: the browser's questions, kept here because the server clears them
let statsData = null; // GET /v1/stats

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
  const t = h("div", { class: "toast", role: "status", text: msg });
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
// One animated Vali in the header follows the errand that matters most (lib/mascot.js); bubbles use stills.
const SAYS = {
  idle: "I’m ready to help.",
  listening: "I’m listening.",
  searching: "I’m searching the web.",
  working: "I’m working on your errand.",
  needs_approval: "I’m waiting for you.",
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
$("task").addEventListener("focus", updateMascot);
$("task").addEventListener("blur", () => setTimeout(updateMascot)); // after the blur, so hasFocus() is current

// ---------- settings ----------
function renderSettings() {
  $("exaKey").value = state.exaKey;
  $("effort").value = state.effort;
  $("presence").checked = state.presence !== false;
  $("backendUrl").value = state.backendUrl;
  $("pairInfo").hidden = true;
  clearMacCode();
  $("serverPresets").replaceChildren(...SERVER_PRESETS.map(([label, url]) =>
    h("button", { type: "button", class: "v-btn v-btn--quiet v-btn--sm", text: label, title: url, onclick: () => { $("backendUrl").value = url; $("connectBtn").click(); } })));
  refreshServerStatus();
  $("exaUses").replaceChildren(exaUsesList(EXA_USES));
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
  else clearMacCode();
});
async function saveSettings() {
  const profile = {};
  for (const i of $("profileFields").querySelectorAll("input")) if (i.value.trim()) profile[i.dataset.k] = i.value.trim();
  await chrome.storage.local.set({ exaKey: $("exaKey").value.trim(), effort: $("effort").value, profile, presence: $("presence").checked });
}
$("useDemoDetails").addEventListener("click", async () => {
  const demo = {
    name: "Bogdan Caraeane", email: "demo@vali.demo", phone: "+358 40 123 4567",
    address: "Otakaari 1", postal_code: "02150", city: "Espoo", country: "Finland",
    date_of_birth: "2000-01-01", nationality: "Romanian",
  };
  for (const i of $("profileFields").querySelectorAll("input")) if (i.dataset.k in demo) i.value = demo[i.dataset.k];
  try {
    await saveSettings();
    toast("Demo details saved");
  } catch (e) { toast(e.message); }
});
$("saveSettings").addEventListener("click", async () => {
  await saveSettings();
  $("settings").hidden = true;
  toast("Saved");
});

// ---------- Vali server and WhatsApp ----------
async function useDirectMode() {
  await chrome.storage.local.set({ backendUrl: "" }); // "" = direct mode; the token stays, so saving the same URL again keeps the WhatsApp link
  clearMacCode();
  state.backendUrl = "";
  refreshServerStatus();
}

async function connectServer(url) {
  clearMacCode();
  const who = await connect(url);
  state.backendUrl = normalizeBaseUrl(url);
  $("backendUrl").value = state.backendUrl;
  showServerStatus(who);
  send({ type: "poll" }).catch(() => {});
  return who;
}

function showServerStatus(who) {
  $("backendStatus").textContent = "Connected";
  $("signStatus").textContent = "Signed in.";
  $("pairBtn").disabled = false;
  $("waStatus").textContent = who?.whatsapp_linked ? `Linked${who.whatsapp_last4 ? " (…" + who.whatsapp_last4 + ")" : ""}` : "Not linked yet";
}

async function refreshServerStatus() {
  const st = $("backendStatus");
  $("pairBtn").disabled = !state.backendUrl;
  $("showMacCode").disabled = !state.backendUrl;
  $("linkMac").disabled = !state.backendUrl;
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
    $("signStatus").textContent = "Not signed in yet.";
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

// ---------- Mac linking ----------
let macCodeTimer = 0;
function clearMacCode() {
  clearInterval(macCodeTimer);
  $("macCode").hidden = true;
  $("macCode").replaceChildren();
}

$("showMacCode").addEventListener("click", async () => {
  const button = $("showMacCode");
  button.disabled = true;
  clearMacCode();
  $("macLinkStatus").textContent = "Getting a code…";
  try {
    await ensureConnected();
    const { code, expires_in } = await linkCode();
    linkCodeInput(code);
    if (!Number.isFinite(expires_in) || expires_in <= 0) throw new Error("Couldn’t get a code. Try again.");
    const until = Date.now() + expires_in * 1000;
    const tick = () => {
      $("macCode").hidden = false;
      if (Date.now() >= until) {
        $("macCode").textContent = codeCountdown(until);
        clearInterval(macCodeTimer);
      } else {
        $("macCode").replaceChildren(h("code", { text: code }), " · " + codeCountdown(until));
      }
    };
    tick();
    macCodeTimer = setInterval(tick, 1000);
    $("macLinkStatus").textContent = "Enter this code in Vali on your Mac. Share it only with your own device.";
  } catch (e) {
    $("macLinkStatus").textContent = e.message;
  } finally { button.disabled = false; }
});

$("signInBtn").addEventListener("click", async () => {
  const button = $("signInBtn");
  button.disabled = true;
  $("signStatus").textContent = "Signing in…";
  try {
    await send({ type: "signIn", email: $("signEmail").value.trim(), password: $("signPassword").value });
    $("signPassword").value = "";
    currentTask = null;
    drafts.clear();
    answered.clear();
    $("signStatus").textContent = "Signed in.";
    await refreshServerStatus();
    await send({ type: "poll" });
  } catch (e) {
    $("signStatus").textContent = e.message;
  } finally { button.disabled = false; }
});

$("linkMac").addEventListener("click", async () => {
  const button = $("linkMac");
  button.disabled = true;
  try {
    const code = linkCodeInput($("macCodeInput").value);
    $("macLinkStatus").textContent = "Linking…";
    await send({ type: "linkAccount", code });
    clearMacCode();
    currentTask = null;
    drafts.clear();
    answered.clear();
    $("macCodeInput").value = "";
    $("macLinkStatus").textContent = "Linked. Both devices now share the same account.";
    await refreshServerStatus();
    await send({ type: "poll" });
  } catch (e) {
    $("macLinkStatus").textContent = linkError(e);
  } finally { button.disabled = false; }
});

$("talk").addEventListener("click", () => {
  $("talkHint").hidden = !$("talkHint").hidden;
  $("talk").setAttribute("aria-expanded", String(!$("talkHint").hidden));
});

// ---------- composer ----------
let pageReadable = false;
async function refreshActiveTab() {
  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) { activeTab = null; }
  const readable = activeTab?.url && /^(https?|file):/.test(activeTab.url);
  pageReadable = !!(readable || prefill?.selection);
  if (prefill?.selection) $("contextLabel").textContent = `Use the selected text: “${prefill.selection.slice(0, 60)}${prefill.selection.length > 60 ? "…" : ""}”`;
  else if (readable) $("contextLabel").textContent = `Use this page: ${(activeTab.title || activeTab.url).slice(0, 70)}`;
  updateComposer(currentConvo());
}
chrome.tabs.onActivated.addListener(refreshActiveTab);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === "complete" || info.title) refreshActiveTab(); });

const taskById = (id) => state.tasks.find((t) => t.id === id);
const askKey = (ask) => (ask ? `${ask.route}:${ask.taskId}:${ask.at || ask.text}` : "");

// The conversation on screen (see currentTask).
function currentConvo(convos = conversations(state.tasks)) {
  if (currentTask === "new") return null;
  return (currentTask && conversationOf(convos, currentTask)) || convos[0] || null;
}

// What the composer answers right now: Vali's open question in this conversation, unless the user dismissed it.
function replyAsk(convo) {
  const ask = convo && $("history").hidden ? pendingAsk(convo, { answered }) : null;
  return ask && !replyOff.has(askKey(ask)) ? ask : null;
}

function updateComposer(convo) {
  const ask = replyAsk(convo);
  $("replyTo").hidden = !ask;
  if (ask) $("replyTo").querySelector(".reply-to__text").textContent = "Answering Vali: " + fillPlaceholders(ask.text, state.profile);
  $("task").placeholder = ask ? "Type your answer…" : "What should I take care of?";
  $("context").hidden = !!ask || !pageReadable;
}
$("replyOff").addEventListener("click", () => {
  const ask = replyAsk(currentConvo());
  if (ask) replyOff.add(askKey(ask));
  render();
  $("task").focus();
});

// Sends what the user typed: an answer to Vali's open question (lib/chat.js routes it), else a new errand.
async function submitText(text) {
  const err = $("composerError");
  err.hidden = true;
  if (!text) { $("task").focus(); return; }
  const ask = replyAsk(currentConvo());
  const msg = ask ? composerMessage(ask, text, taskById(ask.taskId)) : null;
  if (!msg && !state.exaKey && !state.backendUrl) { err.textContent = "Add your Exa API key or a Vali server in settings first."; err.hidden = false; $("settings").hidden = false; renderSettings(); return; }
  $("send").disabled = true;
  try {
    if (msg) {
      const rec = await send(msg);
      if (ask.route === "execution") answered.set(ask.taskId, ask.at);
      if (msg.type === "start" && rec?.id) currentTask = rec.id;
    } else {
      const usePage = !$("context").hidden && $("usePage").checked;
      const rec = await send({ type: "start", task: text, tabId: activeTab?.id, usePage, selection: usePage ? prefill?.selection || "" : "" });
      currentTask = rec.id;
      prefill = null;
      chrome.storage.session.remove("prefill");
      refreshActiveTab();
    }
    $("task").value = "";
    fitTask();
    setHistory(false);
    stickBottom = true;
    render();
  } catch (e2) {
    if (msg?.type === "message") err.textContent = e2.status === 409 ? "Vali isn’t waiting for an answer any more. Send it as a new errand." : e2.message;
    else if (state.backendUrl) err.textContent = e2.status === 401 ? "The Vali server did not accept this browser. Press Connect in settings." : e2.message;
    else err.textContent = e2.status === 401 ? "Exa rejected the API key. Check it in settings." : e2.status === 402 ? "The Exa key is out of credits." : e2.message;
    if (msg && e2.status === 409) replyOff.add(askKey(ask));
    err.hidden = false;
  } finally {
    $("send").disabled = false;
  }
}
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  submitText($("task").value.trim());
});
$("task").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("composer").requestSubmit(); }
});
// One line, growing to ~5 lines as you type.
function fitTask() {
  const ta = $("task");
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
}
$("task").addEventListener("input", fitTask);

// ---------- header: new errand, history ----------
function setHistory(on) {
  $("history").hidden = !on;
  $("thread").hidden = on;
  $("historyBtn").setAttribute("aria-expanded", String(on));
}
$("historyBtn").addEventListener("click", () => { setHistory($("history").hidden); stickBottom = true; render(); });
$("newBtn").addEventListener("click", () => {
  currentTask = "new";
  setHistory(false);
  render();
  $("task").focus();
});
function openConvo(taskId) {
  currentTask = taskId;
  setHistory(false);
  stickBottom = true;
  render();
}

// ---------- bubbles ----------
const shownKeys = new Set(); // bubbles already on screen: only new ones pop in
const openDetails = new Set(); // <details> left open, kept across re-renders
let lastConvoId;
let stickBottom = true;
let animate = false;

function msg(key, cls, pose, ...kids) {
  const bubble = h("div", { class: "bubble" + (animate && !shownKeys.has(key) ? " pop" : "") }, ...kids);
  return h("div", { class: `msg ${cls}`, "data-key": key }, pose ? h("img", { class: "avatar", src: `../mascot/${pose}.svg`, alt: "" }) : null, bubble);
}
const userMsg = (key, text, meta) => msg(key, "user", null, text, meta ? h("span", { class: "meta", text: meta }) : null);
const valiMsg = (key, pose, kids, cls = "") => msg(key, `vali ${cls}`, pose, ...kids);

function details(key, cls, summary, ...kids) {
  const d = h("details", { class: cls, open: openDetails.has(key) }, summary, ...kids);
  d.addEventListener("toggle", () => (d.open ? openDetails.add(key) : openDetails.delete(key)));
  return d;
}

const typing = () => h("span", { class: "typing", "aria-hidden": "true" }, h("i"), h("i"), h("i"));

function elapsed(t) {
  const s = Math.round(((t.completedAt || Date.now()) - t.createdAt) / 1000);
  if (!(s >= 1)) return null;
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

function activityText(l) {
  if (l.kind === "search") return `Searching “${l.text}”`;
  if (l.kind === "read" || l.kind === "source") return `Reading ${l.text}`;
  return l.text;
}

// Research still running: the newest step, live Exa counts, Stop.
function workingBubble(t) {
  const lines = (t.research?.activity?.length ? t.research.activity : t.progress || []).filter((l) => l?.text);
  const last = lines.at(-1);
  const searches = lines.filter((l) => l.kind === "search").length;
  const pages = lines.filter((l) => l.kind === "read" || l.kind === "source").length;
  const step = last ? activityText(last) : t.status === "queued" ? "Starting…" : "Searching the web…";
  const counts = searches || pages ? `${searches} ${searches === 1 ? "search" : "searches"} · ${pages} ${pages === 1 ? "page" : "pages"}` : "";
  return valiMsg(`work:${t.id}`, "searching", [
    h("div", { class: "step-line", role: "status" }, typing(), h("span", { text: step, title: step }), counts ? h("span", { class: "n", text: counts }) : null),
    h("div", { class: "working-foot" }, h("span", { text: "Runs in the background. You can close this panel." }),
      serverButton("Stop", "link-btn", { type: "cancel", taskId: t.id }, null, t)),
  ], "wide");
}

function factList(facts, map, offset) {
  const dl = h("dl", { class: "facts" });
  facts.forEach((f, i) => dl.append(h("dt", { text: f.label }), h("dd", {}, fillPlaceholders(String(f.value ?? ""), state.profile), cites(map, `key_facts[${i + offset}]`))));
  return dl;
}

function sourceList(sources, offset = 0) {
  return h("ol", { class: "sources" }, ...sources.map((src, i) => h("li", {},
    h("a", { href: src.url, target: "_blank", rel: "noopener", title: src.title || src.url },
      h("span", { class: "num", text: String(i + 1 + offset) }), h("span", { class: "host", text: src.host }), h("span", { class: "t", text: src.title && src.title !== src.host ? src.title : "" })))));
}

// The answer: short text, up to 3 facts, the next steps as buttons, numbered sources, the Exa line; the rest under More.
function answerBubble(t) {
  const out = t.output || {};
  const s = out.structured;
  const map = numberSources(out.grounding);
  const kids = [];
  const more = [];
  if (!s) {
    const sa = shortAnswer(out.text || "No answer came back.", 3);
    kids.push(h("p", { class: "answer-text", text: sa.text }));
    if (sa.more) more.push(h("p", { class: "full", text: out.text }));
  } else {
    const full = fillPlaceholders(s.answer || "", state.profile);
    const sa = shortAnswer(full, 2);
    kids.push(h("p", { class: "answer-text" }, sa.text, cites(map, "answer")));
    if (sa.more) more.push(h("p", { class: "full", text: full }));
    const facts = s.key_facts || [];
    if (facts.length) kids.push(factList(facts.slice(0, 3), map, 0));
    if (facts.length > 3) more.push(h("h4", { text: "More facts" }), factList(facts.slice(3), map, 3));
    if (s.form_fill?.length) kids.push(renderFormFill(t, s.form_fill));
    (s.actions || []).forEach((a, i) => kids.push(renderAction(t, a, i, map)));
    if (s.steps?.length) {
      more.push(h("h4", { text: "Steps" }), h("ol", { class: "steps" }, ...s.steps.map((st, i) =>
        h("li", { class: st.done_by_hoida ? "done" : "" },
          h("div", {}, h("strong", { text: st.title }), st.done_by_hoida ? h("span", { class: "v-badge v-badge--success", text: "prepared" }) : null, cites(map, `steps[${i}]`)),
          h("div", { class: "detail" }, st.detail || "", st.url ? h("span", {}, " ", h("a", { href: st.url, target: "_blank", rel: "noopener", text: "Open" })) : null)))));
    }
  }
  if (map.sources.length) kids.push(sourceList(map.sources.slice(0, 5)));
  if (map.sources.length > 5) more.push(h("h4", { text: "More sources" }), sourceList(map.sources.slice(5), 5));
  const exa = renderExaActivity(t);
  if (exa) kids.push(exa);
  more.push(h("div", { class: "foot" }, h("span", { text: [elapsed(t), t.page?.title, t.cost != null ? money(t.cost) : null].filter(Boolean).join(" · ") }),
    serverButton("Remove", "link-btn", { type: "remove", taskId: t.id })));
  kids.push(details(`more:${t.id}`, "more", h("summary", { text: "More" }), ...more));
  return valiMsg(`ans:${t.id}`, taskMascot(t) === "needs_approval" ? "needs_approval" : "success", kids, "wide");
}

function renderAction(t, a, i, map) {
  const key = t.id + ":" + i;
  const r = resolveAction(a, state.profile);
  const sub = [];
  if (a.type === "email" && r.action.to) sub.push("To " + r.action.to);
  if (a.subject) sub.push(r.action.subject);
  if (a.type === "calendar" && a.start) sub.push(a.start + (a.location ? " · " + a.location : ""));
  if (a.type === "open_link" && a.url) sub.push(hostOf(a.url) || a.url);
  if (a.type === "phone_call" && a.to) sub.push(a.to);
  const box = h("div", { class: "act" }, h("div", { class: "title" }, a.label || a.type, cites(map, `actions[${i}]`)), sub.length ? h("div", { class: "sub", text: sub.join(" · ") }) : null);
  const btns = h("div", { class: "btns" });
  box.append(btns);
  if (r.kind === "email" || r.kind === "copy" || (a.type === "phone_call" && a.body)) {
    const ta = h("textarea", { class: "v-textarea edit", "aria-label": "Draft" });
    ta.value = drafts.get(key) ?? (r.text || "");
    ta.addEventListener("input", () => drafts.set(key, ta.value));
    const current = () => ({ ...r.action, body: ta.value });
    if (r.kind === "email") {
      btns.append(
        h("button", { class: "v-btn v-btn--sm", type: "button", text: "Open in Gmail", onclick: () => chrome.tabs.create({ url: resolveAction(current(), state.profile).gmail }) }),
        h("button", { class: "v-btn v-btn--quiet v-btn--sm", type: "button", text: "Mail app", onclick: () => chrome.tabs.create({ url: resolveAction(current(), state.profile).mailto }) })
      );
    }
    btns.append(h("button", { class: "v-btn v-btn--quiet v-btn--sm", type: "button", text: "Copy", onclick: () => navigator.clipboard.writeText(ta.value).then(() => toast("Copied")) }));
    box.append(details(`draft:${key}`, "draft", h("summary", { text: r.kind === "email" ? "Edit the draft" : "See the text" }), ta));
  }
  if (r.kind === "link" && r.url) {
    const label = a.type === "calendar" ? "Add to calendar" : a.type === "phone_call" ? "Call" : "Open site";
    const open = h("button", { class: "v-btn v-btn--quiet v-btn--sm", type: "button", text: label, title: r.url, onclick: () => chrome.tabs.create({ url: r.url }) });
    if (a.type === "open_link") btns.append(doItButton(t, { actionIndex: i }) || "", open, fillHereButton(t));
    else btns.prepend(open);
  }
  if (r.missing.length) box.append(h("div", { class: "warn-note", text: `Still blank: ${r.missing.join(", ").replace(/_/g, " ")}. Type them into the draft before you send it.` }));
  return box;
}

function renderFormFill(t, fills) {
  const labels = Object.fromEntries((t.page?.fields || []).map((f) => [f.id, f.label || f.id]));
  const dl = h("dl", { class: "fill-preview" });
  for (const f of fills.slice(0, 14)) dl.append(h("dt", { text: labels[f.field_id] || f.field_id }), h("dd", { text: fillPlaceholders(f.value, state.profile) }));
  const missing = unfilledPlaceholders(fills.map((f) => f.value).join(" "));
  const n = `${fills.length} field${fills.length === 1 ? "" : "s"}`;
  return h("div", { class: "act" },
    h("div", { class: "title", text: "Fill the form on this page" }), h("div", { class: "sub", text: t.page?.title || t.page?.url || "" }),
    h("div", { class: "btns" },
      /^https?:/.test(t.page?.url || "") ? doItButton(t, { startUrl: t.page.url, goal: "Fill in the form on this page" }, "Fill it for me") : null,
      h("button", {
        class: "v-btn v-btn--quiet v-btn--sm", type: "button", text: `Fill ${n} here`,
        onclick: async () => {
          try {
            const res = await send({ type: "fill", taskId: t.id });
            toast(res.error ? res.error : `Filled ${res.filled} field${res.filled === 1 ? "" : "s"}. Check them and press submit yourself.`);
          } catch (e) { toast(e.message); }
        },
      })),
    details(`fill:${t.id}`, "draft", h("summary", { text: `See the ${n}` }), dl),
    missing.length ? h("div", { class: "warn-note", text: `Still blank: ${missing.join(", ").replace(/_/g, " ")}. Vali asks for them when it fills the form.` }) : null);
}

// A question from Vali. pending: the one the composer answers now (with quick replies, if the server sent any).
function askBubble(key, text, { pending = false, options = [], questions = null } = {}) {
  const kids = [questions && questions.length > 1
    ? h("ul", { class: "ask-list" }, ...questions.map((q) => h("li", { class: "ask-text", text: fillPlaceholders(q, state.profile) })))
    : h("p", { class: "ask-text", text: fillPlaceholders(text, state.profile) })];
  if (pending && options.length) kids.push(h("div", { class: "quick" }, ...options.map((o) => h("button", { class: "v-btn v-btn--quiet v-btn--sm", type: "button", text: o, onclick: () => submitText(o) }))));
  if (pending) kids.push(h("p", { class: "hint-line", text: "Answer below." }));
  return valiMsg(key, "needs_approval", kids, pending ? "ask" : "ask past");
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

function inlineButton(t, text, cls, action, name = text) {
  const key = `${t.id}:${name}`;
  const b = h("button", { class: cls, type: "button", text, "aria-label": `${text}: ${titleOf(t)}`, "data-inline-action": key });
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
      stickBottom = true;
      render();
    }
  });
  return b;
}

function serverButton(text, cls, message, done, task = null, name = text) {
  if (task) return inlineButton(task, text, cls, async () => {
    await send(message);
    if (done) toast(done);
  }, name);
  const b = h("button", { class: cls, type: "button", text });
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await send(message);
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

const APPROVED = "Approved. I’m sending it now.";
const EXEC_POSE = { live: "working", approval: "needs_approval", blocked: "error", failed: "error", done: "success", stopped: "idle" };

// The run's state as one Vali bubble: live picture and step, the approval, where it stopped, or how it ended.
function execBubble(t, v) {
  const kids = [];
  const stop = v.live ? serverButton("Stop", "v-btn v-btn--quiet v-btn--sm", { type: "stop", taskId: t.id }, null, t) : null;
  if (v.live) {
    const [status, tone] = errandStatus(t);
    kids.push(h("div", { class: "v-live" + (v.phase === "approval" ? " v-live--waiting" : ""), "data-empty": frames.has(t.id) ? null : "Waiting for the first picture…" },
      liveImg(t), h("span", { class: `v-badge v-badge--dot ${tone ? "v-badge--" + tone : "v-badge--live"}`, text: status })));
  }
  if (v.phase === "live") {
    const step = v.step || (v.status === "starting" ? "Opening the browser…" : "Working…");
    kids.push(h("div", { class: "step-line", role: "status" }, typing(), h("span", { text: step, title: step }), v.stepCount ? h("span", { class: "n", text: `step ${v.stepCount}` }) : null),
      h("div", { class: "btns row end" }, stop));
  } else if (v.phase === "approval") {
    kids.push(h("p", { class: "exec-summary", text: v.summary || "Everything is filled in. Shall I send it?" }));
    if (v.approval.length) kids.push(filledList(v.approval));
    kids.push(h("div", { class: "btns row end" }, stop, handoffButton(t),
      serverButton("Approve and send", "v-btn v-btn--sm", { type: "approve", taskId: t.id }, APPROVED, t, "Approve")));
  } else if (v.phase === "blocked" || v.phase === "failed") {
    kids.push(h("p", { class: "exec-result", text: v.blocker?.reason || v.result || v.error || "I couldn’t finish this errand." }));
    const url = v.blocker?.url || v.url;
    const handoff = handoffButton(t, "v-btn v-btn--sm");
    if (handoff) kids.push(h("div", { class: "btns" }, handoff));
    else if (url) kids.push(h("div", { class: "btns" }, h("button", { class: "v-btn v-btn--sm", type: "button", text: "Finish in your tab", title: url, onclick: () => chrome.tabs.create({ url }) }), fillHereButton(t)));
    if (v.filled.length) {
      kids.push(h("h4", { text: "Filled so far" }), filledList(v.filled, { copy: true }),
        h("div", { class: "btns" }, h("button", { class: "v-btn v-btn--quiet v-btn--sm", type: "button", text: "Copy all", onclick: () => navigator.clipboard.writeText(v.filled.map((r) => `${r.label}: ${r.value}`).join("\n")).then(() => toast("Copied")) })));
    }
    if (v.lastShot != null) kids.push(stillShot(t, v.lastShot));
  } else if (v.phase === "done") {
    kids.push(h("p", { class: "exec-result", text: v.result || "Submitted." }));
    if (v.lastShot != null) kids.push(stillShot(t, v.lastShot));
  } else if (v.phase === "stopped") {
    kids.push(h("p", { class: "muted exec-result", text: v.error ? `Stopped: ${v.error}` : "Stopped. Nothing was sent." }));
    const handoff = handoffButton(t, "v-btn v-btn--sm");
    if (handoff) kids.push(h("div", { class: "btns" }, handoff));
  }
  const exa = v.live ? renderExaActivity(t, { busy: true }) : null;
  if (exa) kids.push(exa);
  return valiMsg(`x:${t.id}:${v.phase}`, EXEC_POSE[v.phase] || "working", kids, "wide" + (v.phase === "done" ? " done-run" : ""));
}

// "Continue in my browser": the cloud browser's page with its cart and session, opened here. Once, for 15 minutes.
function handoffButton(t, cls = "v-btn v-btn--quiet v-btn--sm") {
  if (!t.backend || !t.execution?.handoff_available) return null;
  const b = serverButton("Continue in my browser", cls, { type: "handoff", taskId: t.id },
    "Opened in a new tab with your cart. Pay there yourself; Vali stopped.", t, "Continue");
  b.title = "Open this page in your Chrome with the same cart, then pay yourself. Vali stops here.";
  return b;
}

// "Fill it here": the form on the tab you are on (behind your own login, say), filled on this device. You send it.
function fillHereButton(t) {
  return h("button", {
    class: "v-btn v-btn--quiet v-btn--sm", type: "button", text: "Fill it here",
    title: "Fill the form on the tab you’re on with your details. Vali never sends it.",
    onclick: async () => {
      try {
        const res = await send({ type: "fillHere", taskId: t.id, tabId: activeTab?.id, url: activeTab?.url });
        toast(res.error || `Filled ${res.filled} field${res.filled === 1 ? "" : "s"}. Check them and press submit yourself.`);
      } catch (e) { toast(e.message); }
    },
  });
}

// "Book it" / "Fill it for me": start the cloud browser on a prepared link or on the page the errand came from.
// It starts even when no details are saved: the browser then asks for them in this chat (execution.question).
function doItButton(t, opts, label) {
  const x = t.execution?.status;
  if (!t.backend || t.status !== "completed" || (x && (LIVE.has(x) || x === "done"))) return null;
  const text = x ? "Let Vali try again" : label || (t.mode === "book" ? "Book it" : t.mode === "claim" || t.mode === "write" ? "Fill it for me" : "Let Vali do it");
  return serverButton(text, "v-btn v-btn--sm", { type: "execute", taskId: t.id, ...opts }, "Vali is opening the page in a cloud browser.", t, "do-it");
}

// One Exa call from the browser run: what was asked, then links to the pages it returned.
function renderLookup(e) {
  const label = e.kind === "search" ? "Searched: " : "Read: ";
  const what = e.url ? h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer", text: e.text }) : e.text;
  const found = e.kind === "search" ? e.results.slice(0, 3).map((r) =>
    h("a", { class: "exa-host", href: r.url, target: "_blank", rel: "noopener noreferrer", title: r.title }, h("span", { class: "host", text: r.host }))) : [];
  return h("li", {}, label, what, e.failed ? " (no answer)" : null, found.length ? h("div", { class: "exa-hosts" }, ...found) : null);
}

// The Exa line ("Agent research 2 searches, 10 pages · Contents 2 of 2 quoted"); it opens to show how Vali found it.
function renderExaActivity(t, { busy = false } = {}) {
  const view = exaActivity(t);
  if (busy && !view.filling.length) return null; // while the browser runs, show only live form lookups
  const uses = exaUses(t).map((u) => `${u.label} ${u.detail}`).join(" · ");
  if (!uses && !view.sources.length && !view.queries.length && !view.filling.length) return null;
  const hosts = new Map();
  for (const s of view.sources) if (!hosts.has(s.host)) hosts.set(s.host, s);
  return details(`exa:${t.id}`, "exa-activity",
    h("summary", { title: "How Vali found this" }, h("span", { class: "exa-tag", text: "EXA" }), h("span", { class: "exa-summary", text: uses || view.summary })),
    h("p", { class: "small", text: view.method }),
    uses ? h("p", { class: "muted small", text: view.summary }) : null,
    view.note ? h("p", { class: "muted small", text: view.note }) : null,
    view.queries.length ? [h("h4", { text: "Searched for" }), h("ul", { class: "exa-queries" }, ...view.queries.map((q) => h("li", { text: q })))] : null,
    view.filling.length ? [h("h4", { text: "While filling the form" }), h("ul", { class: "exa-queries exa-filling" }, ...view.filling.map(renderLookup))] : null,
    hosts.size ? [h("h4", { text: "Read" }), h("div", { class: "exa-hosts" }, ...[...hosts.values()].map((s) =>
      h("a", { class: "exa-host", href: s.url, target: "_blank", rel: "noopener noreferrer", title: s.title }, h("span", { class: "host", text: s.host }))))] : null);
}

// The Exa capabilities, for settings (shared/exa-uses.js).
function exaUsesList(rows) {
  return h("dl", { class: "exa-uses" }, ...rows.map(([label, detail]) => h("div", {}, h("dt", { text: label }), h("dd", { text: detail }))));
}

// ---------- the thread ----------
function dayLabel(ms) {
  const d = new Date(ms || Date.now());
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return new Date().toDateString() === d.toDateString() ? `Today ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function userMeta(t) {
  if (t.parentId) return null;
  const from = t.source === "whatsapp" ? "From WhatsApp" : t.source === "mac" || t.source === "desktop" ? "From the Mac" : null;
  return [from, t.page?.title ? "On: " + t.page.title : null].filter(Boolean).join(" · ") || null;
}

function buildThread(convo) {
  if (!convo) return [valiMsg("hello", "idle", [h("p", { text: "Hi, I’m Vali, your valet in Finland. Tell me what you need: documents, money, transport, bookings." })])];
  const nodes = [h("div", { class: "day", text: dayLabel(convo.tasks[0].createdAt) })];
  const ask = pendingAsk(convo, { answered });
  for (const t of convo.tasks) {
    nodes.push(userMsg(`u:${t.id}`, userText(t), userMeta(t)));
    const rq = t.backend ? t.research?.question : null;
    if (rq?.text && rq.answer != null) nodes.push(askBubble(`rq:${t.id}`, rq.text), userMsg(`ra:${t.id}`, String(rq.answer)));
    if (t.status === "queued" || t.status === "running") nodes.push(workingBubble(t));
    else if (t.status === "completed") nodes.push(answerBubble(t));
    else if (t.status === "failed") {
      nodes.push(valiMsg(`fail:${t.id}`, "error", [
        h("p", { class: "exec-result", text: "I couldn’t finish this errand." }),
        t.error ? h("p", { class: "muted small", text: fillPlaceholders(t.error, state.profile) }) : null,
        h("div", { class: "btns" }, h("button", { class: "v-btn v-btn--sm", type: "button", text: "Try again", onclick: async () => {
          try { currentTask = (await send({ type: "start", task: t.task, tabId: t.tabId, usePage: !!t.page })).id; stickBottom = true; render(); } catch (e) { toast(e.message); }
        } }), serverButton("Remove", "v-btn v-btn--quiet v-btn--sm", { type: "remove", taskId: t.id }))]));
    } else nodes.push(valiMsg(`stop:${t.id}`, "idle", [h("p", { class: "muted", text: "Stopped. Nothing was sent." }),
      h("div", { class: "btns" }, serverButton("Remove", "link-btn", { type: "remove", taskId: t.id }))]));
    // Vali's open research question (asked before or with the answer), or what the answer says is still missing.
    if (rq?.text && rq.answer == null && t.status !== "failed" && t.status !== "cancelled") {
      const pending = ask?.route === "research" && ask.taskId === t.id;
      nodes.push(askBubble(`rq:${t.id}`, rq.text, { pending, options: pending ? ask.options : [] }));
    } else if (!rq?.text && t.status === "completed" && t.output?.structured?.missing_info?.length) {
      const qs = t.output.structured.missing_info;
      nodes.push(askBubble(`mi:${t.id}`, qs.join(" "), { pending: ask?.route === "followup" && ask.taskId === t.id, questions: qs }));
    }
    const v = executionView(t, { profile: state.profile, answered: answered.get(t.id) ?? null });
    if (v) {
      nodes.push(userMsg(`go:${t.id}`, "Go ahead, do it for me."));
      const live = ask?.route === "execution" && ask.taskId === t.id ? ask : null;
      executionTurns(t, asked[t.id] || []).forEach((turn, i) => {
        if (turn.who === "user") nodes.push(userMsg(`in:${t.id}:${turn.at}:${i}`, fillPlaceholders(turn.text, state.profile)));
        else if (!(live && turn.at === String(live.at))) nodes.push(askBubble(`xq:${t.id}:${turn.at}`, turn.text));
      });
      nodes.push(execBubble(t, v));
      if (live) nodes.push(askBubble(`xq:${t.id}:${live.at}`, live.text, { pending: true }));
    }
  }
  return nodes;
}

function renderThread(convo) {
  const main = $("main");
  const id = convo?.id || "none";
  const same = lastConvoId === id;
  const atBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 80;
  const top = main.scrollTop;
  animate = same && lastConvoId !== undefined;
  const nodes = buildThread(convo);
  $("thread").replaceChildren(...nodes);
  const fresh = $("thread").querySelector(".pop")?.closest(".msg");
  if (!same || stickBottom || (atBottom && !fresh)) main.scrollTop = main.scrollHeight;
  else if (fresh && atBottom) {
    // A new bubble: show it from its top when it is taller than the view, else scroll to the end.
    if (fresh.offsetHeight > main.clientHeight - 40) main.scrollTop = fresh.offsetTop - main.offsetTop - 8;
    else main.scrollTop = main.scrollHeight;
  } else main.scrollTop = top;
  stickBottom = false;
  lastConvoId = id;
  for (const n of $("thread").querySelectorAll("[data-key]")) shownKeys.add(n.dataset.key);
}

// History shows the newest few; "Show more" adds the next batch, and "All errands" opens the web dashboard.
const HISTORY_STEP = 8;
let historyShown = HISTORY_STEP;
function renderHistory(convos, cur) {
  const box = $("history");
  if (box.hidden) return;
  const shown = convos.slice(0, historyShown);
  const left = convos.length - shown.length;
  const web = `${state.backendUrl || DEFAULT_BASE_URL}/#/dashboard`;
  box.replaceChildren(h("h2", { text: `History · ${convos.length}` }), convos.length
    ? h("ol", {}, ...shown.map((c) => {
      const [label, tone] = errandStatus(c.last);
      return h("li", {}, h("button", { class: "h-row" + (c.id === cur?.id ? " is-current" : ""), type: "button", "data-id": c.id, onclick: () => openConvo(c.last.id) },
        h("img", { src: `../mascot/${taskMascot(c.last)}.svg`, alt: "" }),
        h("div", { class: "h-main" }, h("div", { class: "h-title", text: c.title, title: c.title }),
          h("div", { class: "h-meta" }, h("b", { "data-tone": tone, text: label }), h("span", { text: "· " + ago(c.at) }),
            c.tasks.length > 1 ? h("span", { text: `· ${c.tasks.length} errands` }) : null))));
    }))
    : h("p", { class: "h-empty", text: "No errands yet. Your conversations with Vali show up here." }),
    convos.length ? h("div", { class: "h-more" },
      left > 0 ? h("button", { class: "v-btn v-btn--quiet", type: "button", text: `Show more (${left})`,
        onclick: () => { historyShown += HISTORY_STEP; render(); } }) : null,
      h("a", { class: "h-all", href: web, target: "_blank", rel: "noopener noreferrer", text: "All errands" })) : null);
}

function renderStats() {
  const s = chatStats(statsData, state.tasks);
  const cells = [[String(s.errands), s.errands === 1 ? "errand" : "errands"], [String(s.searches), "Exa searches"], [String(s.pages), "pages read"], [money(s.cost), "Exa cost"]];
  $("stats").replaceChildren(...cells.map(([n, label]) => h("div", { class: "stat" }, h("b", { text: n }), h("span", { text: label }))));
}

let statsAt = 0;
async function refreshStats(force = false) {
  if (!state.backendUrl) { statsData = null; renderStats(); return; }
  if (!force && Date.now() - statsAt < 10000) return;
  statsAt = Date.now();
  try { statsData = await serverStats(); } catch (_) { /* keep the last numbers; the local count stands in */ }
  renderStats();
}

let saveAskedTimer = 0;
function saveAsked() {
  clearTimeout(saveAskedTimer);
  saveAskedTimer = setTimeout(() => {
    const ids = new Set(state.tasks.map((t) => t.id));
    asked = Object.fromEntries(Object.entries(asked).filter(([id]) => ids.has(id)));
    chrome.storage.local.set({ chatAsked: asked }).catch(() => {});
  }, 300);
}

const seenSent = new Set();
let doneCount = -1;
function render() {
  updateMascot();
  for (const [key, pending] of pendingInline) {
    if (!pending.inFlight && pending.tasks !== state.tasks) pendingInline.delete(key);
  }
  const live = new Set(state.tasks.filter((t) => LIVE.has(t.execution?.status)).map((t) => t.id));
  for (const [id, url] of frames) if (!live.has(id)) { URL.revokeObjectURL(url); frames.delete(id); liveImgs.delete(id); }
  let changed = false;
  for (const t of state.tasks) if (rememberQuestion(asked, t)) changed = true;
  if (changed) saveAsked();
  const done = state.tasks.filter((t) => t.status === "completed").length;
  if (done !== doneCount) { doneCount = done; refreshStats(true); }
  renderStats();
  const convos = conversations(state.tasks);
  const convo = currentConvo(convos);
  renderHistory(convos, convo);
  // Keep unsent drafts and the caret while polling.
  const focused = document.activeElement?.closest?.("#thread") ? document.activeElement : null;
  if (!(focused && (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT"))) renderThread(convo);
  updateComposer(convo);
  if (!$("thread").hidden && document.visibilityState === "visible") {
    for (const t of convo?.tasks || []) {
      if (t.status === "completed" && !t.seen && !seenSent.has(t.id)) { seenSent.add(t.id); send({ type: "seen", taskId: t.id }).catch(() => {}); }
    }
  }
}

// ---------- state ----------
async function load() {
  const s = await chrome.storage.local.get([...Object.keys(DEFAULTS), "chatAsked"]);
  state = Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, s[k] ?? d]));
  asked = s.chatAsked && typeof s.chatAsked === "object" ? s.chatAsked : {};
  const sess = await chrome.storage.session.get(["prefill", "focusTask"]);
  if (sess.prefill && Date.now() - sess.prefill.at < 5 * 60 * 1000) applyPrefill(sess.prefill);
  if (sess.focusTask) focusOn(sess.focusTask);
  if (!state.exaKey && !state.backendUrl) { $("settings").hidden = false; renderSettings(); }
  if (state.backendUrl) send({ type: "poll" }).catch(() => {}); // bring in errands started on WhatsApp
  await refreshActiveTab();
  render();
}

// "Open" on the page mascot, a notification, or an errand started from the page: show that errand's conversation.
function focusOn(taskId) {
  currentTask = String(taskId);
  setHistory(false);
  stickBottom = true;
  chrome.storage.session.remove("focusTask").catch(() => {}); // so the same errand can be focused again
}

function applyPrefill(p) {
  prefill = p;
  if (p.task) {
    // a ready question with this page attached: "Help me fill in this form" from the badge on a form page, or
    // "What does this mean and what should I do?" when "Ask Vali about this" could not send it by itself
    $("task").value = p.task;
    $("usePage").checked = p.usePage !== false;
  } else if (p.link && !p.selection) {
    $("task").value = `Help me with this link: ${p.link}\n`;
  }
  currentTask = "new"; // a new errand from the page, so the text never goes out as an answer to an older question
  setHistory(false);
  fitTask();
  $("task").focus();
  refreshActiveTab();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    let mine = false;
    for (const k of Object.keys(DEFAULTS)) if (changes[k]) { state[k] = changes[k].newValue ?? DEFAULTS[k]; mine = true; }
    if (mine) render();
  }
  if (area === "session" && changes.prefill?.newValue) { applyPrefill(changes.prefill.newValue); render(); }
  if (area === "session" && changes.focusTask?.newValue) { focusOn(changes.focusTask.newValue); render(); }
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
  if (ticks % 4 === 0) refreshStats();
}, 4000);

// The live browser view: a new frame about once a second for each run in the open conversation, and the run's
// steps from the server every 2 s, only while the panel is visible.
let liveTicks = 0;
setInterval(() => {
  if (document.hidden) return;
  const live = state.tasks.filter((t) => t.backend && LIVE.has(t.execution?.status));
  if (!live.length) return;
  const shown = new Set((currentConvo()?.tasks || []).map((t) => t.id));
  for (const t of live) if (shown.has(t.id)) refreshFrame(t);
  if (++liveTicks % 2 === 0) send({ type: "poll" }).catch(() => {});
}, 1000);

load();
