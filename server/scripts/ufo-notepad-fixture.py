"""Disposable Notepad fixture driver for AVA's bounded UFO runtime proof.

The driver exposes only three fixed operations over one caller-supplied file:
prepare an empty Notepad document, verify exact visible text, and close without
saving. It is copied into the ignored UFO runtime directory by the installer.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

from pywinauto import Desktop


def emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=True))


def matching_windows(name: str):
    return [
        window
        for window in Desktop(backend="uia").windows()
        if name.lower() in window.window_text().lower()
        and "notepad" in window.window_text().lower()
    ]


def close_fixture(name: str) -> int:
    closed = 0
    for window in matching_windows(name):
        try:
            window.close()
            time.sleep(0.25)
            for dialog in Desktop(backend="uia").windows():
                title = dialog.window_text().lower()
                if name.lower() not in title and "notepad" not in title:
                    continue
                for label in ("Don't save", "Don’t save", "Discard", "No"):
                    button = dialog.child_window(title=label, control_type="Button")
                    if button.exists(timeout=0.1):
                        button.click_input()
                        break
            closed += 1
        except Exception:
            # Cleanup is best effort; the adapter reports verification separately.
            continue
    return closed


def prepare(path: Path) -> dict[str, object]:
    path.parent.mkdir(parents=True, exist_ok=True)
    close_fixture(path.name)
    path.write_text("", encoding="utf-8")
    subprocess.Popen(["notepad.exe", str(path)], close_fds=True)
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        windows = matching_windows(path.name)
        if windows:
            return {
                "ok": True,
                "operation": "prepare",
                "windowTitle": windows[0].window_text(),
                "processId": windows[0].element_info.process_id,
            }
        time.sleep(0.2)
    return {"ok": False, "operation": "prepare", "error": "fixture_window_unavailable"}


def verify(path: Path, expected: str) -> dict[str, object]:
    windows = matching_windows(path.name)
    if len(windows) != 1:
        return {
            "ok": False,
            "operation": "verify",
            "error": "fixture_window_ambiguous" if windows else "fixture_window_unavailable",
            "windowCount": len(windows),
        }
    documents = windows[0].descendants(control_type="Document")
    if len(documents) != 1:
        return {
            "ok": False,
            "operation": "verify",
            "error": "fixture_document_unavailable",
            "documentCount": len(documents),
        }
    actual = documents[0].window_text().rstrip("\r\n")
    return {
        "ok": actual == expected,
        "operation": "verify",
        "windowTitle": windows[0].window_text(),
        "exactTextVisible": actual == expected,
        "actualLength": len(actual),
        "expectedLength": len(expected),
    }


def main() -> int:
    if len(sys.argv) < 3:
        emit({"ok": False, "error": "usage"})
        return 2
    operation = sys.argv[1]
    path = Path(sys.argv[2]).resolve()
    if operation == "prepare":
        result = prepare(path)
    elif operation == "verify" and len(sys.argv) == 4:
        result = verify(path, sys.argv[3])
    elif operation == "cleanup":
        result = {"ok": True, "operation": "cleanup", "closed": close_fixture(path.name)}
    else:
        result = {"ok": False, "error": "unsupported_operation"}
    emit(result)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
