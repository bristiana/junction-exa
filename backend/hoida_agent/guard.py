"""Identify actions that need explicit human approval."""
import re

_FINAL = re.compile(r"\b(submit|send|pay|confirm|book|reserve|place\s+order|complete|finish|lähetä|maksa|vahvista|varaa|tilaa|jatka\s+maksamaan)\b", re.I)
_SUBMIT = re.compile(r'''(?:button|input)\b[^>\n]*\btype\s*=\s*["']?submit\b''', re.I)


def is_final_submit(element_description: str) -> bool:
    return bool(_FINAL.search(element_description) or _SUBMIT.search(element_description))
