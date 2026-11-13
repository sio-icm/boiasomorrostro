"""Local development server.

Serves the parent folder (the app uses absolute /boiasomorrostro/... paths). The
buoy's data and the ships come from boia_server.py, which has to run too.

    python3 dev_server.py [port]

Then open http://localhost:8765/boiasomorrostro/
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):

  def end_headers(self):
    # Always serve fresh files, so edits show up on reload (ES modules are cached aggressively)
    self.send_header('Cache-Control', 'no-store')
    super().end_headers()


if __name__ == '__main__':
  port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
  server = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory=ROOT))
  print(f'Serving http://localhost:{port}/boiasomorrostro/')
  server.serve_forever()
