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

            # the scene shows the party in the carriage, with markers and doors
            page.wait_for_selector(".scene-band svg")
            assert len(page.query_selector_all(".scene-band .pcfig")) == 4
            assert len(page.query_selector_all(".scene-band .marker")) >= 3
            assert page.query_selector(".scene-band .door")
            # clicking a scene marker opens that node's detail
            page.click('.scene-band .marker[data-node="luggage_heaps"]')
            page.wait_for_selector(".node-detail")
            assert "luggage" in page.text_content(".nd-name").lower()
            page.click("#nd-close")

            # inspect and act — the narrative page-turns and the dice tumble
            page.click(".node-btn")
            page.wait_for_selector(".node-detail")
            log_before = page.text_content("#log")
            page.query_selector_all("button.ticket")[0].click()
            page.wait_for_function(
                "prev => document.querySelector('#log').textContent !== prev",
                arg=log_before)
            if page.query_selector("#log .dice"):   # actions with checks roll dice
                page.wait_for_selector("#log .dice.settled", timeout=5000)
            # the page itself must never scroll
            assert page.evaluate(
                "document.documentElement.scrollHeight <= window.innerHeight + 1")

            # party lives in a drawer now; observer switch works from its cards
            page.click('[data-dock="party"]')
            page.wait_for_selector(".drawer .party-card")
            assert len(page.query_selector_all(".drawer .party-card")) == 4
            cards = page.query_selector_all(".drawer .party-card")
            cards[1].click()
            page.wait_for_selector(".drawer .party-card.expanded .observe-btn")
            page.click(".drawer .party-card.expanded .observe-btn")
            page.wait_for_selector(".drawer .party-card:nth-child(2).observer")
            page.keyboard.press("Escape")
            page.wait_for_selector(".drawer", state="detached")

            # ...and directly from a scene figure (force: figures may be
            # mid-animation — trembling — which Playwright treats as unstable)
            first_fig = page.query_selector(".scene-band .pcfig")
            first_fig.click(force=True)
            page.wait_for_selector(".scene-band .pcfig.obs")

            # inventory drawer opens and lists supplies
            page.click('[data-dock="inventory"]')
            page.wait_for_selector(".drawer .res-chip")
            page.click(".drawer-close")

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
