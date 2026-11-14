// Run with: npx -y -p playwright@1.64.1 node test/ext3-panel.mjs <screenshot-directory>
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMockServer } from "../scripts/mock-backend.mjs";

const playwrightPath = process.env.PATH.split(path.delimiter)
  .map((p) => path.resolve(p, "../playwright/index.mjs")).find(existsSync);
if (!playwrightPath) throw new Error("Run through npx -y -p playwright@1.64.1.");
const { chromium } = await import(pathToFileURL(playwrightPath));
const out = process.argv[2];
if (!out) throw new Error("Provide a screenshot directory.");
mkdirSync(out, { recursive: true });

function panelFixture() {
  const extension = mkdtempSync(path.join(out, "extension-"));
  cpSync(path.resolve("extension"), extension, { recursive: true });
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const worker = manifest.background.service_worker;
  manifest.background.service_worker = "test-worker.js";
  writeFileSync(manifestPath, JSON.stringify(manifest));
  // This harness renders the side panel in a tab. Supply its real sender shape only after testing tab rejection.
  writeFileSync(path.join(extension, "test-worker.js"), `import "./test-sender.js"; import ${JSON.stringify("./" + worker)};`);
  writeFileSync(path.join(extension, "test-sender.js"), `
    const addListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
    chrome.runtime.onMessage.addListener = (handler) => addListener((msg, sender, reply) => {
      if (globalThis.usePanelSender && msg?.type === "linkAccount" && sender.id === chrome.runtime.id
          && sender.url === chrome.runtime.getURL("panel/panel.html")) {
        const { tab, ...panelSender } = sender;
        return handler(msg, panelSender, reply);
      }
      return handler(msg, sender, reply);
    });
  `);
  return extension;
}

const server = createMockServer({ researchMs: 0, execMs: 0 });
// Test-only link routes keep the shared mock untouched. Other requests use its real handler.
const [mockHandler] = server.listeners("request");
server.removeAllListeners("request");
let macToken;
let codeToken;
let lifetime = 60;
server.on("request", async (req, res) => {
  const reply = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url === "/v1/link/code") {
    codeToken = req.headers.authorization?.replace("Bearer ", "");
    return reply(codeToken ? 200 : 401, codeToken ? { code: "001234", expires_in: lifetime } : {});
  }
  if (req.url === "/v1/link") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return JSON.parse(raw).code === "654321" ? reply(200, { token: macToken }) : reply(404, { detail: "Link code not found or expired" });
  }
  return mockHandler(req, res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const mac = await (await fetch(base + "/v1/users", { method: "POST" })).json();
macToken = mac.token;
await fetch(base + "/v1/tasks", { method: "POST", headers: { Authorization: `Bearer ${macToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ task: "Find a sauna for the Mac account" }) });
let context;
try {
  const extension = panelFixture();
  context = await chromium.launchPersistentContext(mkdtempSync(path.join(out, "profile-ext3-")), {
    executablePath: process.env.HOME + "/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    headless: true, args: ["--headless=new", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 420, height: 1000 },
  });
  // Chrome can start its own service workers too; wait for the extension's.
  const extWorker = () => context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
  let sw = extWorker();
  while (!sw) { await new Promise((r) => setTimeout(r, 200)); sw = extWorker(); }
  const id = new URL(sw.url()).host;
  await sw.evaluate((url) => chrome.storage.local.set({ backendUrl: url }), base);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/panel/panel.html`);
  await page.click("#settingsBtn");
  await page.waitForFunction(() => document.querySelector("#backendStatus").textContent === "Connected");
  await page.click("#showMacCode");
  await page.waitForFunction(() => /001234/.test(document.querySelector("#macCode").textContent));
  const before = await page.locator("#macCode").textContent();
  await page.waitForTimeout(1100);
  assert.notEqual(await page.locator("#macCode").textContent(), before);
  await page.screenshot({ path: path.join(out, "link-code.png"), fullPage: true });
  lifetime = 1;
  await page.click("#showMacCode");
  await page.waitForFunction(() => /expired/.test(document.querySelector("#macCode").textContent));
  assert.ok(!(await page.locator("#macCode").textContent()).includes("001234"));
  const tokenBefore = (await sw.evaluate(() => chrome.storage.local.get("backendToken"))).backendToken;
  await page.fill("#macCodeInput", "654321");
  await page.click("#linkMac");
  await page.waitForFunction(() => /from the extension panel/.test(document.querySelector("#macLinkStatus").textContent));
  assert.equal((await sw.evaluate(() => chrome.storage.local.get("backendToken"))).backendToken, tokenBefore);
  await sw.evaluate(() => { globalThis.usePanelSender = true; });
  await page.fill("#macCodeInput", "999999");
  await page.click("#linkMac");
  await page.waitForFunction(() => /wrong or expired/.test(document.querySelector("#macLinkStatus").textContent));
  await page.screenshot({ path: path.join(out, "link-error.png"), fullPage: true });
  await page.fill("#macCodeInput", "654321");
  await page.click("#linkMac");
  await page.waitForFunction(() => /^Linked/.test(document.querySelector("#macLinkStatus").textContent));
  assert.notEqual(codeToken, macToken);
  assert.equal((await sw.evaluate(() => chrome.storage.local.get("backendToken"))).backendToken, macToken);
  await page.screenshot({ path: path.join(out, "linked.png"), fullPage: true });
  await page.click("#settingsBtn");
  await page.click("#historyBtn");
  await page.waitForFunction(() => document.querySelector("#history").textContent.includes("Mac account"));
  await page.locator(".h-row").filter({ hasText: "Mac account" }).click();
  assert.ok((await page.locator("#thread .msg.user").first().textContent()).includes("Mac account"));
  assert.equal(await page.locator(".exa-activity").evaluate((e) => e.open), false);
  await page.locator(".exa-activity summary").click();
  assert.ok(await page.locator(".exa-activity a").count() > 0);
  assert.ok(await page.locator(".exa-activity .host").count() > 0);
  await page.click("#talk");
  assert.equal(await page.locator("#talkHint").isVisible(), true);
  await page.screenshot({ path: path.join(out, "exa-and-talk.png"), fullPage: true });
  // The disclosure must survive a background storage refresh.
  await sw.evaluate(async () => {
    const { tasks } = await chrome.storage.local.get("tasks");
    await chrome.storage.local.set({ tasks: tasks.map((t) => ({ ...t, seen: true })) });
  });
  assert.equal(await page.locator(".exa-activity").evaluate((e) => e.open), true);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({ path: path.join(out, "narrow-dark.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log("PASS: panel linking, countdown/expiry, wrong code recovery, account refresh, history to thread, Exa sources/disclosure, Talk fallback, narrow dark layout; no page errors.");
} finally {
  await context?.close();
  server.close();
  server.closeAllConnections();
}
