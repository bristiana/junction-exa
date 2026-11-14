"""One persistent browser page with snapshot references."""
import re
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright, expect, TimeoutError as BrowserTimeout
from .privacy import private_values
from .guard import is_final_submit
from .scope import site

_CAPTURE = r'''({start, limit}) => {
 const visible = el => { const r=el.getBoundingClientRect(), s=getComputedStyle(el);
   return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none' && !el.closest('[inert]'); };
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
 all.forEach(el=>el.removeAttribute('data-vali-ref'));
 const selector='a,button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="radio"],[role="option"],[role="combobox"],[role="menuitem"],[role="switch"],[contenteditable="true"],[tabindex]';
 const optionCounts=new Map(), optionSeen=new Map(), reportedGroups=new Set();
 const optionGroup=el=>el.closest('[role="listbox"]') || el.parentElement;
 for(const el of all.filter(el=>el.matches('[role="option"]') && visible(el))) {
   const group=optionGroup(el); optionCounts.set(group,(optionCounts.get(group)||0)+1);
 }
 // On a page with a form, footer links and long menus are noise that costs tokens on every step.
 const hasFields=all.some(el=>el.matches('input:not([type=hidden]):not([type=search]),select,textarea') && visible(el));
 const longNav=new Set(all.filter(el=>el.matches('nav,[role=navigation]') && el.querySelectorAll('a[href]').length>12));
 // Div/span widgets (suggestion lists, slot cells, calendar days) have no role but show a pointer cursor:
 // take the outermost pointer element that holds no real control and only a short text.
 const pointer=el=>!!el && el.nodeType===1 && getComputedStyle(el).cursor==='pointer';
 const clickable=el=>!el.closest(selector) && pointer(el) && !pointer(el.parentElement) && !el.querySelector(selector) &&
   el.innerText && el.innerText.trim().length<=80;
 const elements=all.filter(el=>{
   const listed=el.matches(selector);
   if(!(listed || clickable(el)) || !visible(el)) return false;
   if(hasFields && el.matches('a[href]') && (el.closest('footer,[role=contentinfo]') || [...longNav].some(n=>n.contains(el)))) return false;
   if(listed && !el.matches(selector.replace(',[tabindex]','')) && el.tabIndex<0) return false;
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
   const ref='e'+(start+i); el.setAttribute('data-vali-ref',ref);
   let kind=el.localName==='input' ? 'input['+el.type+']' : el.localName;
   if(el.getAttribute('role')) kind+='[role='+el.getAttribute('role')+']';
   else if(!el.matches(selector)) kind+='[clickable]';
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


_ACTION_DESCRIPTION = r'''el => {
    // Only recognized suggestions may omit the implicit HTML submit type.
    const suggestion = el.matches('[role="option"]') ||
        !!el.closest('typeahead-container,[role="listbox"]');
    const implicitChoice = suggestion && !el.hasAttribute('type');
    return [el.outerHTML + ' ' +
        [...(el.labels || [])].map(label => label.innerText).join(' ') + ' ' +
        (el.localName === 'button' && !implicitChoice ? 'button type=' + el.type : ''),
        el.getAttribute('aria-label') || el.innerText || el.value || ''];
}'''


class Browser:
    def __init__(self, headless=True):
        self._refs = {}
        self._sites = set()
        self._runtime = sync_playwright().start()
        try:
            self._browser = self._runtime.chromium.launch(headless=headless)
            self._context = self._browser.new_context(viewport={'width':1280,'height':800},
                locale='en-US', timezone_id='Europe/Helsinki',
                user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
            self.page = self._context.new_page()
            self.page.set_default_timeout(5000)
            # Booking widgets sometimes continue in a popup window; follow it.
            self._popups = []
            self._context.on('page', lambda page: self._popups.append(page))
            self._status = {}  # HTTP status of each page document, by URL
            self._context.on('response', self._note_status)
        except Exception:
            self._runtime.stop()
            raise

    def _note_status(self, response):
        try:
            if response.request.resource_type == 'document' and response.frame.parent_frame is None:
                self._status[response.url] = response.status
        except Exception:
            pass  # the frame is already gone

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
        self._wait_quiet()
        # A popup opened by the last action arrives as an event during the waits above.
        popups = [p for p in self._popups if not p.is_closed() and p is not self.page]
        self._popups.clear()
        if popups:
            self.page = popups[-1]
            self.page.set_default_timeout(5000)
            self._refs = {}
            try:
                self.page.wait_for_load_state('domcontentloaded', timeout=5000)
                self.page.wait_for_load_state('networkidle', timeout=1200)
            except BrowserTimeout:
                pass
        elif self.page.is_closed():
            open_pages = [p for p in self._context.pages if not p.is_closed()]
            if open_pages:
                self.page, self._refs = open_pages[-1], {}

        # Page-controlled redirects/popups may continue the flow on another site.
        if self.page.url.startswith(('http://', 'https://')):
            self._sites.add(site(self.page.url))

    def _wait_quiet(self, quiet_ms=250, cap_ms=2500):
        """Wait until the DOM stops changing and shows no "Loading..." or a lone "…" placeholder:
        calendars, slot lists and suggestion lists often fill in after network idle."""
        try:
            self.page.evaluate('''([quiet, cap]) => new Promise(done => {
              const busy = () => !!document.querySelector('[aria-busy=true]') ||
                /(^|\\n)\\s*(loading|ladataan|laddar)\\b|(^|\\n)\\s*(…|\\.\\.\\.)\\s*(\\n|$)/i.test(document.body?.innerText || '');
              let timer; const stop = () => { observer.disconnect(); done(); };
              const end = () => busy() ? (timer = setTimeout(end, quiet)) : stop();
              const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(end, quiet); });
              observer.observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
              timer = setTimeout(end, quiet); setTimeout(stop, cap);
            })''', [quiet_ms, cap_ms])
        except Exception:
            self.page.wait_for_timeout(100)  # the page navigated meanwhile

    def _element(self, ref):
        if not isinstance(ref, str) or not re.fullmatch(r'e[1-9]\d*', ref):
            raise ValueError('Invalid element reference; call read_page')
        frame = self._refs.get(ref)
        if frame is None or frame.is_detached():
            raise ValueError('Unknown element reference; call read_page')
        return frame.locator(f'[data-vali-ref="{ref}"]')

    def _check_url(self, url):
        destination = site(url)
        if self._sites and destination not in self._sites:
            raise ValueError('Destination is outside the start site and its page redirects')
        return destination

    def personal_field(self, ref):
        """Personal substitutions belong in ordinary fields on the authorized site only."""
        frame = self._refs[ref]
        self._check_url(frame.url)
        safe = self._element(ref).evaluate(r"""el => {
          const metadata = [el.name, el.id, el.getAttribute('aria-label'), el.placeholder,
            el.getAttribute('autocomplete')].filter(Boolean).join(' ');
          return (el.localName === 'select' || el.localName === 'input' &&
            ['text','email','tel','number','date','time','datetime-local'].includes(el.type)) &&
            !/search|query|message|comment|chat|recipient|compose|url|website/i.test(metadata);
        }""")
        if not safe:
            raise ValueError('Personal placeholders require a personal-data field, never search or messages')

    def goto(self, url):
        destination = self._check_url(url)
        if not re.match(r'^https?://', url, re.I):
            raise ValueError('Only http and https URLs are supported')
        self._sites.add(destination)
        self._refs = {}
        try:
            # Public-sector sites can take well over 5 s to load.
            self.page.goto(url, wait_until='domcontentloaded', timeout=20000)
        except BrowserTimeout:
            # Keep going if the page has content; a slow tracker should not end the run.
            if not self.page.evaluate("() => (document.body?.innerText || '').trim().length > 50"):
                raise ValueError(f'The page did not load in 20 s: {url}')
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

    def has(self, ref):
        """True when the ref is from the last snapshot and its element is still on the page."""
        try:
            return bool(ref) and self._element(ref).count() > 0
        except Exception:
            return False

    def element_text(self, ref):
        try:
            return ' '.join(self._element(ref).evaluate(_ACTION_DESCRIPTION, timeout=2500))
        except BrowserTimeout as exc:
            raise ValueError('That element is gone (the page changed); call read_page') from exc

    def element_info(self, ref):
        """Visible label and whether the element only opens a menu."""
        return self._element(ref).evaluate(r'''el => ({
          label: (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').replace(/\s+/g,' ').trim().slice(0,120),
          toggle: (el.hasAttribute('aria-expanded') || el.hasAttribute('aria-haspopup')) && el.type !== 'submit' && !el.closest('form')
        })''', timeout=2500)

    def _fallback_click(self, el, exc):
        """Visually hidden radios/checkboxes are clicked through their label; covered or off-screen elements by a DOM click."""
        how = el.evaluate('''el => {
          if (el.matches('input[type=radio],input[type=checkbox]')) {
            const label = el.labels?.[0] || el.closest('label');
            if (label) { label.click(); return 'label'; }
          }
          el.click(); return 'dom';
        }''')
        if how not in ('label', 'dom'):
            raise exc

    def _guard_click(self, el, approved=False):
        href = el.evaluate("el => el.closest('a[href]')?.getAttribute('href') || ''")
        if href:
            self._check_url(urljoin(self.page.url, href))
        description, label = el.evaluate(_ACTION_DESCRIPTION)
        final = is_final_submit(description, label)
        if final and not approved:
            raise ValueError('Call request_approval first')
        return final

    def click(self, ref, approved=False):
        el = self._element(ref)
        self._guard_click(el, approved)
        try:
            # Wizards often enable "Next" a moment after the last choice.
            expect(el).to_be_enabled(timeout=3000)
        except AssertionError:
            raise ValueError('This button is disabled: fill or choose the required fields first, then read_page')
        final = self._guard_click(el, approved)
        try:
            el.click(timeout=3000)
        except BrowserTimeout as exc:
            # A timeout may follow a successful submission; never retry a final action.
            if final:
                raise
            self._guard_click(el)
            self._fallback_click(el, exc)
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
        if self._types_by_keys(el, text):
            self._settle()
            return
        el.focus()
        el.evaluate('''(el,value) => {
          const proto=el.localName==='textarea'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true})); el.blur();
        }''', text)
        self._settle()

    @staticmethod
    def _types_by_keys(el, text):
        """Short single-line fields get real keystrokes and keep focus, so autocomplete lists open.

        Long text, textareas and anything with a line break use the value setter instead: a typed
        newline is an Enter key, which can submit the form past the approval guard."""
        if len(text) > 80 or '\n' in text or '\r' in text or not el.evaluate("el => el.localName === 'input'"):
            return False
        el.fill('')
        el.press_sequentially(text)
        el.dispatch_event('change')
        return True

    def select(self, ref, option, approved=False):
        el = self._element(ref)
        if el.evaluate("el => el.localName==='select'"):
            self._guard_click(el, approved)
            options = el.locator('option').evaluate_all('(els)=>els.map(o=>({value:o.value,text:o.text}))')
            match = next((o for o in options if option.casefold() in (o['value'].casefold(),o['text'].casefold())), None)
            if not match:
                raise ValueError('Option not found')
            el.select_option(value=match['value'])
        else:
            if not el.evaluate(r'''el => {
              const ids = (el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || '').split(/\s+/).filter(Boolean);
              const listbox = ids.some(id => el.getRootNode().getElementById(id)?.getAttribute('role') === 'listbox');
              const adjacentList = el.matches('button[type=button]') &&
                  el.nextElementSibling?.matches('ul,ol') && !!el.nextElementSibling.querySelector('li');
              return el.getAttribute('role') === 'combobox' || listbox || adjacentList || el.getAttribute('aria-haspopup') === 'listbox';
            }'''):
                raise ValueError('Choose a native select or a validated combobox')
            # Every internal click uses the same guard, with at most one approved final action.
            frame = self._refs[ref]
            if self._guard_click(el, approved):
                approved = False
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
            self._guard_click(matches[0], approved)
            matches[0].click()
        self._settle()

    def check(self, ref, checked):
        el = self._element(ref)
        self._guard_click(el)
        # A native <input type=checkbox role=switch> keeps its state in .checked, not aria-checked.
        native = el.evaluate("el => el.localName === 'input'")
        if el.get_attribute('role') in ('checkbox','switch') and not native:
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
            try:
                el.set_checked(checked, timeout=3000)
            except BrowserTimeout as exc:
                if el.is_checked() != checked:
                    self._fallback_click(el, exc)
        self._settle()

    def press(self, key):
        # Activation keys can commit through custom widgets even outside a form.
        if re.search(r'enter|return|space|\s', key, re.I):
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
            # Only the page itself is down when its document fails; an embed's own error text is not checked.
            status = self._status.get(self.page.url, 200) if frame == self.page.main_frame else None
            found.update(frame.evaluate(r'''status => {
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
              // A sign-in box next to a guest checkout is not a wall: the agent continues as a guest.
              // Only a control whose own text offers it counts; page or footer text alone never does.
              const guestWords=/as a guest|guest checkout|checkout as guest|continue as (a )?guest|without (logging in|signing in|an account|registering)|vieraana|ilman (kirjautumista|rekisteröitymistä|tiliä)|som gäst|utan (att logga in|konto)/i;
              const ownText=el=>(el.labels?.[0]?.innerText || el.innerText || el.value || '').trim();
              const guest=els.some(el=>el.matches('button,a[href],[role=button],[role=radio],input[type=radio],input[type=button],input[type=submit]')
                 && ownText(el).length<=250 && guestWords.test(ownText(el)));
              if(els.some(el=>el.matches('input[type=password]')) && !guest
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
              if(els.some(el=>el.matches('input') && /cc-number|card.?number|cardnumber/i.test([el.name,el.id,el.autocomplete,el.placeholder].join(' ')) || el.matches('iframe') && big(el) && /stripe|adyen|braintree|checkout|paypal/i.test(el.src))) found.push('payment');
              // A maintenance or error page instead of the form: a server error, or outage words with no fields to fill.
              // A form that only announces a coming break keeps its fields; a bot challenge (often a 503) stays a captcha.
              const outage=/down for maintenance|under maintenance|scheduled maintenance|maintenance break|service (is )?(temporarily )?unavailable|temporarily unavailable|bad gateway|gateway time-?out|internal server error|huoltokatko|huoltotauko|käyttökatko|palvelu ei ole (tällä hetkellä |tilapäisesti )?käytettävissä|palvelu on (tilapäisesti )?poissa käytöstä|tjänsten är (tillfälligt )?(inte tillgänglig|ur drift)|serviceavbrott|driftavbrott|underhållsarbete/i;
              if(status!==null && !fields.length && !found.includes('captcha') && (status>=500 || outage.test(document.body?.innerText||'') && els.filter(el=>el.matches('a[href],button,[role=button]')).length < 20)) found.push('unavailable');
              return found;
            }''', status))
        return [kind for kind in ('unavailable','login','captcha','payment') if kind in found]

    def screenshot_jpeg(self, quality=60, profile=None):
        if not profile:
            return self.page.screenshot(type='jpeg', quality=quality)
        # Cover profile-bearing DOM regions so image tools cannot reveal typed values.
        self.page.evaluate('''values => {
          document.querySelectorAll('[data-vali-private]').forEach(el=>el.removeAttribute('data-vali-private'));
          const privateText=s=>values.some(v=>String(s||'').toLowerCase().includes(v.toLowerCase()));
          for(const el of document.querySelectorAll('body *')) {
            if(privateText(el.value) || [...el.childNodes].some(n=>n.nodeType===3 && privateText(n.textContent)) || [...el.attributes].some(a=>privateText(a.value))) el.setAttribute('data-vali-private','1');
          }
          if(document.querySelector('canvas')) document.body.setAttribute('data-vali-private','1');
        }''', list(private_values(profile).values()))
        try:
            return self.page.screenshot(type='jpeg', quality=quality, mask=[self.page.locator('[data-vali-private]')])
        finally:
            self.page.evaluate("() => document.querySelectorAll('[data-vali-private]').forEach(el=>el.removeAttribute('data-vali-private'))")
