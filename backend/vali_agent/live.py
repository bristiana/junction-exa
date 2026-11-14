"""Live view (CDP screencast), privacy blur for profile values, minimal cookie consent."""
import base64
import re
import threading
import time

from .privacy import private_values

# Fields holding real profile values are blurred in every frame and screenshot that leaves the sandbox.
_BLUR_STYLE = '[data-vali-private]{filter:blur(7px)!important}'
_MARK = r'''(values) => {
  const hit = s => values.some(v => String(s || '').toLowerCase().includes(v));
  if (!document.getElementById('vali-private-style')) {
    const st = document.createElement('style'); st.id = 'vali-private-style'; st.textContent = STYLE;
    (document.head || document.documentElement).appendChild(st);
  }
  const walk = root => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot);
      if (('value' in el && hit(el.value)) || [...el.childNodes].some(n => n.nodeType === 3 && hit(n.textContent)))
        el.setAttribute('data-vali-private', '1');
    }
  };
  walk(document);
}'''.replace('STYLE', repr(_BLUR_STYLE))


def mark_private(page, profile):
    """Blur elements that show a real profile value, in every frame. Best effort, never raises."""
    values = [v.lower() for v in private_values(profile).values() if len(v) >= 3]
    if not values:
        return
    for frame in page.frames:
        try:
            frame.evaluate(_MARK, values)
        except Exception:
            pass


class Screencast:
    """Streams JPEG frames from Chromium to `on_frame`, at most `fps` per second.

    Frames arrive while Playwright processes events (during any page call); writes happen on a
    background thread so a slow store never blocks the browser.
    """

    def __init__(self, page, on_frame, fps=2.0, quality=50, max_width=1024):
        self.on_frame, self.interval = on_frame, 1.0 / fps
        self._latest, self._last_sent, self._lock = None, 0.0, threading.Lock()
        self._wake, self._closed = threading.Event(), False
        self._writer = threading.Thread(target=self._write_loop, daemon=True)
        self._writer.start()
        self.page = page
        self.cdp = page.context.new_cdp_session(page)
        self.cdp.on('Page.screencastFrame', self._frame)
        self.cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': quality, 'maxWidth': max_width,
                                               'maxHeight': 800, 'everyNthFrame': 1})

    def _frame(self, event):
        try:
            self.cdp.send('Page.screencastFrameAck', {'sessionId': event['sessionId']})
        except Exception:
            pass
        now = time.monotonic()
        if now - self._last_sent < self.interval:
            return
        self._last_sent = now
        with self._lock:
            self._latest = base64.b64decode(event['data'])
        self._wake.set()

    def push(self, jpeg):
        """Send a frame taken some other way (e.g. after an action) through the same writer."""
        with self._lock:
            self._latest = jpeg
        self._wake.set()

    def _write_loop(self):
        while not self._closed:
            self._wake.wait(1.0)
            self._wake.clear()
            with self._lock:
                jpeg, self._latest = self._latest, None
            if jpeg:
                try:
                    self.on_frame(jpeg)
                except Exception:
                    pass

    def close(self):
        try:
            self.cdp.send('Page.stopScreencast')
        except Exception:
            pass
        self._closed = True
        self._wake.set()
        self._writer.join(timeout=3)


# Minimal-consent buttons (en, fi, sv, de). Never "accept all".
_MINIMAL = re.compile(
    r'reject( all)?|decline( all)?|deny( all)?|refuse( all)?|only (strictly )?(necessary|essential|required)|'
    r'(necessary|essential|required)( cookies)? only|continue without accepting|hylkää( kaikki)?|kiellä( kaikki)?|'
    r'vain (välttämättömät|pakolliset|tarpeelliset)|välttämättömät evästeet|avvisa( alla)?|endast nödvändiga|alle ablehnen|nur notwendige', re.I)
_ACCEPT_ALL = re.compile(r'accept all|allow all|hyväksy kaikki|salli kaikki|godkänn alla|acceptera alla|alle akzeptieren', re.I)
_BANNER = re.compile(r'cookie|eväst|kaka|kakor|consent|gdpr|privacy|tietosuoja', re.I)


_CANDIDATES = r'''() => {
  const out = [];
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const walk = root => {
    for (const el of root.querySelectorAll('button,[role=button],a,input[type=button],input[type=submit]')) {
      const label = (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
      if (!label || label.length > 60 || !visible(el)) continue;
      let box = el, around = '';
      for (let i = 0; i < 6 && box; i++, box = box.parentElement) around = box.innerText || around;
      el.setAttribute('data-vali-consent', String(out.length));
      out.push({label, around: (around + ' ' + (el.closest('[id],[class]')?.id || '') + ' ' + (el.closest('[class]')?.className || '')).slice(0, 3000)});
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  return out;
}'''


def dismiss_cookie_banner(page):
    """Click the minimal-consent button of a visible cookie banner, in any frame. Returns its label or None."""
    for frame in page.frames:
        try:
            for i, c in enumerate(frame.evaluate(_CANDIDATES)):
                if _MINIMAL.search(c['label']) and not _ACCEPT_ALL.search(c['label']) and _BANNER.search(str(c['around'])):
                    frame.locator(f'[data-vali-consent="{i}"]').first.click(timeout=2000)
                    page.wait_for_timeout(400)
                    return c['label']
        except Exception:
            continue
    return None
