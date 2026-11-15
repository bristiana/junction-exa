import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { samePage, PAGE_CHANGED } from "../extension/lib/fill-here.js";
import { fillPage, isPage } from "../extension/lib/page-scripts.js";
import { createClient, backendPage } from "../extension/lib/backend.js";

test("a fill goes only to the page the user chose", () => {
  const form = "https://httpbin.org/forms/post";
  assert.equal(samePage(form, "https://httpbin.org/forms/post?x=1#top"), true);
  for (const other of ["https://httpbin.org/post", "https://evil.example/forms/post", "http://httpbin.org/forms/post", "about:blank", "", undefined]) {
    assert.equal(samePage(other, form), false, String(other));
  }
  assert.equal(samePage("chrome://settings", "chrome://settings"), false);
});

test("fillPage refuses in a document that is not the chosen page, before touching anything", () => {
  const saved = globalThis.location;
  globalThis.location = { origin: "https://httpbin.org", pathname: "/post" }; // the form was submitted or navigated away
  try {
    assert.deepEqual(fillPage([{ field_id: "h1", value: "Aino Virtanen" }], "https://httpbin.org/forms/post"), { filled: 0, skipped: [], error: PAGE_CHANGED });
    assert.equal(fillPage([], undefined).error, PAGE_CHANGED);
    assert.equal(isPage("https://httpbin.org/forms/post"), false);
    assert.equal(isPage("https://httpbin.org/post?x=1"), true);
  } finally {
    globalThis.location = saved;
  }
});

test("fillPage fills controls without submitting, clicking submit buttons or sending Enter", () => {
  const calls = [];
  const forbidden = (action) => () => { throw new Error(`Must never ${action}`); };
  const form = { submit: forbidden("submit"), requestSubmit: forbidden("requestSubmit") };
  class Control {
    constructor(localName, type, value = "") {
      Object.assign(this, { localName, type, value, style: {}, form });
    }
    focus() { calls.push("focus"); }
    blur() { calls.push("blur"); }
    setAttribute() {}
    closest() { return null; }
    dispatchEvent(event) { calls.push(event.type); }
    click() {
      assert.equal(this.type, "radio", "only radio inputs may be clicked");
      this.checked = true;
      calls.push("radio click");
    }
  }
  const text = new Control("input", "text");
  const textarea = new Control("textarea", "textarea");
  const select = new Control("select", "select-one");
  select.options = [{ value: "FI", text: "Finland" }];
  const radio = new Control("input", "radio", "Large");
  const submitInRadioGroup = new Control("input", "submit", "Large");
  const disabledRadio = new Control("input", "radio", "Large");
  disabledRadio.disabled = true;
  const fields = {
    text: [text], textarea: [textarea], select: [select],
    radio: [new Control("input", "radio", "Small"), submitInRadioGroup, disabledRadio, radio],
  };
  // Include stale or forged tags on controls capturePage/planFill normally exclude.
  for (const type of ["submit", "image", "button", "reset", "checkbox", "password", "hidden", "file"]) {
    fields[type] = [new Control("input", type)];
  }
  fields.buttonElement = [new Control("button", "submit")];
  fields.defaultButton = [new Control("button", "")];
  fields.disabled = [Object.assign(new Control("input", "text"), { disabled: true })];
  fields.readOnly = [Object.assign(new Control("input", "text"), { readOnly: true })];
  const values = Object.keys(fields).map((field_id) => ({
    field_id, value: field_id === "radio" ? "Large" : field_id === "select" ? "Finland" : "Demo",
  }));
  const result = runInNewContext(`(${fillPage.toString()})(values, "https://example.org/form")`, {
    values, URL, Event, location: { origin: "https://example.org", pathname: "/form" },
    HTMLInputElement: Control, HTMLTextAreaElement: Control, HTMLSelectElement: Control,
    KeyboardEvent: forbidden("create keyboard events"), CSS: { escape: (s) => s },
    document: {
      forms: [form],
      querySelectorAll: (selector) => fields[selector.match(/data-vali-id="([^"]+)"/)[1]] || [],
      querySelector: () => null,
    },
  });
  assert.equal(result.filled, 4);
  assert.deepEqual(Array.from(result.skipped), Object.keys(fields).slice(4));
  assert.equal(text.value, "Demo");
  assert.equal(textarea.value, "Demo");
  assert.equal(select.value, "FI");
  assert.equal(radio.checked, true);
  assert.equal(submitInRadioGroup.checked, undefined);
  assert.equal(disabledRadio.checked, undefined);
  assert.deepEqual(calls, ["focus", "input", "change", "blur", "focus", "input", "change", "blur", "input", "change", "radio click"]);
});

test("the profile reaches the server only inside the execute body", async () => {
  const bodies = [];
  const client = createClient({ baseUrl: "https://vali.example", token: "t", fetchImpl: async (url, init) => {
    bodies.push({ url, body: init.body || "" });
    return new Response("{}");
  } });
  assert.equal("syncProfile" in client, false);
  const profile = { name: "Aino Virtanen", email: "test@example.com" };
  const page = backendPage({ url: "https://kela.fi/a", title: "Apply", text: "", fields: [{ id: "h1", label: "Email", type: "email", filled: true, hint: "email custemail" }] });
  await client.createTask({ task: "Apply", page });
  await client.companion({ url: "https://kela.fi/a", title: "Apply", headings: [], lang: "en" });
  await client.execute("t1", { start_url: "https://httpbin.org/forms/post", goal: "Fill it", profile });
  const leaks = bodies.filter((b) => /Aino|test@example\.com|custemail|"filled"/.test(b.body));
  assert.deepEqual(leaks.map((b) => new URL(b.url).pathname), ["/v1/tasks/t1/execute"]);
});

test("no script that runs in a page reads field values into what it sends", () => {
  for (const f of ["content/presence.js", "content/explain.js"]) {
    const src = readFileSync(new URL(`../extension/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\.value\b/, f);
  }
  const capture = readFileSync(new URL("../extension/lib/page-scripts.js", import.meta.url), "utf8").split("export function pageRedactor")[0];
  assert.deepEqual(capture.match(/el\.value\b[^;]*/g), ['el.value && type !== "checkbox") f.filled = true']);
});
