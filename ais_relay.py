#!/usr/bin/env python3
"""Local AIS feed for development, in place of wss://api.icatmar.cat/ais (which only accepts
ICATMAR's own website).

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
(see tools/simulate_pati.py).

Usage: python3 ais_relay.py [port] [pati port]   (default 8766 and 8767; AISManager connects to
the first on localhost)
Requires the websockets package (pip install websockets).
"""
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import websockets

AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream'
# Around the buoy: Barcelona coast, from Garraf to Badalona and some 40 km offshore
BBOXES = [[[41.10, 1.86], [41.64, 2.58]]]
HISTORY_SECONDS = 30 * 60  # recent messages sent to each new client, so ships show up at once

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


def read_pati_devices():
    devices = {'simulador': 'Patí (simulat)'}
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


async def pati_handler(reader, writer, devices):
    status = '400 Bad Request'
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 10)
        lines = head.decode(errors='ignore').split('\r\n')
        method, path = lines[0].split(' ')[:2]
        headers = {k.strip().lower(): v.strip() for k, _, v in (line.partition(':') for line in lines[1:] if line)}
        body = await reader.readexactly(int(headers.get('content-length', 0) or 0))
        device_id, lat, lon, speed, bearing, when = pati_fix(path, body)
        if device_id not in devices:
            status = '403 Forbidden'
            print(f'⛔ Patí: unknown device {device_id!r}')
        else:
            mmsi = f'PATI-{device_id}'
            metadata = {'MMSI_String': mmsi, 'ShipName': devices[device_id], 'latitude': lat, 'longitude': lon, 'time_utc': when}
            if mmsi not in pati_static:
                pati_static[mmsi] = {'MessageType': 'ShipStaticData', 'MetaData': metadata,
                                     'Message': {'ShipStaticData': {'Type': PATI_TYPE, 'Dimension': PATI_DIMENSION}}}
                publish(pati_static[mmsi])
            publish({'MessageType': 'PositionReport', 'MetaData': metadata,
                     'Message': {'PositionReport': {'TrueHeading': bearing, 'Sog': round(speed, 1)}}})
            status = '200 OK'
    except (ValueError, KeyError, IndexError, asyncio.IncompleteReadError, asyncio.TimeoutError):
        pass
    writer.write(f'HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'.encode())
    await writer.drain()
    writer.close()


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


async def main(port, pati_port):
    api_key = read_api_key()
    devices = read_pati_devices()
    # The patí port listens on every interface, so a phone on the same network can reach it
    pati_server = await asyncio.start_server(lambda r, w: pati_handler(r, w, devices), '0.0.0.0', pati_port)
    async with websockets.serve(client_handler, 'localhost', port), pati_server:
        print(f'AIS relay on ws://localhost:{port}, patí positions on http://<this computer>:{pati_port}/')
        await upstream(api_key)


if __name__ == '__main__':
    args = [int(arg) for arg in sys.argv[1:3]]
    asyncio.run(main(*(args + [8766, 8767][len(args):])))
