"""Local development server.

Serves the parent folder (the app uses absolute /boiasomorrostro/... paths) and
exposes /proxy/?url=<erddap url>, mirroring https://api.icatmar.cat/proxy/,
which does not allow requests from localhost.

    python3 dev_server.py [port]

Then open http://localhost:8765/boiasomorrostro/
"""
import functools
import http.server
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ALLOWED_HOSTS = {'erddap.icatmar.cat', 'hebe.icm.csic.es'}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):

  def end_headers(self):
    # Always serve fresh files, so edits show up on reload (ES modules are cached aggressively)
    self.send_header('Cache-Control', 'no-store')
    super().end_headers()

  def do_GET(self):
    parsed = urllib.parse.urlparse(self.path)
    if parsed.path.rstrip('/') == '/proxy':
      return self.proxy(urllib.parse.parse_qs(parsed.query).get('url', [''])[0])
    return super().do_GET()

  def proxy(self, url):
    target = urllib.parse.urlparse(url)
    if target.scheme != 'https' or target.hostname not in ALLOWED_HOSTS:
      return self.send_error(403, 'Host not allowed')
    try:
      with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'boiasomorrostro-dev'}), timeout=60) as res:
        status, content_type, body = res.status, res.headers.get('Content-Type', 'text/plain'), res.read()
    except urllib.error.HTTPError as err:
      status, content_type, body = err.code, 'text/plain', err.read()
    except urllib.error.URLError as err:
      return self.send_error(502, str(err.reason))
    self.send_response(status)
    self.send_header('Content-Type', content_type)
    self.send_header('Content-Length', str(len(body)))
    self.end_headers()
    self.wfile.write(body)


if __name__ == '__main__':
  port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
  server = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory=ROOT))
  print(f'Serving http://localhost:{port}/boiasomorrostro/')
  server.serve_forever()
