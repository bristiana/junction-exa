// Mock Vali API for trying the extension without the real backend: canned answers, in memory, no API keys.
//
//   npm run mock            # http://127.0.0.1:8787 (PORT=9000 npm run mock for another port)
//
// In the extension: settings → Vali server → http://127.0.0.1:8787 → Connect. Each new user starts with one task
// that "came from WhatsApp". To fake the phone side:
//   curl -X POST http://127.0.0.1:8787/mock/whatsapp -H 'Content-Type: application/json' -d '{"text":"link 123456"}'
//   curl -X POST http://127.0.0.1:8787/mock/whatsapp -H 'Content-Type: application/json' -d '{"text":"Find a public sauna in Helsinki"}'
// To see every state in the panel at once (a browser run waiting for approval with sources, one live with a question,
// one stopped at a Suomi.fi login, one done, a failed errand):
//   curl -X POST http://127.0.0.1:8787/mock/demo
// Endpoints follow docs/ARCHITECTURE.md and docs/SANDBOX.md. Research "runs" for researchMs, a browser run reaches
// approval after execMs. With ask (on for npm run mock) the run asks a question halfway and waits for
// POST /v1/tasks/{id}/messages. An errand that mentions Kela, Migri, Vero or a login stops at a login blocker instead.
// live.jpg serves an SVG drawing of the page that changes every second.

import http from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SHOT = new URL("../extension/icons/icon-128.png", import.meta.url);

export function createMockServer({ researchMs = 6000, execMs = 4000, ask = false, log = false } = {}) {
  const users = new Map(); // token -> user
  const pairing = new Map(); // code -> { userId, expires }
  const now = () => new Date().toISOString();
  const newId = (p) => p + "_" + randomBytes(6).toString("hex");

  function canned(task) {
    const fields = task.page?.fields || [];
    const guess = (label) => {
      const l = String(label || "").toLowerCase();
      if (/e-?mail|sähköposti/.test(l)) return "{{email}}";
      if (/phone|puhelin/.test(l)) return "{{phone}}";
      if (/name|nimi/.test(l)) return "{{name}}";
      if (/address|osoite/.test(l)) return "{{address}}";
      if (/postal|postinumero/.test(l)) return "{{postal_code}}";
      if (/city|kaupunki|postitoimipaikka/.test(l)) return "{{city}}";
      return null;
    };
    const form_fill = fields.map((f) => ({ field_id: f.id, value: guess(f.label) })).filter((f) => f.value);
    const structured = {
      answer: `Mock answer for: ${task.task.slice(0, 80)}`,
      status: form_fill.length ? "ready_to_approve" : "info_only",
      key_facts: [
        { label: "Source", value: "Canned mock data" },
        { label: "Deadline", value: "30.11.2026" },
      ],
      steps: [
        { title: "Read the rules", detail: "The mock server did not search the web.", url: "https://www.suomi.fi/", done_by_hoida: true },
        { title: "Send it", detail: "Check the prepared values and submit yourself." },
      ],
      actions: [{ type: "open_link", label: "Open suomi.fi", url: "https://www.suomi.fi/" }],
      missing_info: [],
    };
    if (form_fill.length) structured.form_fill = form_fill;
    return {
      text: structured.answer,
      structured,
      grounding: [
        { field: "answer", citations: [{ url: "https://www.suomi.fi/", title: "Suomi.fi" }], confidence: "high" },
        { field: "steps[0].detail", citations: [{ url: "https://www.kela.fi/", title: "Kela" }], confidence: "medium" },
      ],
    };
  }

  function makeTask(user, text, { source = "extension", page = null, done = false } = {}) {
    const t = {
      id: newId("t"),
      user_id: user.user_id,
      source,
      mode: /find|sauna|café|cafe|restaurant/i.test(text) ? "find" : "claim",
      task: text,
      created_at: now(),
      updated_at: now(),
      page: page ? { url: page.url, title: page.title, fields: page.fields || [] } : null,
      research: { status: "running", kind: "agent", run_id: newId("agent_run"), progress: [], output: null, cost: null, stop_reason: null, error: null },
      execution: null,
      _started: Date.now() - (done ? researchMs + 1 : 0),
    };
    user.tasks.unshift(t);
    return t;
  }

  const SAUNA = "https://www.loylykontti.fi/en/reserve";
  const APPROVAL = {
    summary: "Löylykontti Sörnäinen, Saturday 21.11. 18:00-20:00, 8 people, 208.00 €. Nothing is sent until you approve.",
    filled: [
      { label: "Sauna", value: "Sörnäinen (shared)", source: "https://www.loylykontti.fi/en/locations" },
      { label: "Date and time", value: "la 21.11. 18:00-20:00", source: null },
      { label: "People", value: "8", source: null },
      { label: "Price", value: "208.00 €", source: "https://www.loylykontti.fi/en/prices" },
      { label: "First name", value: "{{first_name}}", source: null },
      { label: "Email", value: "{{email}}", source: null },
      { label: "Phone", value: "{{phone}}", source: null },
    ],
  };
  const STEPS = [
    "Accepted only the necessary cookies",
    "Picked the Sörnäinen location",
    "Moved the calendar to Saturday 21.11.",
    'Clicked "18:00"',
    'Set people to "8"',
    'Filled "First name" with {{first_name}}',
    'Filled "Email" with {{email}}',
    'Filled "Phone" with {{phone}}',
  ];
  const exec = (t, start, over = {}) => ({
    status: "running",
    goal: `Fill in the form for: ${t.task.slice(0, 60)}`,
    start_url: start,
    current_url: start,
    steps: [{ n: 1, at: now(), text: `Opened ${start}`, shot: 1 }],
    shots: [{ n: 1, url: `/v1/tasks/${t.id}/shots/1.jpg` }],
    approval: null,
    approval_decision: null,
    question: null,
    inbox: [],
    result: null,
    error: null,
    _at: Date.now(),
    ...over,
  });
  const addStep = (t, text) => {
    const x = t.execution;
    const n = x.steps.length + 1;
    x.steps.push({ n, at: now(), text, shot: n });
    x.shots.push({ n, url: `/v1/tasks/${t.id}/shots/${n}.jpg` });
  };

  // Canned errands in the states a fresh user never reaches quickly: a browser run on hold (values with sources),
  // a live run asking a question, a run stopped at a Suomi.fi login, a finished run, a failed research run.
  function seedDemo(user) {
    const failed = makeTask(user, "Check whether my HSL season ticket can be refunded");
    Object.assign(failed.research, { status: "failed", error: { message: "The research run failed (mock)." } });

    const done = advance(makeTask(user, "Report the pothole at Mannerheimintie 5 to the city", { done: true }));
    done.execution = exec(done, "https://palautteet.hel.fi/vikailmoitus-lomake", { status: "done", result: "Sent. The city answers by email, reference HEL-2026-4411 (mock)." });
    addStep(done, 'Clicked "Send" once, after your approval');

    const blocked = advance(makeTask(user, "Apply for Kela housing benefit", { done: true }));
    const kela = "https://tunnistus.suomi.fi/idp/profile/SAML2/Redirect/SSO";
    blocked.execution = exec(blocked, "https://www.kela.fi/asumistuki", {
      status: "failed",
      current_url: kela,
      result: `needs login: finish by hand at ${kela}`,
      filled: [{ label: "Name", value: "{{name}}" }, { label: "Address", value: "{{address}}" }, { label: "Monthly rent", value: "820 €" }],
    });
    addStep(blocked, 'Clicked "Apply online"');

    const asking = advance(makeTask(user, "Book a sauna slot for 8 people on Saturday, any time after 17", { done: true }));
    asking.execution = exec(asking, SAUNA, { question: { text: "Free slots on Saturday: 18:00 or 19:30. Which one?", at: now() }, _ask: "asked" });
    for (const s of STEPS.slice(0, 3)) addStep(asking, s);
    asking.execution._i = 3;

    const t = advance(makeTask(user, "Book a public sauna in Helsinki for 8 people this Saturday evening", { done: true }));
    t.execution = exec(t, SAUNA, { status: "awaiting_approval", approval: APPROVAL });
    for (const s of STEPS) addStep(t, s);
    addStep(t, "Waiting for your approval");
    return [t, asking, blocked, done, failed];
  }

  // Advance a task lazily, from the clock, every time it is read.
  function advance(t) {
    const r = t.research;
    if (r.status === "running") {
      const age = Date.now() - t._started;
      const steps = [
        { kind: "search", text: "official rules for this errand" },
        { kind: "source", text: "Suomi.fi", url: "https://www.suomi.fi/" },
        { kind: "source", text: "Kela", url: "https://www.kela.fi/" },
      ];
      r.progress = steps.slice(0, Math.min(steps.length, 1 + Math.floor((age / Math.max(researchMs, 1)) * steps.length)));
      if (age >= researchMs) {
        Object.assign(r, { status: "completed", output: canned(t), cost: 0.04, stop_reason: "schema_satisfied" });
        t.updated_at = now();
      }
    }
    const x = t.execution;
    if (x && x.status === "running") {
      const age = Date.now() - x._at;
      // one step about every second, from the clock
      const want = Math.min(STEPS.length, Math.floor(age / 1000));
      while ((x._i || 0) < want && x._ask !== "asked") addStep(t, STEPS[(x._i = (x._i || 0) + 1) - 1]);
      if (ask && !x._ask && age >= execMs / 2) {
        x._ask = "asked";
        x.question = { text: "Free slots on Saturday: 18:00 or 19:30. Which one?", at: now() };
      }
      if (x._ask === "asked" && (x.inbox || []).length > (x.inbox_read || 0)) {
        const answer = x.inbox.slice(x.inbox_read || 0).map((m) => m.text).join(" / ");
        x.inbox_read = x.inbox.length;
        x.question = null;
        x._ask = "answered";
        x._at = Date.now() - execMs / 2; // the rest of the run takes the other half
        addStep(t, `Got your answer: ${answer.slice(0, 80)}`);
      }
      if (Date.now() - x._at >= execMs && x._ask !== "asked") {
        if (/kela|migri|vero|log ?in/i.test(t.task)) {
          const login = "https://tunnistus.suomi.fi/idp/profile/SAML2/Redirect/SSO";
          addStep(t, 'Clicked "Apply online"');
          Object.assign(x, { status: "failed", current_url: login, result: `needs login: finish by hand at ${login}`,
            filled: [{ label: "Name", value: "{{name}}" }, { label: "Email", value: "{{email}}" }] });
        } else {
          addStep(t, "Waiting for your approval");
          Object.assign(x, { status: "awaiting_approval", approval: APPROVAL });
        }
        t.updated_at = now();
      }
    }
    if (x && x.status === "submitting" && Date.now() - x._at >= 1500) {
      Object.assign(x, { status: "done", result: "Submitted (mock), reference MOCK-12345" });
      t.updated_at = now();
    }
    return t;
  }

  const view = (t) => {
    advance(t);
    const { _started, ...rest } = t;
    if (rest.execution) {
      const { _at, _ask, _i, ...ex } = rest.execution;
      rest.execution = ex;
    }
    return rest;
  };

  function send(res, status, body, type = "application/json") {
    res.writeHead(status, {
      "Content-Type": type,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  }

  async function readJson(req) {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1e6) break;
    }
    try { return raw ? JSON.parse(raw) : {}; } catch (_) { return null; }
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    if (log) console.log(req.method, path); // never the token
    if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
    const body = req.method === "POST" || req.method === "PUT" ? await readJson(req) : {};
    if (body === null) return send(res, 400, { detail: "Body is not JSON." });

    if (req.method === "GET" && path === "/health") {
      return send(res, 200, { ok: true, exa: false, anthropic: false, db: false, cloudinary: false, whatsapp: false, elevenlabs: false, mock: true });
    }
    if (req.method === "POST" && path === "/v1/users") {
      const user = { user_id: newId("u"), token: randomBytes(24).toString("base64url"), tasks: [], whatsapp: null, profile: null };
      users.set(user.token, user);
      makeTask(user, "My flight from Helsinki to Berlin landed 4 hours late. Can I get compensation?", { source: "whatsapp", done: true });
      return send(res, 200, { user_id: user.user_id, token: user.token });
    }
    // Fake the WhatsApp side: "link 123456" links a pairing code, anything else becomes a task from the phone.
    if (req.method === "POST" && path === "/mock/whatsapp") {
      const text = String(body.text || "").trim();
      const m = text.match(/^link\s+(\d{6})$/i);
      if (m) {
        const p = pairing.get(m[1]);
        const user = p && p.expires > Date.now() && [...users.values()].find((u) => u.user_id === p.userId);
        if (!user) return send(res, 404, { detail: "Unknown or expired code." });
        user.whatsapp = { last4: "4567" };
        pairing.delete(m[1]);
        return send(res, 200, { ok: true, linked: user.user_id });
      }
      const user = [...users.values()].find((u) => u.whatsapp);
      if (!user) return send(res, 404, { detail: "No user has linked WhatsApp yet." });
      if (!text) return send(res, 400, { detail: "text is required." });
      return send(res, 200, view(makeTask(user, text, { source: "whatsapp" })));
    }

    if (req.method === "POST" && path === "/mock/demo") {
      if (!users.size) return send(res, 404, { detail: "Connect the extension first." });
      const added = [...users.values()].flatMap((u) => seedDemo(u).map(view));
      return send(res, 200, { ok: true, tasks: added });
    }

    const shot = path.match(/^\/v1\/tasks\/([^/]+)\/shots\/(\d+)\.jpg$/);
    const live = path.match(/^\/v1\/tasks\/([^/]+)\/live\.jpg$/);
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || (shot || live ? url.searchParams.get("t") : "");
    const user = token && users.get(token);
    if (path.startsWith("/v1/") && !user) return send(res, 401, { detail: "Missing or unknown token." });

    if (shot || live) {
      const t = user.tasks.find((x) => x.id === (shot || live)[1]);
      if (!t) return send(res, 404, { detail: "Not found." });
      if (shot && !t.execution) return send(res, 200, readFileSync(SHOT), "image/png");
      if (!t.execution) return send(res, 404, { detail: "No live frame" });
      advance(t);
      return send(res, 200, frameSvg(t, shot ? Number(shot[2]) : null), "image/svg+xml");
    }
    if (req.method === "GET" && path === "/v1/me") {
      return send(res, 200, { user_id: user.user_id, whatsapp_linked: !!user.whatsapp, whatsapp_last4: user.whatsapp?.last4 || null, profile_synced: !!user.profile });
    }
    if (req.method === "PUT" && path === "/v1/profile") {
      const p = body.profile || {};
      user.profile = Object.keys(p).length ? p : null;
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && path === "/v1/pair") {
      const code = String(randomInt(0, 1e6)).padStart(6, "0");
      const expires = Date.now() + 10 * 60 * 1000;
      pairing.set(code, { userId: user.user_id, expires });
      if (log) console.log(`  pairing code issued; link it with: curl -X POST http://127.0.0.1:${req.socket.localPort}/mock/whatsapp -H 'Content-Type: application/json' -d '{"text":"link ${code}"}'`);
      return send(res, 200, { code, expires_at: new Date(expires).toISOString() });
    }
    if (path === "/v1/tasks") {
      if (req.method === "GET") {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 30));
        return send(res, 200, { tasks: user.tasks.slice(0, limit).map(view) });
      }
      if (req.method === "POST") {
        if (!String(body.task || "").trim()) return send(res, 422, { detail: "task is required." });
        return send(res, 200, view(makeTask(user, String(body.task).trim(), { page: body.page || null })));
      }
    }
    const m = path.match(/^\/v1\/tasks\/([^/]+)(?:\/(cancel|execute|approve|stop|messages))?$/);
    if (m) {
      const t = user.tasks.find((x) => x.id === m[1]);
      if (!t) return send(res, 404, { detail: "Task not found." });
      advance(t);
      const op = m[2];
      if (!op && req.method === "GET") return send(res, 200, view(t));
      if (op && req.method === "POST") {
        if (op === "cancel" && t.research.status === "running") t.research.status = "cancelled";
        if (op === "execute") {
          const action = t.research.output?.structured?.actions?.[body.action_index ?? 0];
          const start = body.start_url || action?.url || t.page?.url || "https://www.suomi.fi/";
          if (t.research.status !== "completed") return send(res, 409, { detail: "Research must be completed" });
          if (t.execution && !["done", "failed", "stopped"].includes(t.execution.status)) return send(res, 409, { detail: "Execution already active" });
          t.execution = exec(t, start, body.goal ? { goal: body.goal } : {});
        }
        if (op === "messages") {
          if (!t.execution || !["starting", "running", "awaiting_approval", "submitting"].includes(t.execution.status)) return send(res, 409, { detail: "No running execution" });
          if (!String(body.text || "").trim()) return send(res, 422, { detail: "text is required." });
          t.execution.inbox = [...(t.execution.inbox || []), { at: now(), text: String(body.text).slice(0, 2000), source: "extension" }];
          advance(t);
        }
        if (op === "approve") {
          if (t.execution?.status !== "awaiting_approval") return send(res, 409, { detail: "Nothing is waiting for approval." });
          Object.assign(t.execution, { status: "submitting", _at: Date.now() });
        }
        if (op === "stop" && t.execution && !["done", "failed", "stopped"].includes(t.execution.status)) Object.assign(t.execution, { status: "stopped", approval_decision: "stopped", question: null });
        t.updated_at = now();
        return send(res, 200, view(t));
      }
    }
    return send(res, 404, { detail: "Not found." });
  });
}

// A drawing of the page the cloud browser is on: the form so far, the latest step, and a clock so live refresh shows.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function frameSvg(t, n = null) {
  const x = t.execution;
  const steps = n ? x.steps.slice(0, n) : x.steps;
  const step = steps[steps.length - 1]?.text || "";
  const fields = x.status === "failed" && /needs login/.test(x.result || "")
    ? null
    : (x.approval?.filled || [
        { label: "Sauna", value: steps.length > 2 ? "Sörnäinen (shared)" : "" },
        { label: "Date and time", value: steps.length > 3 ? "la 21.11. 18:00-20:00" : "" },
        { label: "People", value: steps.length > 5 ? "8" : "" },
        { label: "First name", value: steps.length > 6 ? "{{first_name}}" : "" },
        { label: "Email", value: steps.length > 7 ? "{{email}}" : "" },
      ]).slice(0, 6);
  let host = "";
  try { host = new URL(x.current_url || x.start_url).host; } catch (_) {}
  const clock = new Date().toLocaleTimeString("en-GB");
  const body = fields
    ? fields.map((f, i) => `<text x="40" y="${118 + i * 52}" font-size="15" fill="#555">${esc(f.label)}</text>
      <rect x="40" y="${126 + i * 52}" width="560" height="28" rx="5" fill="#fff" stroke="#c9c6e8"/>
      <text x="50" y="${145 + i * 52}" font-size="15" fill="#17171c">${esc(f.value)}</text>`).join("")
      + `<rect x="40" y="${130 + fields.length * 52}" width="200" height="36" rx="8" fill="#5b4cf0"/><text x="58" y="${154 + fields.length * 52}" font-size="15" fill="#fff" font-weight="600">Accept terms and pay</text>`
    : `<text x="40" y="140" font-size="26" font-weight="700" fill="#002f6c">Suomi.fi</text><text x="40" y="180" font-size="16" fill="#333">Choose an identification method</text>
       ${["Bank ID", "Mobile certificate", "Certificate card"].map((m, i) => `<rect x="40" y="${200 + i * 50}" width="300" height="38" rx="6" fill="#fff" stroke="#9db0d0"/><text x="56" y="${225 + i * 50}" font-size="15" fill="#002f6c">${m}</text>`).join("")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="640" viewBox="0 0 640 400" font-family="system-ui, sans-serif">
  <rect width="640" height="400" fill="#f4f3fb"/>
  <rect width="640" height="34" fill="#e4e2f3"/><circle cx="16" cy="17" r="5" fill="#f26b5b"/><circle cx="32" cy="17" r="5" fill="#f5bf4f"/><circle cx="48" cy="17" r="5" fill="#5fc454"/>
  <rect x="70" y="8" width="460" height="18" rx="9" fill="#fff"/><text x="82" y="21" font-size="11" fill="#555">${esc(host)}</text>
  <text x="608" y="22" font-size="11" fill="#777" text-anchor="end">${esc(clock)}</text>
  <text x="40" y="78" font-size="22" font-weight="700" fill="#17171c">${esc(fields ? "Reserve a sauna" : "Kela: log in")}</text>
  ${body}
  <rect x="0" y="372" width="640" height="28" fill="#17171cdd"/><text x="12" y="390" font-size="12" fill="#fff">${esc(step.slice(0, 90))}</text>
</svg>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 8787;
  createMockServer({ log: true, ask: true, execMs: 9000 }).listen(port, "127.0.0.1", () => console.log(`Mock Vali API on http://127.0.0.1:${port}`));
}
