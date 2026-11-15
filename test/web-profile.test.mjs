import { test } from "node:test";
import assert from "node:assert/strict";

// web/api.js and web/profile.js are browser modules: give them a page, a localStorage and a fetch that records calls.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = { querySelector: () => null };
globalThis.location = { origin: "http://vali.test" };
const requests = [];
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
  const data = url.endsWith("/v1/users") ? { token: "tok" } : { id: "t_1" };
  return { ok: true, status: 200, headers: new Map(), json: async () => data };
};

const { api } = await import("../web/api.js");
const { DEMO_PROFILE, deleteProfile, fillPlaceholders, loadProfile, missingDetails, saveProfile } = await import("../web/profile.js");

const fake = { name: "Test Person", email: "test@example.com", phone: "+358 40 000 0000" };

test("Your details stay out of the errand and go only with Fill it for me", async () => {
  assert.equal(saveProfile(fake), true);
  requests.length = 0;
  await api.createTask("Order a pizza on https://httpbin.org/forms/post with my name and email", null, Object.keys(loadProfile()));
  const create = requests.find((r) => r.url.endsWith("/v1/tasks"));
  assert.ok(create && !("profile" in create.body));
  assert.deepEqual(create.body.known_details, ["name", "email", "phone"]); // names only
  for (const r of requests) {
    for (const value of Object.values(fake)) {
      assert.ok(!JSON.stringify(r.body ?? "").includes(value), "no detail in " + r.url);
      assert.ok(!r.url.includes(encodeURIComponent(value)) && !r.url.includes(value), "no detail in the URL");
    }
  }
  await api.execute("t_1", 0, loadProfile());
  const execute = requests.at(-1);
  assert.match(execute.url, /\/v1\/tasks\/t_1\/execute$/);
  assert.deepEqual(execute.body, { action_index: 0, profile: fake });
  await api.execute("t_1", 0, {});
  assert.deepEqual(requests.at(-1).body, { action_index: 0 });
  await api.createTask("Find a sauna", null, []);
  assert.deepEqual(requests.at(-1).body, { task: "Find a sauna" });
});

test("Delete my details clears this browser's copy", () => {
  saveProfile({ ...fake, language: "English", unknown: "x", city: "  " });
  assert.deepEqual(JSON.parse(store.get("vali.profile")), fake);
  deleteProfile();
  assert.equal(store.has("vali.profile"), false);
  assert.deepEqual(loadProfile(), DEMO_PROFILE);  // back to the demo details
});

test("the plan's placeholders say which details are missing, and approval values fill in locally", () => {
  const task = { task: "Book it", research: { output: { structured: { actions: [{ body: "Hi, I am {{name}}, reach me at {{ email }} or {{booking_reference}}." }] } } } };
  assert.deepEqual(missingDetails(task, {}).map((d) => d.key), ["name", "email"]);
  assert.deepEqual(missingDetails(task, { name: "Test Person" }).map((d) => d.key), ["email"]);
  assert.deepEqual(missingDetails({ task: "Fill it with my name, phone and date of birth" }, { phone: "1" }).map((d) => d.key), ["name", "date_of_birth"]);
  assert.equal(fillPlaceholders("{{name}} / {{phone}}", { name: "Test Person" }), "Test Person / {{phone}}");
});
