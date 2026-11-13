// Functions injected into the user's tab with chrome.scripting.executeScript({ func }).
// Each one must be self-contained: no imports, no references outside its own body.

// Reads what the errand might be about: the page, the selected text, and the form fields (each tagged with an id).
// Page text, selection and title are redacted here, in the tab, before anything leaves the browser. Form field
// values are never read into the text. capturePage("redactor") returns the inline redactor (used by the tests).
export function capturePage(mode) {
  // Verbatim copy of createRedactor() from lib/redact.js, the tested source of truth. Keep the two identical:
  // test/redact.test.mjs compares their source and their output.
  const R = (function createRedactor() {
    const SP = "[ \\t\\u00a0]";
    const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
    // DDMMYY, century sign (+ 1800s; - or U-Y 1900s; A-F 2000s), individual number, check character
    const HETU = /(?<![\p{L}\p{N}])((?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2})[-+A-FU-Y](\d{3})([0-9A-FHJ-NPR-Y])(?![\p{L}\p{N}])/giu;
    const HETU_CHECK = "0123456789ABCDEFHJKLMNPRSTUVWXY";
    const IBAN = /(?<![A-Z0-9])[A-Z]{2}\d{2}(?:[ \u00a0]?[A-Z0-9]{4}){2,7}(?:[ \u00a0]?[A-Z0-9]{1,4})?(?![A-Z0-9])/g;
    const CARD = /(?<![\d-])(?:\d{4}([ \u00a0-]?)\d{4}\1\d{4}\1\d{1,7}|\d{4}[ \u00a0]\d{6}[ \u00a0]\d{4,5})(?![\d-])/g;
    const PHONE_FI_INTL = /(?:\+|(?<!\d)00)[ \u00a0]?358[ \t\u00a0.-]*(?:\(0\)[ \t\u00a0.-]*)?\d{1,3}(?:[ \t\u00a0.-]?\d){4,9}(?!\d)/g;
    const PHONE_FI_MOBILE = /(?<![\d+])\(?0(?:4\d|50)\)?(?:[ \t\u00a0.-]?\d){6,7}(?!\d)/g;
    const PHONE_FI_LAND = /(?:\(0(?:1[3-9]|[235689])\)[ \t\u00a0]?|(?<![\d+])0(?:1[3-9]|[235689])[ \t\u00a0-])\d{3,4}(?:[ \t\u00a0-]?\d{2,4}){1,2}(?!\d)/g;
    const PHONE_INTL = /\+\d{1,3}[ \t\u00a0.-]?\(?\d{1,4}\)?(?:[ \t\u00a0.-]?\d{2,4}){2,4}(?!\d)/g;
    // Finnish street + number (+ house letter, staircase and flat, + postal code and city), e.g. Testikatu 1 A 2, 00100 Helsinki
    const STREET_FI = new RegExp(
      "(?<![\\p{L}\\p{N}])\\p{Lu}[\\p{L}-]*(?:katu|tie|kuja|polku|väylä|kaari|rinne|KATU|TIE|KUJA|POLKU|VÄYLÄ|KAARI|RINNE)" +
        SP + "+\\d{1,4}[a-zA-Z]?(?![\\p{L}\\p{N}]|[.:,]\\d)" +
        "(?:" + SP + "+[A-Za-z]" + SP + "*\\d{1,3}(?!\\d))?" +
        "(?:" + SP + "*(?:as\\.?|asunto|lh\\.?)" + SP + "*\\d{1,3}(?!\\d))?" +
        "(?:" + SP + "*,?" + SP + "*\\d{5}" + SP + "+\\p{Lu}[\\p{L}-]+)?",
      "gu"
    );
    const STREET_EN = /(?<![\p{L}\p{N}])\d{1,5}[A-Za-z]?[ \u00a0]+(?:\p{Lu}\p{Ll}+[ \u00a0]+){1,3}(?:Street|Road|Avenue|Lane|Boulevard|St\.|Rd\.|Ave\.)(?![\p{L}])/gu;
    // 5-digit postal code + city word at the end of a line or before a comma: 00100 Helsinki, 02150 ESPOO
    const POSTAL = /(?<![\p{L}\p{N}])(?<![\p{N}][ \u00a0.,])\d{5}[ \u00a0]+\p{Lu}[\p{L}-]+(?=[ \t\u00a0]*(?:[,;)]|$))/gmu;

    const LABELS = [
      ["name", "full name|first names?|last name|surname|given names?|name|recipient|contact person|customer|passenger|koko nimi|etunimet|etunimi|sukunimi|nimi|vastaanottaja|yhteyshenkilö|asiakas|matkustaja"],
      ["address", "street address|home address|postal address|delivery address|billing address|address|katuosoite|lähiosoite|kotiosoite|postiosoite|toimitusosoite|laskutusosoite|osoite"],
      ["phone", "phone number|telephone|mobile phone|mobile|phone|tel|puhelinnumero|matkapuhelin|puhelin|puh"],
      ["email", "e-mail address|email address|e-mail|email|sähköpostiosoite|sähköposti"],
      ["id-code", "personal identity code|personal id code|social security number|henkilötunnus|hetu"],
      ["birth-date", "date of birth|birth date|syntymäaika"],
    ];
    const LABEL_KIND = LABELS.map(([kind, alts]) => [kind, new RegExp("^(?:" + alts + ")$", "iu")]);
    const ALL_LABELS = LABELS.map(([, alts]) => alts).join("|");
    // "Label: value" on one line
    const LABELLED = new RegExp("(?<![\\p{L}\\p{N}])(" + ALL_LABELS + ")(?![\\p{L}\\p{N}])([ \\t]*:[ \\t]*)([^\\n]*[^\\s])", "giu");
    // a line that is only a label ("Name", "Sähköposti:"), as in tables and definition lists; the value is on the next line
    const LABEL_LINE = new RegExp("^[ \\t]*(" + ALL_LABELS + ")[ \\t]*:?[ \\t]*\\*?[ \\t]*$", "iu");
    const NAME_LINE = /^[ \t]*\p{Lu}[\p{L}'’.-]*(?:[ \t]+\p{Lu}[\p{L}'’.-]*){1,3}[ \t]*$/u;

    function kindOf(label) {
      for (const [kind, re] of LABEL_KIND) if (re.test(label)) return kind;
      return "name";
    }

    function luhn(digits) {
      if (digits.length < 13 || digits.length > 19) return false;
      let sum = 0;
      for (let i = 0; i < digits.length; i++) {
        let n = digits.charCodeAt(digits.length - 1 - i) - 48;
        if (i % 2) {
          n *= 2;
          if (n > 9) n -= 9;
        }
        sum += n;
      }
      return sum % 10 === 0;
    }

    function valueLooksPersonal(kind, value) {
      if (kind === "name" || kind === "email") return true;
      return /\d/.test(value);
    }

    function nextLineLooksPersonal(kind, line) {
      const t = String(line || "").trim();
      if (!t || t.length > 100 || LABEL_LINE.test(t) || /^\[[a-z-]+\]$/.test(t)) return false;
      if (kind === "name") return NAME_LINE.test(t);
      if (kind === "email") return t.includes("@");
      if (kind === "phone") return (t.match(/\d/g) || []).length >= 5;
      return /\d/.test(t);
    }

    function redactLabels(text) {
      const lines = text
        .replace(LABELLED, (m, label, sep, value) => {
          const kind = kindOf(label);
          return valueLooksPersonal(kind, value) ? label + sep + "[" + kind + "]" : m;
        })
        .split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const m = lines[i].match(LABEL_LINE);
        if (!m) continue;
        const kind = kindOf(m[1]);
        if (nextLineLooksPersonal(kind, lines[i + 1])) lines[i + 1] = "[" + kind + "]";
      }
      return lines.join("\n");
    }

    function redactText(s) {
      if (s == null) return "";
      let out = String(s);
      out = out.replace(EMAIL, "[email]");
      out = out.replace(HETU, (m, date, num, check) => (HETU_CHECK[Number(date + num) % 31] === check.toUpperCase() ? "[id-code]" : m));
      // Real IBANs are mostly digits; uppercase product codes are not.
      out = out.replace(IBAN, (m) => ((m.match(/\d/g) || []).length >= 10 ? "[iban]" : m));
      // +358 / 00358 first: with the prefix a Finnish number has 12-14 digits and could look like a card.
      out = out.replace(PHONE_FI_INTL, "[phone]");
      out = out.replace(CARD, (m) => (luhn(m.replace(/\D/g, "")) ? "[card]" : m));
      out = out.replace(PHONE_FI_MOBILE, "[phone]");
      out = out.replace(PHONE_FI_LAND, "[phone]");
      out = out.replace(PHONE_INTL, "[phone]");
      out = out.replace(STREET_FI, "[address]");
      out = out.replace(STREET_EN, "[address]");
      out = out.replace(POSTAL, "[address]");
      return redactLabels(out);
    }

    const SKIP = new Set([
      "input", "textarea", "select", "option", "optgroup", "datalist", "script", "style", "noscript", "template",
      "iframe", "object", "embed", "canvas", "svg", "video", "audio", "map", "head", "meta", "link",
    ]);
    const BLOCK = /^(?:address|article|aside|blockquote|br|button|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|label|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)$/;

    function hiddenEl(el) {
      if (el.hidden) return true;
      const attr = (n) => (el.getAttribute ? el.getAttribute(n) : null);
      if (attr("hidden") != null || attr("aria-hidden") === "true") return true;
      const ce = attr("contenteditable");
      if (el.isContentEditable || (ce != null && ce !== "false")) return true;
      if (typeof getComputedStyle === "function" && typeof Element !== "undefined" && el instanceof Element) {
        try {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return true;
        } catch (_) {
          // detached or foreign element: treat as visible
        }
      }
      return false;
    }

    function visibleText(root, maxChars = 6000) {
      if (!root) return "";
      const parts = [];
      let len = 0;
      const budget = Math.max(200, maxChars * 2);
      (function walk(node) {
        const kids = node.childNodes || [];
        for (let i = 0; i < kids.length && len < budget; i++) {
          const c = kids[i];
          if (c.nodeType === 3) {
            const v = String(c.nodeValue || "").replace(/\s+/g, " ");
            if (v.trim()) {
              parts.push(v);
              len += v.length;
            } else if (v) {
              parts.push(" ");
            }
          } else if (c.nodeType === 1) {
            const tag = c.localName || String(c.tagName || "").toLowerCase();
            if (SKIP.has(tag) || hiddenEl(c)) continue;
            const block = BLOCK.test(tag);
            if (block) parts.push("\n");
            walk(c);
            if (block) parts.push("\n");
          }
        }
      })(root);
      const text = parts.join("").replace(/[ \t]*\n[ \t\n]*/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
      const out = redactText(text);
      return out.length > maxChars ? out.slice(0, maxChars) : out;
    }

    return { redactText, visibleText };
  })();
  if (mode === "redactor") return R;

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
    title: R.redactText(document.title),
    selection: clip(R.redactText(String(getSelection() || "")), 4000),
    text: document.body ? R.visibleText(document.body, 6000) : "",
    fields,
  };
}

// The redaction capturePage() runs inside the tab, for tests that compare it with lib/redact.js.
export function pageRedactor() {
  return capturePage("redactor");
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
