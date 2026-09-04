"""Serve the static export under its GitHub Pages repository base path."""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class PagesHandler(SimpleHTTPRequestHandler):
    root = Path("out").resolve()
    base_path = "/gemini-watermark"

    def translate_path(self, path: str) -> str:
        stripped = path.split("?", 1)[0].split("#", 1)[0]
        if stripped == self.base_path:
            stripped = "/"
        elif stripped.startswith(f"{self.base_path}/"):
            stripped = stripped[len(self.base_path):]
        return str(self.root / stripped.lstrip("/"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    ThreadingHTTPServer(("127.0.0.1", args.port), PagesHandler).serve_forever()
