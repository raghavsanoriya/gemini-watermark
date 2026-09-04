"""Process one local image through the browser worker and save the downloaded result."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


parser = argparse.ArgumentParser()
parser.add_argument("input")
parser.add_argument("output")
parser.add_argument("--url", default="http://127.0.0.1:5174/")
args = parser.parse_args()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto(args.url)
    page.wait_for_load_state("networkidle")
    page.locator('input[accept^="image/png"]').set_input_files(args.input)
    page.get_by_role("button", name="Remove visible mark").click()
    page.get_by_text(re.compile(r"^Visible mark repaired")).wait_for(timeout=120_000)
    with page.expect_download() as download_info:
        page.get_by_role("button", name="Download image").click()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    download_info.value.save_as(output)
    browser.close()
