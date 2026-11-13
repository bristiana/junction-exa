"""Callbacks shared by local and cloud runs."""
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


@dataclass
class AgentHooks:
    on_step: Callable[[str, bytes | None], None]
    wait_for_approval: Callable[[str, list[dict]], bool]
    should_stop: Callable[[], bool]


class ConsoleHooks(AgentHooks):
    def __init__(self, folder: str = 'hoida-shots'):
        self.folder = Path(folder)
        self.count = 0
        super().__init__(self._step, self._approve, lambda: False)

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
