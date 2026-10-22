"""TAXIAPP PR #119 local-only preview. Serves static allowlisted files, no writes."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote
import mimetypes
import webbrowser

ROOT = Path(__file__).resolve().parent
HOST, PORT = "127.0.0.1", 8787
URL = "http://localhost:8787/?adminFirestorePreview=1&build=v0.3.128-pr119"
ALLOWED = {".html", ".js", ".css", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp"}

class StaticFiles(BaseHTTPRequestHandler):
    def do_GET(self):
        self.serve(False)

    def do_HEAD(self):
        self.serve(True)

    def serve(self, head_only):
        try:
            uri = unquote(urlsplit(self.path).path)
            if uri in ("", "/"):
                uri = "/index.html"
            file = (ROOT / uri.lstrip("/")).resolve()
            if not file.is_relative_to(ROOT) or file.suffix.lower() not in ALLOWED or not file.is_file():
                self.send_error(404, "Not found")
                return
            contents = file.read_bytes()
            mime = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", mime + ("; charset=utf-8" if mime.startswith(("text/", "application/json")) or mime == "application/javascript" else ""))
            self.send_header("Content-Length", str(len(contents)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            if not head_only:
                self.wfile.write(contents)
        except Exception as error:
            print("TAXIAPP local preview error:", error, flush=True)
            try:
                self.send_error(500, "Local preview error")
            except OSError:
                pass

if __name__ == "__main__":
    print("TAXIAPP v0.3.128 - PR #119 development preview", flush=True)
    try:
        with ThreadingHTTPServer((HOST, PORT), StaticFiles) as server:
            print("Server ready:", URL, flush=True)
            print("This window runs the server. Close it or press Ctrl+C to stop.", flush=True)
            print("If the browser does not open automatically, paste the URL above.", flush=True)
            try:
                webbrowser.open(URL, new=2)
            except Exception as error:
                print("Browser launch failed:", error, flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                print("Stopped.", flush=True)
    except OSError as error:
        print("Cannot start local server:", error, flush=True)
        print("If port 8787 is in use, close the old TAXIAPP preview window.", flush=True)
        raise SystemExit(1)
