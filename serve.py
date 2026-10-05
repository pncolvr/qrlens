#!/usr/bin/env python3
"""
Tiny static file server for QR Lens.

Usage:
    python3 serve.py [port]

Then open the printed URL in your browser. On the phone/other device,
use the LAN URL that's also printed (works over http:// on localhost,
but camera access on OTHER devices needs https:// or... simplest is
to open it directly on the same machine, or use a tunnel like
`ngrok http <port>` for a real device on your network).
"""
import http.server
import socket
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src")

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Camera APIs require a "secure context" -- localhost counts as one,
        # so plain http:// is fine as long as you're browsing from the same
        # machine the server runs on.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip

if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"Serving {DIRECTORY}")
        print(f"  Local:   http://localhost:{PORT}/index.html")
        print(f"  Network: http://{lan_ip()}:{PORT}/index.html  (camera needs https on other devices)")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
