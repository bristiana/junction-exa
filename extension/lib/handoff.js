// "Continue in my browser": the cloud browser's cookies (Playwright's shape) set in this Chrome, so the user lands
// on the same page with the same cart and pays themselves. Cookie values are secrets: never log them.

const SAME_SITE = { Strict: "strict", Lax: "lax", None: "no_restriction" };

// One Playwright cookie as chrome.cookies.set details, or null when it is unusable or already expired.
export function cookieDetails(c, nowSeconds = Date.now() / 1000) {
  const domain = String(c?.domain || "");
  const host = domain.replace(/^\./, "");
  if (!c?.name || !host) return null;
  const expires = Number(c.expires);
  if (Number.isFinite(expires) && expires > 0 && expires <= nowSeconds) return null;
  const path = String(c.path || "/").startsWith("/") ? String(c.path || "/") : "/";
  const secure = !!c.secure;
  const details = {
    url: `${secure ? "https" : "http"}://${host}${path}`,
    name: String(c.name),
    value: String(c.value ?? ""),
    path,
    secure,
    httpOnly: !!c.httpOnly,
    sameSite: SAME_SITE[c.sameSite] || "unspecified",
  };
  // A leading dot is a domain cookie; without one the cookie stays host-only (and __Host- cookies must).
  if (domain.startsWith(".")) details.domain = domain;
  if (Number.isFinite(expires) && expires > 0) details.expirationDate = expires;
  // Chrome refuses SameSite=None without Secure.
  if (details.sameSite === "no_restriction" && !secure) details.sameSite = "unspecified";
  return details;
}

// Sets every cookie, then opens the page. Returns how many cookies were set; never the cookies themselves.
export async function continueInBrowser({ url, cookies } = {}, { setCookie, openTab }) {
  let target;
  try { target = new URL(String(url || "")); } catch (_) { throw new Error("The hand-off has no page to open."); }
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("The hand-off has no page to open.");
  let set = 0;
  for (const c of Array.isArray(cookies) ? cookies : []) {
    const details = cookieDetails(c);
    if (!details) continue;
    try {
      if (await setCookie(details)) set += 1;
    } catch (_) { /* one refused cookie must not block the rest */ }
  }
  await openTab({ url: target.href });
  return { set };
}
