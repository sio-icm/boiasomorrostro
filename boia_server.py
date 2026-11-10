#!/usr/bin/env python3
"""The SIO's server for the app: what browsers can't get straight from ICATMAR's services
(they only accept ICATMAR's own website), and positions of boats without AIS. Runs locally for
development and, the same, on the server (see deploy/README.md).

ERDDAP PROXY (HTTP port, /proxy/?url=<ERDDAP URL>): the buoys' ERDDAPs refuse browser requests,
so this fetches them and adds the CORS header for the allowed origins (BOIA_ORIGINS in .env,
comma separated; localhost always). Only for the hosts in PROXY_HOSTS, cached for a minute.

AIS FEED (WebSocket port), in place of wss://api.icatmar.cat/ais.

Connects to aisstream.io (free, needs an API key: https://aisstream.io) for the ships around
the buoy and relays them to the app speaking the same protocol as ICATMAR's server
(see Assets/Scripts/AIS/AISManager.js):
  on connecting   {"bboxes": [...]}, then {"history": [recent messages]}
  on each message {"message": <aisstream message>}

The key is read from AISSTREAM_API_KEY, or from the .env file next to this script (not in git).

It also takes positions of boats without AIS (a patí de vela, say) on an HTTP port, in the
format of the Traccar Client phone app (OsmAnd protocol: ?id=&lat=&lon=&speed=&bearing=, or its
JSON body), and relays them as AIS messages of a sailing boat with MMSI "PATI-<id>". Only the
device ids listed in PATI_DEVICES (.env, "id:Name,id2:Name2") are accepted, plus "simulador"
(see tools/simulate_pati.py) if PATI_SIMULATOR=1.

Usage: python3 boia_server.py [port] [http port]   (default 8766 for the AIS WebSocket and 8767
for the proxy and the patí positions; see Assets/Scripts/config.js)
Requires the websockets package (pip install websockets).
"""
import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import websockets

AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream'
# Around the buoy: Barcelona coast, from Garraf to Badalona and some 40 km offshore
BBOXES = [[[41.10, 1.86], [41.64, 2.58]]]
HISTORY_SECONDS = 30 * 60  # recent messages sent to each new client, so ships show up at once

PROXY_HOSTS = {'erddap.icatmar.cat', 'hebe.icm.csic.es'}
PROXY_CACHE_SECONDS = 60
proxy_cache = {}  # url -> (fetched at, status, content type, body)

# A patí de vela: 5.68 m long (A + B, from the GPS), 1.6 m wide (C + D)
PATI_DIMENSION = {'A': 3, 'B': 3, 'C': 1, 'D': 1}
PATI_TYPE = 36  # Sailing

clients = set()
history = []  # (received at, message)
pati_static = {}  # MMSI -> its ShipStaticData message, sent to every new client


def read_env(name):
    value = os.environ.get(name)
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not value and os.path.exists(env_path):
        with open(env_path) as env:
            for line in env:
                key, _, found = line.strip().partition('=')
                if key == name:
                    value = found.strip()
    return value


def read_api_key():
    key = read_env('AISSTREAM_API_KEY')
    if not key:
        sys.exit('No aisstream.io key: set AISSTREAM_API_KEY or add it to .env')
    return key


def read_origins():
    """Websites allowed to use the proxy and the AIS feed: BOIA_ORIGINS, plus localhost"""
    origins = {f'http://{host}:{port}' for host in ('localhost', '127.0.0.1') for port in (8765, 8080, 5500)}
    origins |= {o.strip().rstrip('/') for o in (read_env('BOIA_ORIGINS') or '').split(',') if o.strip()}
    return origins


def read_pati_devices():
    """Phones allowed to send positions: PATI_DEVICES, plus the simulator if PATI_SIMULATOR=1
    (only for testing: anyone could otherwise send a fake patí to a public server)"""
    devices = {}
    if (read_env('PATI_SIMULATOR') or '').lower() in ('1', 'true', 'yes'):
        devices['simulador'] = 'Patí (simulat)'
    for entry in (read_env('PATI_DEVICES') or '').split(','):
        device_id, _, name = entry.strip().partition(':')
        if device_id:
            devices[device_id] = name or device_id
    return devices


def iso_time(aisstream_time):
    """aisstream gives '2024-05-01 10:20:30.123456789 +0000 UTC', which browsers can't parse"""
    try:
        date, clock = aisstream_time.split(' ')[:2]
        seconds = clock.split('.')[0]
        return datetime.strptime(f'{date} {seconds}', '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).isoformat()
    except (AttributeError, ValueError):
        return datetime.now(timezone.utc).isoformat()


async def upstream(api_key):
    """Keeps the aisstream.io connection open, reconnecting when it drops"""
    while True:
        try:
            async with websockets.connect(AISSTREAM_URL) as ws:
                await ws.send(json.dumps({'APIKey': api_key, 'BoundingBoxes': BBOXES}))
                print('✅ Connected to aisstream.io')
                async for raw in ws:
                    message = json.loads(raw)
                    if 'error' in message:
                        print('❌ aisstream.io:', message['error'])
                        continue
                    if 'MetaData' not in message:
                        continue
                    metadata = message['MetaData']
                    metadata['time_utc'] = iso_time(metadata.get('time_utc'))
                    metadata['ShipName'] = (metadata.get('ShipName') or '').strip()  # Padded with spaces
                    publish(message)
        except (OSError, websockets.WebSocketException) as error:
            print('❌ aisstream.io connection lost, retrying in 10 s:', error)
        await asyncio.sleep(10)


def publish(message):
    """Keeps the message in the history and sends it to every connected app"""
    now = time.time()
    history.append((now, message))
    while history and history[0][0] < now - HISTORY_SECONDS:
        history.pop(0)
    websockets.broadcast(clients, json.dumps({'message': message}))


# PATÍ (positions from a phone)
def pati_fix(path, body):
    """(device id, lat, lon, speed in knots, bearing, ISO time) from a Traccar Client request:
    OsmAnd parameters in the query or a form body, or its JSON body (speed in m/s there)"""
    params = {key: values[0] for key, values in parse_qs(urlsplit(path).query).items()}
    if body:
        try:
            data = json.loads(body)
            coords = data['location']['coords']
            params = {'id': data.get('device_id'), 'lat': coords['latitude'], 'lon': coords['longitude'],
                      'speed': max(0, coords.get('speed') or 0) / 0.514444, 'bearing': coords.get('heading'),
                      'timestamp': data['location'].get('timestamp')}
        except (ValueError, KeyError, TypeError):
            params.update({key: values[0] for key, values in parse_qs(body.decode(errors='ignore')).items()})
    lat, lon = float(params['lat']), float(params['lon'])
    speed = float(params.get('speed') or 0)
    bearing = params.get('bearing')
    bearing = 511 if bearing in (None, '', -1, '-1') else round(float(bearing)) % 360
    timestamp = params.get('timestamp')
    if timestamp and str(timestamp).replace('.', '', 1).isdigit():
        when = datetime.fromtimestamp(float(timestamp), timezone.utc).isoformat()
    else:
        when = datetime.now(timezone.utc).isoformat()
    return params.get('id'), lat, lon, speed, bearing, when


# ERDDAP PROXY
def fetch_upstream(url):
    """(status, content type, body) of an allowed ERDDAP URL, cached for a minute"""
    cached = proxy_cache.get(url)
    if cached and time.time() - cached[0] < PROXY_CACHE_SECONDS:
        return cached[1:]
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'boia-server'}), timeout=60) as res:
            result = (res.status, res.headers.get('Content-Type', 'text/plain'), res.read())
    except urllib.error.HTTPError as error:  # ERDDAP answers 404 when a query matches no rows
        result = (error.code, error.headers.get('Content-Type', 'text/plain'), error.read())
    except OSError as error:
        result = (502, 'text/plain', str(error).encode())
    if result[0] < 500:
        proxy_cache[url] = (time.time(),) + result
        if len(proxy_cache) > 500:
            proxy_cache.pop(next(iter(proxy_cache)))
    return result


async def proxy(path):
    target = parse_qs(urlsplit(path).query).get('url', [''])[0]
    if urlsplit(target).hostname not in PROXY_HOSTS:
        return 403, 'text/plain', b'Host not allowed'
    return await asyncio.to_thread(fetch_upstream, target)


# HTTP PORT: the proxy, and patí positions
async def http_handler(reader, writer, devices, origins):
    status, content_type, body_out, extra = '400 Bad Request', 'text/plain', b'', ''
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 10)
        lines = head.decode(errors='ignore').split('\r\n')
        method, path = lines[0].split(' ')[:2]
        headers = {k.strip().lower(): v.strip() for k, _, v in (line.partition(':') for line in lines[1:] if line)}
        body = await reader.readexactly(int(headers.get('content-length', 0) or 0))
        origin = headers.get('origin')
        if origin in origins:
            extra = f'Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n'
        if urlsplit(path).path.rstrip('/').endswith('/proxy'):
            code, content_type, body_out = await proxy(path)
            status = f'{code} {"OK" if code == 200 else "Error"}'
            extra += 'Cache-Control: public, max-age=60\r\n'
        else:
            status = pati_report(path, body, devices)
    except (ValueError, KeyError, IndexError, asyncio.IncompleteReadError, asyncio.TimeoutError):
        pass
    writer.write(f'HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {len(body_out)}\r\n{extra}'
                 f'Connection: close\r\n\r\n'.encode() + body_out)
    await writer.drain()
    writer.close()


def pati_report(path, body, devices):
    """Relays a phone's position as AIS messages; returns the HTTP status"""
    try:
        device_id, lat, lon, speed, bearing, when = pati_fix(path, body)
        if device_id not in devices:
            print(f'⛔ Patí: unknown device {device_id!r}')
            return '403 Forbidden'
        mmsi = f'PATI-{device_id}'
        metadata = {'MMSI_String': mmsi, 'ShipName': devices[device_id], 'latitude': lat, 'longitude': lon, 'time_utc': when}
        if mmsi not in pati_static:
            pati_static[mmsi] = {'MessageType': 'ShipStaticData', 'MetaData': metadata,
                                 'Message': {'ShipStaticData': {'Type': PATI_TYPE, 'Dimension': PATI_DIMENSION}}}
            publish(pati_static[mmsi])
        publish({'MessageType': 'PositionReport', 'MetaData': metadata,
                 'Message': {'PositionReport': {'TrueHeading': bearing, 'Sog': round(speed, 1)}}})
        return '200 OK'
    except (ValueError, KeyError, IndexError):
        return '400 Bad Request'


async def client_handler(ws, path=None):
    clients.add(ws)
    try:
        await ws.send(json.dumps({'bboxes': BBOXES}))
        # Patís' static data first, in case it left the history window
        recent = [message for _, message in history]
        await ws.send(json.dumps({'history': [m for m in pati_static.values() if m not in recent] + recent}))
        async for _ in ws:  # Subscriptions from the app: one feed for everybody
            pass
    finally:
        clients.discard(ws)


async def main(port, http_port):
    api_key = read_api_key()
    devices = read_pati_devices()
    origins = read_origins()
    # The HTTP port listens on BOIA_HTTP_HOST: by default every interface, so a phone on the same
    # network can reach it; 127.0.0.1 on a server, behind nginx
    http_host = read_env('BOIA_HTTP_HOST') or '0.0.0.0'
    http_server = await asyncio.start_server(lambda r, w: http_handler(r, w, devices, origins), http_host, http_port)
    # The AIS feed only for the allowed websites (browsers always send their origin)
    async with websockets.serve(client_handler, 'localhost', port, origins=sorted(origins)), http_server:
        print(f'AIS on ws://localhost:{port}; proxy and patí positions on http://{http_host}:{http_port}/')
        print('Allowed origins:', ', '.join(sorted(origins)))
        await upstream(api_key)


if __name__ == '__main__':
    args = [int(arg) for arg in sys.argv[1:3]]
    asyncio.run(main(*(args + [8766, 8767][len(args):])))
