"""One persistent browser page with snapshot references."""
import re
from playwright.sync_api import sync_playwright, expect, TimeoutError as BrowserTimeout

_CAPTURE = r'''({start, limit}) => {
 const visible = el => { const r=el.getBoundingClientRect(), s=getComputedStyle(el);
   return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; };
 const clip = s => String(s||'').replace(/\s+/g,' ').trim().slice(0,240);
 const roots=[document], all=[];
 const walk = root => { for(const el of root.children || []) {
   all.push(el); if(el.shadowRoot) { roots.push(el.shadowRoot); walk(el.shadowRoot); } walk(el);
 }};
 walk(document);
 // A <label> that wraps its control would otherwise include the control's own text (all <select> options).
 const labelText = l => { const c=l.cloneNode(true); c.querySelectorAll('select,textarea,option,input').forEach(n=>n.remove()); return c.textContent.replace(/\s+/g,' ').trim(); };
 const label = el => (el.labels?.[0] && labelText(el.labels[0])) || el.getAttribute('aria-label') ||
   (el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>el.getRootNode().getElementById(id)?.textContent||'').join(' ').trim() ||
   el.innerText || el.placeholder || el.closest('fieldset')?.querySelector('legend')?.innerText || el.name || el.id || '';
 all.forEach(el=>el.removeAttribute('data-hoida-ref'));
 const selector='a,button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="radio"],[role="option"],[role="combobox"],[role="menuitem"],[role="switch"],[contenteditable="true"],[tabindex]';
 const optionCounts=new Map(), optionSeen=new Map(), reportedGroups=new Set();
 const optionGroup=el=>el.closest('[role="listbox"]') || el.parentElement;
 for(const el of all.filter(el=>el.matches('[role="option"]') && visible(el))) {
   const group=optionGroup(el); optionCounts.set(group,(optionCounts.get(group)||0)+1);
 }
 const elements=all.filter(el=>{
   if(!el.matches(selector) || !visible(el)) return false;
   if(!el.matches(selector.replace(',[tabindex]','')) && el.tabIndex<0) return false;
   const r=el.getBoundingClientRect();
   if((r.bottom < -3*innerHeight || r.top > 4*innerHeight) &&
      !el.matches('input,select,textarea,[contenteditable="true"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"]')) return false;
   if(el.matches('[role="option"]')) {
     const group=optionGroup(el);
     const n=(optionSeen.get(group)||0)+1; optionSeen.set(group,n);
     if(n>25) return false;
   }
   return true;
 }).slice(0,limit);
 const lines=elements.map((el,i)=>{
   const ref='e'+(start+i); el.setAttribute('data-hoida-ref',ref);
   let kind=el.localName==='input' ? 'input['+el.type+']' : el.localName;
   if(el.getAttribute('role')) kind+='[role='+el.getAttribute('role')+']';
   let line='['+ref+'] '+kind+' '+JSON.stringify(clip(label(el)));
   if (el.localName==='button') line+=' type='+el.type;
   if ('value' in el) line+=' value='+JSON.stringify(clip(el.value));
   if (el.required) line+=' required';
   if (el.disabled) line+=' disabled';
   if (el.type==='checkbox'||el.type==='radio') line+=' checked='+el.checked;
   for(const attr of ['aria-expanded','aria-selected','aria-checked','aria-disabled'])
     if(el.hasAttribute(attr)) line+=' '+attr+'='+el.getAttribute(attr);
   if (el.options) {
     line+=' options='+JSON.stringify([...el.options].slice(0,25).map(o=>({text:clip(o.text),value:clip(o.value)})));
     if(el.options.length>25) line+=' options_count='+el.options.length;
   }
   if(el.matches('[role="option"]')) {
     const group=optionGroup(el);
     if(optionCounts.get(group)>25 && !reportedGroups.has(group)) {
       line+=' options_count='+optionCounts.get(group); reportedGroups.add(group);
     }
   }
   return line;
 });
 // Options already appear above; do not repeat unbounded lists in the page text.
 const texts=[];
 for(const root of roots) {
   const walker=document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
   while(walker.nextNode()) {
     const node=walker.currentNode, el=node.parentElement;
     if(el && visible(el) && !el.closest('script,style,select,[role="listbox"],[role="option"]'))
       texts.push(node.textContent.trim());
   }
 }
 const text=texts.filter(Boolean).join(' ').slice(0,2500);
 return {lines, text, title:document.title, url:location.href};
}'''


class Browser:
    def __init__(self, headless=True):
        self._refs = {}
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
        if not isinstance(ref, str) or not re.fullmatch(r'e[1-9]\d*', ref):
            raise ValueError('Invalid element reference; call read_page')
        frame = self._refs.get(ref)
        if frame is None or frame.is_detached():
            raise ValueError('Unknown element reference; call read_page')
        return frame.locator(f'[data-hoida-ref="{ref}"]')

    def goto(self, url):
        if not re.match(r'^https?://', url, re.I):
            raise ValueError('Only http and https URLs are supported')
        self._refs = {}
        self.page.goto(url, wait_until='domcontentloaded', timeout=5000)
        self._settle()

    def snapshot(self):
        self._refs = {}
        lines, texts = [], []
        title = ''
        for frame in self.page.frames:
            if frame != self.page.main_frame and not frame.frame_element().is_visible():
                continue
            captured = frame.evaluate(_CAPTURE, {'start':len(self._refs)+1, 'limit':200-len(self._refs)})
            if frame == self.page.main_frame:
                title = captured['title']
            for line in captured['lines']:
                self._refs[line.split(']',1)[0][1:]] = frame
            lines.extend(captured['lines'])
            texts.append(captured['text'])
        return 'URL: '+self.page.url+'\nTitle: '+title+'\n'+'\n'.join(lines)+'\nText: '+' '.join(texts)[:2500]

    def element_text(self, ref):
        return self._element(ref).evaluate('''el => el.outerHTML + ' ' +
          (el.localName==='button' ? 'button type='+el.type : '') + ' ' +
          (el.innerText||'') + ' ' + (el.getAttribute('aria-label')||'')''')

    def element_info(self, ref):
        """Visible label and whether the element sits inside a cookie/consent banner."""
        return self._element(ref).evaluate('''el => ({
          label: (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').replace(/\\s+/g,' ').trim().slice(0,120),
          consent: !!el.closest('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=usercentrics i],[id*=onetrust i],#CybotCookiebotDialog,[aria-label*=cookie i],[aria-label*=eväst i]')
            || (el.getRootNode() instanceof ShadowRoot && /usercentrics|cookie|consent/i.test(el.getRootNode().host.id + ' ' + el.getRootNode().host.className))
        })''')

    def click(self, ref):
        self._element(ref).click()
        self._settle()

    def type(self, ref, text):
        el = self._element(ref)
        kind = el.evaluate("el => el.isContentEditable ? 'contenteditable' : el.localName==='input' ? el.type : el.localName")
        if kind in ('date','time','datetime-local','number','contenteditable'):
            hints = {'date':'YYYY-MM-DD', 'time':'HH:MM or HH:MM:SS',
                     'datetime-local':'YYYY-MM-DDTHH:MM', 'number':'a numeric value', 'contenteditable':'plain text'}
            try:
                el.fill(text)
                if kind != 'contenteditable' and text and not el.input_value():
                    raise ValueError('The browser rejected the value')
            except Exception as exc:
                raise ValueError(f'Cannot fill {kind}; expected {hints[kind]}: {exc}') from exc
            self._settle()
            return
        if el.evaluate("el => !['input','textarea'].includes(el.localName) || ['submit','button','checkbox','radio','file','password','hidden','reset','image','range','color'].includes(el.type)"):
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
        if el.evaluate("el => el.localName==='select'"):
            options = el.locator('option').evaluate_all('(els)=>els.map(o=>({value:o.value,text:o.text}))')
            match = next((o for o in options if option.casefold() in (o['value'].casefold(),o['text'].casefold())), None)
            if not match:
                raise ValueError('Option not found')
            el.select_option(value=match['value'])
        else:
            # Popups may be portalled outside the control, including inside shadow roots.
            frame = self._refs[ref]
            el.click()
            popup = el.evaluate("el => (el.getAttribute('aria-controls')||el.getAttribute('aria-owns')||'').split(/\\s+/).filter(Boolean).map(id=>'#'+CSS.escape(id)).join(',')")
            scope = frame.locator(popup) if popup else frame.locator('body')
            candidates = scope.locator('[role="option"], [role="listbox"] *, li').filter(visible=True)
            # A controlled listbox can also have plain children without option roles.
            if popup:
                candidates = scope.locator('[role="option"], li, :scope[role="listbox"] *').filter(visible=True)
            try:
                candidates.filter(has_text=re.compile(re.escape(option.strip()), re.I)).first.wait_for(state='visible')
            except BrowserTimeout as exc:
                raise ValueError('Option not found') from exc
            options = candidates.all()
            exact = [o for o in options if o.inner_text().strip().casefold()==option.strip().casefold()]
            contains = [o for o in options if option.strip().casefold() in o.inner_text().strip().casefold()]
            matches = exact or contains
            if not matches:
                raise ValueError('Option not found')
            matches[0].click()
        self._settle()

    def check(self, ref, checked):
        el = self._element(ref)
        if el.get_attribute('role') in ('checkbox','switch'):
            if el.get_attribute('aria-disabled') == 'true':
                raise ValueError('Choose an enabled checkbox or switch')
            state = el.get_attribute('aria-checked')
            if state not in ('true','false','mixed'):
                raise ValueError('Checkbox or switch must expose aria-checked')
            if (state == 'true') != checked or state == 'mixed':
                el.click()
            try:
                expect(el).to_have_attribute('aria-checked', str(checked).lower(), timeout=5000)
            except AssertionError as exc:
                raise ValueError('Checkbox or switch did not reach requested state') from exc
        else:
            el.set_checked(checked)
        self._settle()

    def press(self, key):
        # Forms can submit implicitly even with focus in a text field.
        if re.search(r'enter|return|space|\s', key, re.I) and any(frame.evaluate("""() => { let el=document.activeElement; while(el?.shadowRoot?.activeElement) el=el.shadowRoot.activeElement; return !!el?.closest('form,button,[role=button],a'); }""") for frame in self.page.frames):
            raise ValueError('Call request_approval first; use click for final submission')
        self.page.keyboard.press(key)
        self._settle()

    def scroll(self, direction):
        if direction not in ('up','down'):
            raise ValueError('Direction must be up or down')
        self.page.mouse.wheel(0, 600 if direction=='down' else -600)
        self._settle()

    def blockers(self):
        found = set()
        for frame in self.page.frames:
            if frame != self.page.main_frame and not frame.frame_element().is_visible():
                continue
            found.update(frame.evaluate(r'''() => {
              const all=[];
              const walk=root=>{ for(const el of root.querySelectorAll('*')) { all.push(el); if(el.shadowRoot) walk(el.shadowRoot); }};
              walk(document);
              const visible=el=>!!(el.getBoundingClientRect().width && el.getBoundingClientRect().height) && getComputedStyle(el).visibility!=='hidden';
              const els=all.filter(visible), found=[];
              const attrs=el=>[el.id,typeof el.className==='string'?el.className:'',el.getAttribute('src'),el.getAttribute('title'),el.getAttribute('aria-label'),el.getAttribute('name')].join(' ');
              const big=el=>{ const r=el.getBoundingClientRect(); return r.width>=60 && r.height>=30; };
              const text=[document.body?.innerText||'',...els.map(el=>[el.getAttribute('href'),el.getAttribute('src'),el.getAttribute('title'),el.getAttribute('aria-label'),el.shadowRoot?.textContent].join(' '))].join(' ');
              // A page with its own fields is a form that merely mentions identification (footer links, "or log in").
              const fields=els.filter(el=>el.matches('input:not([type=hidden]):not([type=search]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]),textarea,select'));
              const strongAuth=/suomi\.fi|tunnistaudu|tunnistautuminen|pankkitunnu|mobiilivarmenne|bankid|strong (electronic )?identification/i;
              if(els.some(el=>el.matches('input[type=password]'))
                 || /(^|\.)tunnistus\.suomi\.fi$/i.test(location.hostname)
                 || els.some(el=>el.matches('iframe') && /tunnistus\.suomi\.fi/i.test(el.src||''))
                 || (!fields.length && strongAuth.test(text) && els.filter(el=>el.matches('a[href],button,[role=button]')).length < 8)) found.push('login');
              // Only challenges a person must solve; invisible reCAPTCHA v3 badges and "protected by reCAPTCHA" notes do not block.
              const challengeFrame=el=>el.matches('iframe') && big(el) && !/size=invisible/i.test(el.src||'') && !el.closest('.grecaptcha-badge') &&
                 (/challenges\.cloudflare\.com|recaptcha\/(api2|enterprise)\/(anchor|bframe)|hcaptcha\.com/i.test(el.src||'') || /captcha|turnstile/i.test(el.title||''));
              if(/verify you are human|i'?m not a robot|en ole robotti|vahvista,? että olet ihminen|jag är inte en robot|solve the captcha|complete the captcha|enter the (characters|code) (shown|in the image)|ratkaise captcha/i.test(text)
                 || els.some(challengeFrame)
                 || els.some(el=>el.matches('input') && /captcha/i.test(attrs(el)))
                 || els.some(el=>!el.matches('iframe') && big(el) && /captcha|turnstile/i.test(attrs(el)) && !/grecaptcha-badge|invisible/i.test(attrs(el)+' '+(el.getAttribute('data-size')||'')))) found.push('captcha');
              if(els.some(el=>el.matches('input') && /cc-number|card.?number|cardnumber/i.test([el.name,el.id,el.autocomplete,el.placeholder].join(' ')) || el.matches('iframe') && /stripe|adyen|braintree|checkout|paypal/i.test(el.src))) found.push('payment');
              return found;
            }'''))
        return [kind for kind in ('login','captcha','payment') if kind in found]

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
