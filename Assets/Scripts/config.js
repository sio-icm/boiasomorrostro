// Where the app gets what browsers can't get straight from ICATMAR's services: the buoys'
// ERDDAP data (through a proxy) and the AIS ships. See boia_server.py and deploy/README.md.
//  - Locally: dev_server.py's proxy and boia_server.py's AIS feed.
//  - Published: the SIO's server once SIO_SERVER is set; until then, ICATMAR's own services,
//    which only work on ICATMAR's website.

// The SIO's server, e.g. 'https://boia.example.org' (no trailing slash). Empty until deployed
const SIO_SERVER = '';

const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

const PROXY_URL = LOCAL ? '/proxy/'
  : SIO_SERVER ? `${SIO_SERVER}/proxy/`
  : 'https://api.icatmar.cat/proxy/';

const AIS_URL = LOCAL ? 'ws://localhost:8766'
  : SIO_SERVER ? `${SIO_SERVER.replace(/^http/, 'ws')}/ais`
  : 'wss://api.icatmar.cat/ais';

// An ERDDAP URL through the proxy
function proxied(url) {
  return PROXY_URL + '?url=' + encodeURIComponent(url);
}

export { SIO_SERVER, PROXY_URL, AIS_URL, proxied };
