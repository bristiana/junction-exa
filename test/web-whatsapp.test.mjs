import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.document = { querySelector: () => null };
globalThis.location = { origin: "http://vali.test" };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { whatsappUrl } = await import("../web/whatsapp.js");

test("the WhatsApp link carries the pairing code", () => {
  assert.equal(whatsappUrl("358401234567", "123456"), "https://wa.me/358401234567?text=link%20123456");
  assert.equal(whatsappUrl("+358 40 123", "123456"), "https://wa.me/35840123?text=link%20123456");
});

test("no number or no code gives no link", () => {
  assert.equal(whatsappUrl("", "123456"), "");
  assert.equal(whatsappUrl(undefined, "123456"), "");
  assert.equal(whatsappUrl("358401234567", ""), "");
});
