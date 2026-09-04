"""Local Flow importer smoke test. Run while `npm run dev` is serving GemClean."""

from __future__ import annotations

import argparse
import json
import struct
import tempfile
import zlib
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright


def png(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    rows = b"".join(b"\x00" + bytes((*color, 255)) * width for _ in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def fixture(path: Path) -> None:
    projects = {"projects": [{"id": "project-1", "name": "Browser fixture", "media_ids": ["wide", "square", "clip"]}]}
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("Takeout/Flow/projects.json", json.dumps(projects))
        archive.writestr("Takeout/Flow/media/wide.png", png(640, 240, (122, 77, 45)))
        archive.writestr("Takeout/Flow/media/square.webp", png(320, 320, (45, 70, 105)))
        archive.writestr("Takeout/Flow/media/clip.mp4", b"not-decoded-in-image-phase")


def run(url: str) -> None:
    with tempfile.TemporaryDirectory() as directory:
        archive_path = Path(directory) / "flow-browser-fixture.zip"
        fixture(archive_path)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 390, "height": 844})
            console_errors: list[str] = []
            remote_writes: list[str] = []
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            page.on("request", lambda request: remote_writes.append(f"{request.method} {request.url}") if request.method != "GET" and not request.url.startswith(url.rstrip("/")) else None)
            page.goto(url)
            page.wait_for_load_state("networkidle")
            page.get_by_role("tab", name="Import Flow project").click()
            assert page.get_by_role("button", name="Google Drive").is_disabled()
            page.locator('input[accept*=".zip"]').set_input_files(str(archive_path))
            page.get_by_role("heading", name="Review imported media").wait_for()
            assert page.locator(".flow-asset").count() == 3
            assert page.locator(".flow-status.unsupported").count() == 1
            page.locator(".flow-thumb").first.click()
            modal = page.get_by_role("dialog")
            modal.wait_for()
            image = modal.locator("img")
            image.wait_for()
            box = image.bounding_box()
            assert box and box["width"] <= 390 and box["height"] > 0
            page.get_by_role("button", name="Close preview").click()
            page.get_by_role("button", name="Clean 2 selected").click()
            page.get_by_text("Batch finished. Review or download the results.").wait_for(timeout=60_000)
            assert page.get_by_role("button", name="Results ZIP (2)").is_visible()
            assert not console_errors, console_errors
            assert not remote_writes, remote_writes
            browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:3000/")
    run(parser.parse_args().url)
