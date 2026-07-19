"""Browser-level test of the web front-end (headless Chromium via Playwright).

Skipped automatically when Playwright or a Chromium build is unavailable,
so the core suite stays runnable everywhere.
"""

import glob
import os

import pytest

playwright_sync = pytest.importorskip("playwright.sync_api",
                                      reason="playwright not installed")

from nofinalstop.web.server import serve  # noqa: E402


def find_chromium():
    base = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if base:
        for pattern in ("chromium-*/chrome-linux/chrome",
                        "chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell"):
            hits = sorted(glob.glob(os.path.join(base, pattern)))
            if hits:
                return hits[-1]
    return None  # let Playwright use its own managed browser


def launch(pw):
    exe = find_chromium()
    try:
        return pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
    except Exception as exc:  # no usable browser anywhere
        pytest.skip(f"no chromium available: {exc}")


def test_browser_full_journey(tmp_path):
    httpd, session, url = serve(seed=7, save_dir=str(tmp_path), port=0,
                                open_browser=False, background=True)
    try:
        with playwright_sync.sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.goto(url)
            page.wait_for_selector(".title-plate")
            assert "No Final Stop" in page.text_content(".masthead")

            page.click("#btn-quick")
            page.wait_for_selector(".topbar")
            assert "The Rear Carriage" in page.text_content(".car-name")
            assert len(page.query_selector_all(".party-card")) == 4

            # inspect and act
            page.click(".node-btn")
            page.wait_for_selector(".node-detail")
            n_log = len(page.query_selector_all(".ev"))
            page.query_selector_all("button.ticket")[0].click()
            page.wait_for_function(
                f"document.querySelectorAll('.ev').length > {n_log}")

            # observer switch from an expanded party card
            cards = page.query_selector_all(".party-card")
            cards[1].click()
            page.wait_for_selector(".party-card.expanded .observe-btn")
            page.click(".party-card.expanded .observe-btn")
            page.wait_for_selector(".party-card:nth-child(2).observer")

            # drive the engine-side session to the Engine, then finish in-browser
            import sys
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from test_web import SessionBot
            bot = SessionBot(session)
            v = session.cmd({"cmd": "view"})
            guard = 0
            while v["status"]["carriage"] != "The Engine" and guard < 900:
                v = bot.step(v)
                guard += 1
                assert v.get("phase") != "ending", "run ended before the Engine"
            session.cmd({"cmd": "close_node"})

            page.reload()
            page.wait_for_selector(".topbar")
            page.click('[data-node="the_threshold"]')
            page.wait_for_selector(".node-detail")
            page.click('[data-action="volunteer_sacrifice"]')
            page.wait_for_selector(".modal-card")           # pending-choice modal
            page.click(".modal-card [data-char]")
            page.wait_for_selector("#nd-close")
            page.click("#nd-close")
            page.wait_for_selector('[data-node="the_heart"]')
            page.click('[data-node="the_heart"]')
            page.wait_for_selector('[data-action="stop_the_train"]')
            page.click('[data-action="stop_the_train"]')
            page.wait_for_selector(".ending-plate")
            assert "The Last Stop" in page.text_content(".ending-name")
            browser.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
