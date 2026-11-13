"""One persistent browser page with snapshot references."""
import re
from playwright.sync_api import sync_playwright, TimeoutError as BrowserTimeout

_CAPTURE = r'''() => {
 const visible = el => { const r=el.getBoundingClientRect(), s=getComputedStyle(el);
   return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; };
 const clip = s => String(s||'').replace(/\s+/g,' ').trim().slice(0,240);
 const label = el => el.labels?.[0]?.innerText || el.getAttribute('aria-label') ||
   (el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.innerText||'').join(' ').trim() ||
   el.innerText || el.placeholder || el.closest('fieldset')?.querySelector('legend')?.innerText || el.name || el.id || '';
 document.querySelectorAll('[data-hoida-ref]').forEach(el=>el.removeAttribute('data-hoida-ref'));
 const elements=[...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')].filter(visible).slice(0,150);
 const lines=elements.map((el,i)=>{
   const ref='e'+(i+1); el.setAttribute('data-hoida-ref',ref);
   let kind=el.localName==='input' ? 'input['+el.type+']' : el.localName;
   let line='['+ref+'] '+kind+' '+JSON.stringify(clip(label(el)));
   if (el.localName==='button') line+=' type='+el.type;
   if ('value' in el) line+=' value='+JSON.stringify(el.value);
   if (el.required) line+=' required';
   if (el.disabled) line+=' disabled';
   if (el.type==='checkbox'||el.type==='radio') line+=' checked='+el.checked;
   if (el.options) line+=' options='+JSON.stringify([...el.options].map(o=>({text:clip(o.text),value:o.value})));
   return line;
 });
 return 'URL: '+location.href+'\nTitle: '+document.title+'\n'+lines.join('\n')+'\nText: '+(document.body?.innerText||'').slice(0,2500);
}'''


class Browser:
    def __init__(self, headless=True):
        self._runtime = sync_playwright().start()
        try:
            self._browser = self._runtime.chromium.launch(headless=headless)
            self._context = self._browser.new_context(viewport={'width':1280,'height':800},
                locale='en-US', timezone_id='Europe/Helsinki',
                user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
            self.page = self._context.new_page()
            self.page.set_default_timeout(5000)
        except Exception:
            self._runtime.stop()
            raise

    def close(self):
        try:
            self._browser.close()
        finally:
            self._runtime.stop()

    @property
    def current_url(self):
        return self.page.url

    def _settle(self):
        try:
            self.page.wait_for_load_state('networkidle', timeout=1200)
        except BrowserTimeout:
            pass
        self.page.wait_for_timeout(100)

    def _element(self, ref):
        if not re.fullmatch(r'e\d+', ref):
            raise ValueError('Invalid element reference; call read_page')
        return self.page.locator(f'[data-hoida-ref="{ref}"]')

    def goto(self, url):
        if not re.match(r'^https?://', url, re.I):
            raise ValueError('Only http and https URLs are supported')
        self.page.goto(url, wait_until='domcontentloaded', timeout=5000)
        self._settle()

    def snapshot(self):
        return self.page.evaluate(_CAPTURE)

    def element_text(self, ref):
        return self._element(ref).evaluate('''el => el.outerHTML + ' ' +
          (el.localName==='button' ? 'button type='+el.type : '') + ' ' +
          (el.innerText||'') + ' ' + (el.getAttribute('aria-label')||'')''')

    def click(self, ref):
        self._element(ref).click()
        self._settle()

    def type(self, ref, text):
        el = self._element(ref)
        if el.evaluate("el => !['input','textarea'].includes(el.localName) || ['submit','button','checkbox','radio','file','password'].includes(el.type)"):
            raise ValueError('Choose a writable text field')
        el.focus()
        el.evaluate('''(el,value) => {
          const proto=el.localName==='textarea'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true})); el.blur();
        }''', text)
        self._settle()

    def select(self, ref, option):
        el = self._element(ref)
        options = el.locator('option').evaluate_all('(els)=>els.map(o=>({value:o.value,text:o.text}))')
        match = next((o for o in options if option.casefold() in (o['value'].casefold(),o['text'].casefold())), None)
        if not match:
            raise ValueError('Option not found')
        el.select_option(value=match['value'])
        self._settle()

    def check(self, ref, checked):
        self._element(ref).set_checked(checked)
        self._settle()

    def press(self, key):
        # Forms can submit implicitly even with focus in a text field.
        if re.search(r'enter|return|space|\s', key, re.I) and self.page.evaluate("() => !!document.activeElement?.closest('form,button,[role=button],a')"):
            raise ValueError('Call request_approval first; use click for final submission')
        self.page.keyboard.press(key)
        self._settle()

    def scroll(self, direction):
        if direction not in ('up','down'):
            raise ValueError('Direction must be up or down')
        self.page.mouse.wheel(0, 600 if direction=='down' else -600)
        self._settle()

    def blockers(self):
        return self.page.evaluate('''() => {
          const visible=el=>!!(el.getBoundingClientRect().width && el.getBoundingClientRect().height) && getComputedStyle(el).visibility!=='hidden';
          const els=[...document.querySelectorAll('input,iframe,[id],[class]')].filter(visible);
          const found=[];
          if(els.some(el=>el.matches('input[type=password]'))) found.push('login');
          if(/captcha|recaptcha|hcaptcha/i.test(document.body?.innerText||'') || els.some(el=>/captcha|recaptcha|hcaptcha/i.test([el.id,el.className,el.getAttribute('src'),el.getAttribute('title'),el.getAttribute('aria-label')].join(' ')))) found.push('captcha');
          if(els.some(el=>el.matches('input') && /cc-number|card.?number|cardnumber/i.test([el.name,el.id,el.autocomplete,el.placeholder].join(' ')) || el.matches('iframe') && /stripe|adyen|braintree|checkout|paypal/i.test(el.src))) found.push('payment');
          return found;
        }''')

    def screenshot_jpeg(self, quality=60, profile=None):
        if not profile:
            return self.page.screenshot(type='jpeg', quality=quality)
        # Cover profile-bearing DOM regions so image tools cannot reveal typed values.
        self.page.evaluate('''values => {
          document.querySelectorAll('[data-hoida-private]').forEach(el=>el.removeAttribute('data-hoida-private'));
          const privateText=s=>values.some(v=>String(s||'').toLowerCase().includes(v.toLowerCase()));
          for(const el of document.querySelectorAll('body *')) {
            if(privateText(el.value) || [...el.childNodes].some(n=>n.nodeType===3 && privateText(n.textContent)) || [...el.attributes].some(a=>privateText(a.value))) el.setAttribute('data-hoida-private','1');
          }
          if(document.querySelector('canvas')) document.body.setAttribute('data-hoida-private','1');
        }''', [str(v) for v in profile.values() if v])
        try:
            return self.page.screenshot(type='jpeg', quality=quality, mask=[self.page.locator('[data-hoida-private]')])
        finally:
            self.page.evaluate("() => document.querySelectorAll('[data-hoida-private]').forEach(el=>el.removeAttribute('data-hoida-private'))")
