"""Identify actions that need explicit human approval."""
import re

_FINAL = re.compile(r"\b(submit|send|pay|payment|checkout|confirm|book|reserve|place\s+order|complete|finish|lähetä|maksa|maksuun|"
                    r"kassalle|vahvista|varaa|varaus|tilaa|tilaus|jatka\s+maksamaan|skicka|bekräfta|boka|betala)\b", re.I)
_SUBMIT = re.compile(r'''(?:button|input)\b[^>\n]*\btype\s*=\s*["']?submit\b''', re.I)
# Wizard steps and pickers: SPA widgets often make every button type=submit.
_NON_FINAL = re.compile(
    r"^\s*(next|next step|continue|seuraava|seuraava vaihe|jatka|eteenpäin|nästa|fortsätt|weiter|back|previous|edellinen|"
    r"palaa\b.*|takaisin|tillbaka|search|hae|etsi|show more|näytä lisää|lisää\b.*|more options|select\b.*|valitse\b.*|"
    r"choose\b.*|change|muuta|edit|close|sulje|cancel|peruuta|[+\-−×]|"
    r"\d{1,2}([:.]\d{2})?(\s*[-–]\s*\d{1,2}[:.]\d{2})?|\d{1,3}\s*(hlö|henkilö[äa]?|people|persons|guests|vierasta|pers\.?)|"
    r"((ma|ti|ke|to|pe|la|su|mon|tue|wed|thu|fri|sat|sun)[a-zä]*\.?,?\s*)?\d{1,2}\.?\s*(\d{1,2}\.?|[a-zä]+)?\s*(\d{4})?)\s*$", re.I)


def is_final_submit(element_description: str, label: str | None = None) -> bool:
    if label is not None:
        if _FINAL.search(label):
            return True
        if _NON_FINAL.match(label):
            return False
    return bool(_FINAL.search(element_description) or _SUBMIT.search(element_description))
