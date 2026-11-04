#!/usr/bin/env python3
"""Local AIS feed for development, in place of wss://api.icatmar.cat/ais (which only accepts
ICATMAR's own website).

Connects to aisstream.io (free, needs an API key: https://aisstream.io) for the ships around
the buoy and relays them to the app speaking the same protocol as ICATMAR's server
(see Assets/Scripts/AIS/AISManager.js):
  on connecting   {"bboxes": [...]}, then {"history": [recent messages]}
  on each message {"message": <aisstream message>}

The key is read from AISSTREAM_API_KEY, or from the .env file next to this script (not in git).

Usage: python3 ais_relay.py [port]   (default 8766; AISManager connects there on localhost)
Requires the websockets package (pip install websockets).
"""
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone

import websockets

AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream'
# Around the buoy: Barcelona coast, from Garraf to Badalona and some 40 km offshore
BBOXES = [[[41.10, 1.86], [41.64, 2.58]]]
HISTORY_SECONDS = 30 * 60  # recent messages sent to each new client, so ships show up at once

clients = set()
history = []  # (received at, message)


def read_api_key():
    key = os.environ.get('AISSTREAM_API_KEY')
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not key and os.path.exists(env_path):
        with open(env_path) as env:
            for line in env:
                name, _, value = line.strip().partition('=')
                if name == 'AISSTREAM_API_KEY':
                    key = value.strip()
    if not key:
        sys.exit('No aisstream.io key: set AISSTREAM_API_KEY or add it to .env')
    return key


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
                    now = time.time()
                    history.append((now, message))
                    while history and history[0][0] < now - HISTORY_SECONDS:
                        history.pop(0)
                    websockets.broadcast(clients, json.dumps({'message': message}))
        except (OSError, websockets.WebSocketException) as error:
            print('❌ aisstream.io connection lost, retrying in 10 s:', error)
        await asyncio.sleep(10)


async def client_handler(ws, path=None):
    clients.add(ws)
    try:
        await ws.send(json.dumps({'bboxes': BBOXES}))
        await ws.send(json.dumps({'history': [message for _, message in history]}))
        async for _ in ws:  # Subscriptions from the app: one feed for everybody
            pass
    finally:
        clients.discard(ws)


async def main(port):
    api_key = read_api_key()
    async with websockets.serve(client_handler, 'localhost', port):
        print(f'AIS relay on ws://localhost:{port}')
        await upstream(api_key)


if __name__ == '__main__':
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 8766))
