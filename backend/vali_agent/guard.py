"""Identify actions that need explicit human approval."""
import re

_FINAL = re.compile(r"\b(submit|send|pay|payment|checkout|confirm|book|reserve|buy|purchase|order|place\s+((my|your)\s+)?order|complete|finish|lähetä|maksa|maksuun|"
                    r"kassalle|vahvista|varaa|varaus|tilaa|tilaus|jatka\s+maksamaan|skicka|bekräfta|boka|betala)\b", re.I)
_SUBMIT = re.compile(r'''(?:button|input)\b[^>\n]*\btype\s*=\s*["']?submit\b''', re.I)


def without_default_submit(element_description: str) -> str:
    """An autocomplete choice drawn as a <button> with no type is type=submit only by HTML default: drop that alone.
    Its own words still count, so a "Place order" option still needs approval."""
    return re.sub(r'\bbutton type=submit\b', 'button', element_description)


def is_final_submit(element_description: str, label: str | None = None) -> bool:
    return bool(_FINAL.search(label or '') or _FINAL.search(element_description) or _SUBMIT.search(element_description))



def is_navigation(tag: str, href: str, in_form: bool, label: str) -> bool:
    """A real link outside a form that does not pay, confirm or send: opening it is not irreversible."""
    href = (href or '').strip().lower()
    real = href and not href.startswith(('#', 'javascript:', 'mailto:', 'tel:'))
    return tag == 'a' and bool(real) and not in_form and not _FINAL.search(label or '')
