// Hoida: strip personal data from page text before it leaves the browser.
//
// redactText(s) replaces, with typed markers like [email]:
//   emails; phone numbers (Finnish +358, 04x / 050 mobiles, landlines like 09 123 4567, international +NN);
//   Finnish personal identity codes (henkilötunnus / HETU, check character verified); IBANs; card numbers
//   (13-19 digits, Luhn-checked); "Name: …"-style labelled values in English and Finnish; street addresses
//   (…katu, …tie, …kuja, …polku, …väylä, …kaari, …rinne followed by a number) and postal codes with a city.
// visibleText(root, maxChars) reads the rendered text of a DOM subtree and redacts it. It never reads form field
//   values: input, textarea, select, [contenteditable], script, style and hidden elements are skipped.
//
// This file is the tested source of truth (test/redact.test.mjs). capturePage() in lib/page-scripts.js carries a
// verbatim copy of createRedactor(), because functions injected with chrome.scripting.executeScript cannot import.
// Change both together: the tests fail when the two copies differ.

export const { redactText, visibleText } = createRedactor();

export function createRedactor() {
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
}
