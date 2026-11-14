// Mock Vali API for trying the extension without the real backend: canned answers, in memory, no API keys.
//
//   npm run mock            # http://127.0.0.1:8787 (PORT=9000 npm run mock for another port)
//
// In the extension: settings → Vali server → http://127.0.0.1:8787 → Connect. Each new user starts with one task
// that "came from WhatsApp". To fake the phone side:
//   curl -X POST http://127.0.0.1:8787/mock/whatsapp -H 'Content-Type: application/json' -d '{"text":"link 123456"}'
//   curl -X POST http://127.0.0.1:8787/mock/whatsapp -H 'Content-Type: application/json' -d '{"text":"Find a public sauna in Helsinki"}'
// Endpoints follow docs/ARCHITECTURE.md. Research "runs" for researchMs, a browser run reaches approval after execMs.

import http from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SHOT = new URL("../extension/icons/icon-128.png", import.meta.url);

export function createMockServer({ researchMs = 6000, execMs = 4000, log = false } = {}) {
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
    if (x && x.status === "running" && Date.now() - x._at >= execMs) {
      x.status = "awaiting_approval";
      x.steps.push({ n: 2, at: now(), text: "Filled the form, waiting for your approval", shot: 2 });
      x.shots.push({ n: 2, url: `/v1/tasks/${t.id}/shots/2.jpg` });
      x.approval = { summary: "Form filled (mock), nothing submitted yet", filled: [{ label: "Full name", value: "{{name}}" }, { label: "Email", value: "{{email}}" }] };
      t.updated_at = now();
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
      const { _at, ...ex } = rest.execution;
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

    const shot = path.match(/^\/v1\/tasks\/([^/]+)\/shots\/(\d+)\.jpg$/);
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || (shot ? url.searchParams.get("t") : "");
    const user = token && users.get(token);
    if (path.startsWith("/v1/") && !user) return send(res, 401, { detail: "Missing or unknown token." });

    if (shot) {
      if (!user.tasks.some((t) => t.id === shot[1])) return send(res, 404, { detail: "Not found." });
      return send(res, 200, readFileSync(SHOT), "image/png");
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
    const m = path.match(/^\/v1\/tasks\/([^/]+)(?:\/(cancel|execute|approve|stop))?$/);
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
          t.execution = {
            status: "running",
            goal: body.goal || `Fill in the form for: ${t.task.slice(0, 60)}`,
            start_url: start,
            current_url: start,
            steps: [{ n: 1, at: now(), text: `Opened ${start}`, shot: 1 }],
            shots: [{ n: 1, url: `/v1/tasks/${t.id}/shots/1.jpg` }],
            approval: null,
            result: null,
            error: null,
            _at: Date.now(),
          };
        }
        if (op === "approve") {
          if (t.execution?.status !== "awaiting_approval") return send(res, 409, { detail: "Nothing is waiting for approval." });
          Object.assign(t.execution, { status: "submitting", _at: Date.now() });
        }
        if (op === "stop" && t.execution && !["done", "failed", "stopped"].includes(t.execution.status)) t.execution.status = "stopped";
        t.updated_at = now();
        return send(res, 200, view(t));
      }
    }
    return send(res, 404, { detail: "Not found." });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 8787;
  createMockServer({ log: true }).listen(port, "127.0.0.1", () => console.log(`Mock Vali API on http://127.0.0.1:${port}`));
}
