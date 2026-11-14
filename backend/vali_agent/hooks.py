"""Callbacks shared by local and cloud runs."""
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


@dataclass
class AgentHooks:
    on_step: Callable[[str, bytes | None], None]
    wait_for_approval: Callable[[str, list[dict]], bool]
    should_stop: Callable[[], bool]
    # Optional: latest live frame (JPEG), about twice a second while the browser runs.
    on_frame: Callable[[bytes], None] | None = None
    # Optional: running token totals after every model call.
    on_usage: Callable[[dict], None] | None = None
    # Optional: messages the user sent while the run is going (WhatsApp or extension), drained on read.
    pending_messages: Callable[[], list[str]] | None = None
    # Optional: ask the user one question and wait for the answer; None when nobody answered in time.
    ask_user: Callable[[str], str | None] | None = None


class ConsoleHooks(AgentHooks):
    def __init__(self, folder: str = 'vali-shots'):
        self.folder = Path(folder)
        self.count = 0
        super().__init__(self._step, self._approve, lambda: False, ask_user=self._ask)

    def _step(self, text, jpeg):
        print(text)
        if jpeg:
            self.folder.mkdir(parents=True, exist_ok=True)
            self.count += 1
            (self.folder / f'{self.count:03}.jpg').write_bytes(jpeg)

    def _approve(self, summary, filled):
        print(summary)
        for field in filled:
            print(f"{field['label']}: {field['value']}")
        return input('Approve final submission? [yes/no] ').strip().lower() == 'yes'

    def _ask(self, question):
        return input(f'{question}\n> ').strip() or None
