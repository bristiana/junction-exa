// Functions injected into the user's tab with chrome.scripting.executeScript({ func }).
// Each one must be self-contained: no imports, no references outside its own body.

// Reads what the errand might be about: the page, the selected text, and the form fields (each tagged with an id).
export function capturePage() {
  const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const labelOf = (el) => {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.innerText;
    }
    const wrap = el.closest("label");
    if (wrap) return wrap.innerText;
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((i) => document.getElementById(i)?.innerText || "").join(" ");
      if (t.trim()) return t;
    }
    if (el.placeholder) return el.placeholder;
    const fs = el.closest("fieldset")?.querySelector("legend");
    if (fs) return fs.innerText;
    let p = el.previousElementSibling;
    if (p && p.innerText) return p.innerText;
    return el.name || el.id || "";
  };

  const fields = [];
  const seenRadio = new Set();
  let n = 0;
  const els = document.querySelectorAll("input, select, textarea");
  for (const el of els) {
    const type = (el.type || el.localName).toLowerCase();
    if (["hidden", "password", "file", "submit", "button", "reset", "image"].includes(type)) continue;
    if (el.disabled || el.readOnly || !visible(el)) continue;
    if (type === "radio") {
      const key = el.name || el.id;
      if (seenRadio.has(key)) continue;
      seenRadio.add(key);
      const group = el.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)] : [el];
      const id = "h" + ++n;
      group.forEach((r) => r.setAttribute("data-hoida-id", id));
      const legend = el.closest("fieldset")?.querySelector("legend")?.innerText;
      fields.push({ id, type: "radio", label: clip(legend || el.name, 120), options: group.map((r) => clip(labelOf(r) || r.value, 60)), required: el.required });
      continue;
    }
    const id = "h" + ++n;
    el.setAttribute("data-hoida-id", id);
    const f = { id, type, label: clip(labelOf(el), 120), required: !!el.required };
    if (el.localName === "select") f.options = [...el.options].map((o) => clip(o.text, 60)).filter(Boolean);
    if (el.value && type !== "checkbox") f.current = clip(el.value, 60);
    fields.push(f);
    if (fields.length >= 60) break;
  }

  return {
    url: location.href,
    title: document.title,
    selection: clip(String(getSelection() || ""), 4000),
    text: clip(document.body?.innerText, 6000),
    fields,
  };
}

// Fills the tagged fields with the approved values. It never submits the form.
export function fillPage(values) {
  const setNative = (el, v) => {
    const proto = el.localName === "textarea" ? HTMLTextAreaElement.prototype : el.localName === "select" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, v) : (el.value = v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const mark = (el) => {
    el.style.outline = "2px solid #6d5dfc";
    el.style.outlineOffset = "2px";
    el.style.backgroundColor = "rgba(109, 93, 252, 0.08)";
    el.setAttribute("data-hoida-filled", "1");
  };

  let filled = 0;
  const skipped = [];
  for (const { field_id, value } of values || []) {
    const els = [...document.querySelectorAll(`[data-hoida-id="${CSS.escape(field_id)}"]`)];
    const el = els[0];
    if (!el || value == null) { skipped.push(field_id); continue; }
    const v = String(value);
    const type = (el.type || el.localName).toLowerCase();
    if (type === "radio") {
      const target = els.find((r) => norm(r.value) === norm(v) || norm(r.closest("label")?.innerText || document.querySelector(`label[for="${CSS.escape(r.id || "")}"]`)?.innerText).includes(norm(v)));
      if (!target) { skipped.push(field_id); continue; }
      target.click();
      mark(target.closest("label") || target);
    } else if (type === "checkbox") {
      const want = /^(yes|true|1|checked|on|kyll)/i.test(v);
      if (el.checked !== want) el.click();
      mark(el);
    } else if (el.localName === "select") {
      const opt = [...el.options].find((o) => norm(o.value) === norm(v) || norm(o.text) === norm(v)) || [...el.options].find((o) => norm(o.text).includes(norm(v)));
      if (!opt) { skipped.push(field_id); continue; }
      setNative(el, opt.value);
      mark(el);
    } else {
      el.focus();
      setNative(el, v);
      el.blur();
      mark(el);
    }
    filled++;
  }
  const first = document.querySelector("[data-hoida-filled]");
  first?.scrollIntoView({ behavior: "smooth", block: "center" });
  return { filled, skipped };
}
