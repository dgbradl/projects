"""A dependency-free local web server for the graphical front-end."""

import json
import os
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .session import Session

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
CONTENT_TYPES = {".html": "text/html; charset=utf-8",
                 ".css": "text/css; charset=utf-8",
                 ".js": "application/javascript; charset=utf-8",
                 ".svg": "image/svg+xml",
                 ".png": "image/png",
                 ".ico": "image/x-icon"}


def make_handler(session):
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
          open_browser=True, background=False):
    session = Session(seed=seed, save_dir=save_dir, secret_mode=secret_mode)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(session))
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    print(f"NO FINAL STOP is boarding at  {url}")
    print("(Ctrl-C to leave the platform. The save lives in ./saves either way.)")
    if open_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
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
