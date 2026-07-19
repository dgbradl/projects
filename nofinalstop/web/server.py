"""A dependency-free local web server for the graphical front-end.

Dev mode (--dev) watches the package for changes:
  - data/*.json edits hot-swap into the RUNNING game (state preserved);
  - .py edits save the run and re-exec the server process;
  - the browser polls /api/devstatus and reloads itself either way.
"""

import json
import os
import sys
import time
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .session import Session
from ..engine import save as savemod
from ..engine.data import reload_registry

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
PKG_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT_TYPES = {".html": "text/html; charset=utf-8",
                 ".css": "text/css; charset=utf-8",
                 ".js": "application/javascript; charset=utf-8",
                 ".svg": "image/svg+xml",
                 ".png": "image/png",
                 ".ico": "image/x-icon"}


def _scan(root, exts):
    """path -> mtime for files under root with the given extensions."""
    out = {}
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for fn in files:
            if fn.endswith(exts):
                p = os.path.join(dirpath, fn)
                try:
                    out[p] = os.stat(p).st_mtime
                except OSError:
                    pass
    return out


class DevWatcher(threading.Thread):
    """Polls the package for changes. Data edits hot-swap; code edits restart."""

    def __init__(self, session, devstate, interval=1.0):
        super().__init__(daemon=True)
        self.session = session
        self.devstate = devstate
        self.interval = interval

    def run(self):
        py = _scan(PKG_DIR, (".py",))
        data = _scan(os.path.join(PKG_DIR, "data"), (".json",))
        while True:
            time.sleep(self.interval)
            new_py = _scan(PKG_DIR, (".py",))
            if new_py != py:
                self._restart()
                py = new_py  # unreachable after execv; kept for safety
                continue
            new_data = _scan(os.path.join(PKG_DIR, "data"), (".json",))
            if new_data != data:
                data = new_data
                self._reload_content()

    def _reload_content(self):
        try:
            registry = reload_registry()
        except Exception as exc:   # half-saved JSON etc: keep the old content
            print(f"  [dev] content reload FAILED, keeping previous: {exc}")
            return
        self.session.apply_registry(registry)
        self.devstate["gen"] += 1
        print("  [dev] content reloaded into the running game "
              f"(generation {self.devstate['gen']})")

    def _restart(self):
        print("  [dev] code changed — saving and restarting the server…")
        try:
            with self.session.lock:
                if self.session.game is not None and not self.session.game.ending:
                    savemod.save_game(self.session.game, save_dir=self.session.save_dir)
        except Exception as exc:
            print(f"  [dev] autosave before restart failed: {exc}")
        os.environ["NFS_DEV_RESTART"] = "1"
        os.execv(sys.executable, [sys.executable, "-m", "nofinalstop"] + sys.argv[1:])


def make_handler(session, devstate=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, code, body, ctype="application/json; charset=utf-8"):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/api/view":
                return self._send(200, session.cmd({"cmd": "view"}))
            if path == "/api/devstatus":
                if devstate is None:
                    return self._send(200, {"dev": False})
                assets = _scan(STATIC_DIR, (".html", ".css", ".js"))
                return self._send(200, {
                    "dev": True,
                    "token": devstate["token"],
                    "gen": devstate["gen"],
                    "assets": int(max(assets.values(), default=0)),
                })
            if path == "/":
                path = "/index.html"
            fpath = os.path.normpath(os.path.join(STATIC_DIR, path.lstrip("/")))
            if not fpath.startswith(STATIC_DIR) or not os.path.isfile(fpath):
                return self._send(404, {"error": "not found"})
            ext = os.path.splitext(fpath)[1]
            with open(fpath, "rb") as f:
                data = f.read()
            return self._send(200, data, CONTENT_TYPES.get(ext, "application/octet-stream"))

        def do_POST(self):
            if self.path.split("?")[0] != "/api/cmd":
                return self._send(404, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._send(400, {"error": "bad request"})
            try:
                return self._send(200, session.cmd(data))
            except Exception as exc:  # surface engine errors to the page, not a dead tab
                return self._send(500, {"error": f"{type(exc).__name__}: {exc}"})

    return Handler


def serve(seed=None, save_dir=None, secret_mode="all", port=8337,
          open_browser=True, background=False, dev=False):
    session = Session(seed=seed, save_dir=save_dir, secret_mode=secret_mode)
    devstate = {"token": f"{os.getpid()}-{int(time.time() * 1000)}", "gen": 0} if dev else None
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(session, devstate))
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    print(f"NO FINAL STOP is boarding at  {url}")
    print("(Ctrl-C to leave the platform. The save lives in ./saves either way.)")
    if dev:
        print("  [dev] watching for changes: data edits hot-swap, code edits restart, "
              "the browser reboards itself.")
        if os.environ.pop("NFS_DEV_RESTART", None) and savemod.has_save(save_dir=save_dir):
            session.cmd({"cmd": "continue"})
            print("  [dev] restart detected — resumed the saved run.")
        if not background:
            DevWatcher(session, devstate).start()
    if open_browser and not os.environ.get("NFS_DEV_RESTARTED_ONCE"):
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    if dev:
        os.environ["NFS_DEV_RESTARTED_ONCE"] = "1"  # don't reopen tabs on each restart
    if background:
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        return httpd, session, url
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nThe station recedes. The train, of course, keeps moving.")
    finally:
        httpd.server_close()
    return None
