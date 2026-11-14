"""Identify actions that need explicit human approval."""
from html.parser import HTMLParser
import re

_FINAL = re.compile(r"\b(submit|send|pay|payment|checkout|confirm|book|reserve|buy|purchase|order|place\s+((my|your)\s+)?order|complete|finish|lähetä|maksa|maksuun|"
                    r"kassalle|vahvista|varaa|varaus|tilaa|tilaus|jatka\s+maksamaan|skicka|bekräfta|boka|betala|"
                    r"osta|viimeistele|ilmoittaudu|köp|beställ|reservera|slutför|register|subscribe|donate|apply)\b", re.I)
_SUBMIT = re.compile(r'''(?:button|input)\b[^>\n]*\btype\s*=\s*["']?submit\b''', re.I)
_NONFINAL = re.compile(r'^(next|continue|jatka|seuraava|nästa|fortsätt|search|hae|select|valitse|back|edellinen)\b|^\d{1,2}[.]?$|^(?:[a-zäöå]{2,3}\s+)?\d{1,2}[./]\d{1,2}[./](?:\d{2,4})?$', re.I)


class _Labels(HTMLParser):
    def __init__(self):
        super().__init__()
        self.words = []

    def handle_starttag(self, tag, attrs):
        self.words.extend(value for key, value in attrs if key in ('aria-label', 'value') and value)

    def handle_data(self, data):
        self.words.append(data)


def is_final_submit(element_description: str, label: str | None = None) -> bool:
    labels = _Labels()
    labels.feed(element_description)
    visible = ' '.join([label or '', *labels.words])
    submit = bool(_SUBMIT.search(element_description))
    if _FINAL.search(visible) or submit and re.search(r'\btallenna\b', visible, re.I):
        return True
    if _NONFINAL.search((label or ' '.join(labels.words)).strip()):
        return False
    return submit
