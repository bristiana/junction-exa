// Numbered citation pills and the one dark popover they share: "n · domain · title · read today HH:MM" and the quote.
import { h } from './dom.js';
import { publishedStamp, quoteUrl, readStamp } from './model.js';

let popover = null;
let pinned = null;

export function citePill(task, source) {
  if (!source) return null;
  const pill = h('button', { type: 'button', class: 'pill', 'aria-label': `Source ${source.n}: ${source.domain}`, 'aria-describedby': 'cite-pop' },
    String(source.n));
  const open = () => place(pill, card(task, source));
  pill.addEventListener('mouseenter', open);
  pill.addEventListener('focus', open);
  pill.addEventListener('mouseleave', () => pinned !== pill && hide());
  pill.addEventListener('blur', () => pinned !== pill && hide());
  pill.addEventListener('click', (event) => {
    event.stopPropagation();
    pinned = pinned === pill ? null : pill;
    if (pinned) open(); else hide();
  });
  return pill;
}

function card(task, source) {
  const stamp = publishedStamp(source.published);
  return [
    h('p', { class: 'pop-head' }, [source.n, source.domain, source.title, readStamp(task, source)].filter(Boolean).join(' · ')),
    source.quote ? h('blockquote', { class: 'pop-quote' }, `“${source.quote}”`) : null,
    stamp || source.stale ? h('p', { class: source.stale ? 'pop-stamp stale' : 'pop-stamp' },
      [stamp, source.stale ? 'may be outdated' : ''].filter(Boolean).join(' · ')) : null,
    h('a', { class: 'pop-link', href: quoteUrl(source.url, source.quote) || source.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the page ↗'),
  ];
}

function place(anchor, children) {
  if (!popover) {
    popover = h('div', { class: 'popover', role: 'tooltip', id: 'cite-pop' });
    popover.addEventListener('click', (event) => event.stopPropagation());
    document.body.append(popover);
    document.addEventListener('click', () => { pinned = null; hide(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { pinned = null; hide(); } });
    window.addEventListener('scroll', () => !pinned && hide(), { passive: true });
    window.addEventListener('hashchange', () => { pinned = null; hide(); }); // a pinned quote never follows you to another page
  }
  popover.replaceChildren(...children.filter(Boolean));
  popover.hidden = false;
  const box = anchor.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - 32);
  popover.style.width = width + 'px';
  popover.style.left = Math.max(16, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 16)) + 'px';
  const below = box.bottom + 8;
  const height = popover.offsetHeight;
  popover.style.top = (below + height < window.innerHeight ? below : Math.max(8, box.top - height - 8)) + 'px';
}

function hide() {
  if (popover) popover.hidden = true;
}
