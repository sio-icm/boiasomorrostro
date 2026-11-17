#!/usr/bin/env python3
"""The SIO's server for the app: what browsers can't get straight from ICATMAR's services
(they only accept ICATMAR's own website), and positions of boats without AIS. Runs locally for
development and, the same, on the server (see deploy/README.md).

ERDDAP PROXY (HTTP port, /proxy/?url=<ERDDAP URL>): the buoys' ERDDAPs refuse browser requests,
so this fetches them and adds the CORS header for the allowed origins (BOIA_ORIGINS in .env,
comma separated; localhost always). Only for the hosts in PROXY_HOSTS, cached for a minute.
The buoys' datasets are answered from a local copy (see erddap_mirror.py), kept up to date every
MIRROR_SECONDS, so the app keeps its data while an ERDDAP fails or stops listing them: in the
SQLite file ERDDAP_MIRROR (.env; erddap_mirror.sqlite next to this script by default, "0" off).

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

And the BlueLab's (ICM) autonomous vehicles, BlueBoats, when they are out: read from their public
fleet tracker (FLEET_URL in .env, https://github.com/BlueLab-ICM/dashboard-public; empty, off) and
relayed the same way, as MMSI "BLUEBOAT-<id>" with their telemetry. Whether the tracker answers is
sent to the apps as {"fleet": {"up": ..., "url": ...}}, so they don't link to it while it is down.

And, with SIMULATED_BOATS, a simulated BlueBoat and/or patí always sailing near the buoy, to show
the app when none of ours is out ("blueboat", "pati", comma separated; 1 for both). They are marked
as simulated, for the app to say so.

HISTORY OF OUR EQUIPMENT: every position of the ICM's own boats is kept, as it arrives (only while
they are out, sending), for the app to show later where each one was: the Pelagia Primer (RECORDED_MMSI)
and the BlueBoats, not the simulated ones. In the SIO database (boia_db.py, table positions; no
DATABASE_URL, not kept).

INTRANET (HTTP port, /intranet/api/): for the intranet page (intranet/index.html), behind nginx's
login, which tells the user in X-Intranet-User (without it, refused; locally, with INTRANET_LOCAL=1
in .env, from this computer only). GET buoy: the buoy's AIS history in the database; POST buoy-csv
(the CSV as the body): adds a TUGEMI download of it and writes the buoy's files for the app again
(see buoy_ais.py).

HISTORY (HTTP port, /history/): where our equipment was, from the database, for the 3D view's
history mode (Assets/History/HistoryManager.js). Read only, for the allowed origins as the proxy.
GET summary: each platform with positions, its first and last, and the days it has any.
GET positions?from=<ISO>&to=<ISO> (HISTORY_MAX_DAYS at most): each platform's positions then, one
per step (the median of those in it), the step growing with the range (HISTORY_POINTS at most).
The buoy's, only its GPS fixes (see buoy_ais.py).

CONDITIONS: every hour, the sea and the wind at the buoy from Open-Meteo (the same models the 3D
view uses now: CONDITION_SOURCES), the hours already past, kept in the database (table
conditions), as Open-Meteo only keeps a few days. Again for the last days each time, as the model
is run again; the first time, as far back as Open-Meteo gives (92 days). For the 3D view's history
mode: GET /history/conditions?at=<ISO>, those of that hour.

Usage: python3 boia_server.py [port] [http port]   (default 8766 for the AIS WebSocket and 8767
for the proxy and the patí positions; see Assets/Scripts/config.js)
Requires the websockets package (pip install websockets).
"""
import asyncio
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import parse_qs, quote, urlsplit

import websockets

import boia_db
import buoy_ais
from erddap_mirror import Mirror

AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream'
# Around the buoy: Barcelona coast, from Garraf to Badalona and some 40 km offshore
BBOXES = [[[41.10, 1.86], [41.64, 2.58]]]
HISTORY_SECONDS = 30 * 60  # recent messages sent to each new client, so ships show up at once

PROXY_HOSTS = {'erddap.icatmar.cat', 'hebe.icm.csic.es'}
PROXY_CACHE_SECONDS = 60
proxy_cache = {}  # url -> (fetched at, status, content type, body)
MIRROR_SECONDS = 5 * 60
mirror = None  # The local copy of the buoys' datasets, if on

# A patí de vela: 5.68 m long (A + B, from the GPS), 1.6 m wide (C + D)
PATI_DIMENSION = {'A': 3, 'B': 3, 'C': 1, 'D': 1}
PATI_TYPE = 36  # Sailing

# BlueLab's fleet: shown only when seen in the last FLEET_MAX_HOURS (out on a campaign); their own
# simulated vehicles (FLEET_EXCLUDE prefixes) never
FLEET_POLL_SECONDS = 300  # Also asked every 5 min, in case their live feed drops a message
FLEET_TIMEOUT = 20  # s
# A BlueBoat (Blue Robotics): a catamaran 1.2 m long, 0.85 m wide
BLUEBOAT_DIMENSION = {'A': 0.6, 'B': 0.6, 'C': 0.43, 'D': 0.42}
BLUEBOAT_TYPE = 0  # Not available: the app knows them by their MMSI

# Our equipment whose positions are kept (see HISTORY OF OUR EQUIPMENT): by MMSI, and every BlueBoat
RECORDED_MMSI = {'224946750'}  # Pelagia Primer
RECORDED_PREFIXES = ('BLUEBOAT-',)
POSITION_MESSAGES = ('PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport')
recorder = None  # The database connection, if there is one
RECONNECT_SECONDS = 60  # Not tried more often, so a database down doesn't hold the feed up
recorder_tried = 0

clients = set()
history = []  # (received at, message)
pati_static = {}  # MMSI -> its ShipStaticData message, sent to every new client (patís and BlueBoats)
# Whether the BlueLab's tracker answers, its address, and its vehicles with their last data (for the
# app's list of our equipment, which shows those not out too)
fleet = {'up': None, 'url': None, 'devices': []}
fleet_last = {}  # BlueBoat device -> (time, lat, lon) of its last position, for its speed


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
        except Exception as error:  # Whatever it is (a timeout too: not an OSError in Python 3.10), retried
            print(f'❌ aisstream.io connection lost, retrying in 10 s: {error!r}')
        await asyncio.sleep(10)


def publish(message):
    """Keeps the message in the history and sends it to every connected app"""
    record(message)
    now = time.time()
    history.append((now, message))
    while history and history[0][0] < now - HISTORY_SECONDS:
        history.pop(0)
    websockets.broadcast(clients, json.dumps({'message': message}))


# HISTORY OF OUR EQUIPMENT
def read_recorder():
    """The database where our equipment's positions are kept, or None if there is none"""
    global recorder_tried
    recorder_tried = time.time()
    try:
        return boia_db.connect()
    except Exception as error:  # Not reachable now: the app works without it
        print('❌ Database:', error)
        return None


def record(message):
    """Keeps the position, if it is of our equipment (not simulated)"""
    global recorder
    if message.get('MessageType') not in POSITION_MESSAGES or not boia_db.read_env('DATABASE_URL'):
        return
    metadata = message.get('MetaData') or {}
    mmsi = str(metadata.get('MMSI_String') or metadata.get('MMSI') or '')
    if metadata.get('Simulated') or not (mmsi in RECORDED_MMSI or mmsi.startswith(RECORDED_PREFIXES)):
        return
    lat, lon = metadata.get('latitude'), metadata.get('longitude')
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or abs(lat) > 90 or abs(lon) > 180:
        return
    when = parse_time(metadata.get('time_utc')) or time.time()
    report = (message.get('Message') or {}).get(message['MessageType']) or {}
    sog = report.get('Sog') if isinstance(report.get('Sog'), (int, float)) and report['Sog'] < 102.3 else None
    heading = report.get('TrueHeading')
    heading = heading if isinstance(heading, int) and 0 <= heading < 360 else None
    name = metadata.get('ShipName') or None
    source = 'bluelab' if mmsi.startswith('BLUEBOAT-') else 'aisstream'
    for attempt in range(2):  # Once more if the connection had dropped
        if recorder is None or recorder.closed:
            if time.time() - recorder_tried < RECONNECT_SECONDS:
                return
            recorder = read_recorder()
            if recorder is None:
                return
        try:
            recorder.execute('INSERT INTO platforms (id, name, kind, owner) VALUES (%s, %s, %s, %s) '
                             'ON CONFLICT (id) DO NOTHING',
                             (mmsi, name, 'vehicle' if source == 'bluelab' else 'boat', 'ICM-CSIC'))
            recorder.execute('INSERT INTO positions (platform, time, source, msg_type, lat, lon, sog, heading, name) '
                             'VALUES (%s, to_timestamp(%s), %s, 0, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING',
                             (mmsi, round(when), source, lat, lon, sog, heading, name))
            return
        except Exception as error:
            print('❌ History of our equipment:', error)
            recorder.close()


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


# BLUELAB'S FLEET (BlueBoats), from their public tracker. Everything that depends on its format is
# here: if it changes, only this needs adapting
def read_fleet_settings():
    """(tracker URL or None, max age in hours, excluded id prefixes, {id: name})"""
    url = (read_env('FLEET_URL') or '').strip().rstrip('/') or None
    hours = float(read_env('FLEET_MAX_HOURS') or 6)
    exclude = tuple(p.strip() for p in (read_env('FLEET_EXCLUDE') or 'sim-').split(',') if p.strip())
    names = {}
    for entry in (read_env('FLEET_NAMES') or '').split(','):
        device_id, _, name = entry.strip().partition(':')
        if device_id and name:
            names[device_id] = name
    return url, hours, exclude, names


def fleet_get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'boia-server'}), timeout=FLEET_TIMEOUT) as res:
        return json.loads(res.read())


def parse_time(text):
    """Seconds since 1970 of an ISO time (with Z, and maybe nanoseconds), or None"""
    try:
        text = str(text).replace('Z', '+00:00')
        # Python 3.10 (the server's) only takes 3 or 6 decimals
        text = re.sub(r'\.(\d+)', lambda m: '.' + (m.group(1) + '000000')[:6], text)
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


def set_fleet_up(up):
    """Tells the apps when the tracker starts or stops answering"""
    if fleet['up'] == up:
        return
    fleet['up'] = up
    print('✅ BlueLab fleet tracker answering' if up else '❌ BlueLab fleet tracker not answering')
    websockets.broadcast(clients, json.dumps({'fleet': fleet}))


def set_fleet_devices(devices):
    """Tells the apps when the list of vehicles, or their last data, changes"""
    if fleet['devices'] == devices:
        return
    fleet['devices'] = devices
    websockets.broadcast(clients, json.dumps({'fleet': fleet}))


def fleet_report(device_id, timestamp, data, settings, simulated=False):
    """Relays a BlueBoat's record (the tracker's fields) as AIS messages, if it is recent"""
    _, hours, exclude, names = settings
    lat, lon, when = data.get('frontseat_lat'), data.get('frontseat_lon'), parse_time(timestamp)
    if not device_id or device_id.startswith(exclude) or lat is None or lon is None or when is None:
        return
    if when < time.time() - hours * 3600:
        return
    previous = fleet_last.get(device_id)
    if previous and when <= previous[0]:
        return  # Already sent (the live feed and the periodic check overlap)
    # Speed from the previous position (they don't send it), if not too old
    speed = 0
    if previous and when - previous[0] < 15 * 60:
        north = (lat - previous[1]) * 111320
        east = (lon - previous[2]) * 111320 * math.cos(math.radians(lat))
        speed = math.hypot(north, east) / (when - previous[0]) / 0.514444
    fleet_last[device_id] = (when, lat, lon)
    heading = data.get('frontseat_heading')
    heading = round(heading) % 360 if isinstance(heading, (int, float)) and heading > 0 else 511
    mmsi = f'BLUEBOAT-{device_id}'
    telemetry = {key: data.get(key) for key in ('battery', 'lorawan_temp', 'frontseat_temp', 'backseat_temp')
                 if isinstance(data.get(key), (int, float))}
    metadata = {'MMSI_String': mmsi, 'ShipName': names.get(device_id, f'BlueBoat {device_id}'), 'latitude': lat,
                'longitude': lon, 'time_utc': datetime.fromtimestamp(when, timezone.utc).isoformat(),
                'Telemetry': telemetry}
    if simulated:
        metadata['Simulated'] = True
    if mmsi not in pati_static:
        pati_static[mmsi] = {'MessageType': 'ShipStaticData', 'MetaData': metadata,
                             'Message': {'ShipStaticData': {'Type': BLUEBOAT_TYPE, 'Dimension': BLUEBOAT_DIMENSION}}}
        publish(pati_static[mmsi])
    publish({'MessageType': 'PositionReport', 'MetaData': metadata,
             'Message': {'PositionReport': {'TrueHeading': heading, 'Sog': round(speed, 1)}}})


async def fleet_poll(settings):
    """Every few minutes: which vehicles there are, and the last record of the recent ones"""
    url, hours, exclude, _ = settings
    while True:
        try:
            devices = await asyncio.to_thread(fleet_get, f'{url}/api/devices')
            _, _, _, names = settings
            listed = []
            for device in devices:
                device_id = device.get('device_id') or ''
                seen = parse_time(device.get('last_seen'))
                if device_id.startswith(exclude) or seen is None:
                    continue
                listed.append({'id': f'BLUEBOAT-{device_id}', 'name': names.get(device_id, f'BlueBoat {device_id}'),
                               'last_seen': datetime.fromtimestamp(seen, timezone.utc).isoformat()})
                if seen < time.time() - hours * 3600:
                    continue
                records = await asyncio.to_thread(fleet_get, f'{url}/api/trajectory/{quote(device_id)}?limit=2')
                for record in records:
                    fleet_report(device_id, record.get('timestamp'), record, settings)
            set_fleet_devices(listed)
            set_fleet_up(True)
        except (OSError, ValueError, TypeError, AttributeError) as error:
            print('❌ BlueLab fleet tracker:', error)
            set_fleet_up(False)
        await asyncio.sleep(FLEET_POLL_SECONDS)


async def fleet_stream(settings):
    """Their live feed: each new record as it arrives. Reconnects when it drops"""
    ws_url = 'ws' + settings[0][len('http'):] + '/'
    while True:
        try:
            async with websockets.connect(ws_url, open_timeout=FLEET_TIMEOUT) as ws:
                print('✅ Connected to the BlueLab fleet tracker')
                set_fleet_up(True)
                async for raw in ws:
                    message = json.loads(raw)
                    if message.get('type') == 'telemetry' and isinstance(message.get('data'), dict):
                        fleet_report(message.get('deviceId'), message.get('timestamp'), message['data'], settings)
        except (OSError, ValueError, asyncio.TimeoutError, websockets.WebSocketException) as error:
            print('❌ BlueLab fleet live feed lost, retrying in 60 s:', error)
        # The feed ended or failed: whether the tracker itself still answers, so as not to wait for
        # the next periodic check to tell the apps
        try:
            await asyncio.to_thread(fleet_get, f'{settings[0]}/api/devices')
        except (OSError, ValueError):
            set_fleet_up(False)
        await asyncio.sleep(60)


# SIMULATED BOATS (SIMULATED_BOATS): a BlueBoat and/or a patí always out, to show the app
SIMULATORS = ('blueboat', 'pati')


def read_simulated_boats():
    """Which simulated boats are out, from SIMULATED_BOATS: "blueboat", "pati" (comma separated),
    or 1/true/yes for both"""
    value = (read_env('SIMULATED_BOATS') or '').lower().replace(' ', '')
    if value in ('1', 'true', 'yes'):
        return list(SIMULATORS)
    return [name for name in value.split(',') if name in SIMULATORS]


# A patí's loop from the Somorrostro beach, passing ~300 m west of the buoy (as tools/simulate_pati.py)
SIM_PATI_ROUTE = [(41.3790, 2.2110), (41.3757, 2.2125), (41.3722, 2.2050), (41.3770, 2.1985), (41.3835, 2.2010)]
# A BlueBoat's survey south-west of the buoy: parallel passes 60 m apart, back and forth
SIM_BLUEBOAT_ROUTE = [(41.3735 - i * 0.00054, lon) for i in range(5)
                      for lon in ((2.2100, 2.2150) if i % 2 == 0 else (2.2150, 2.2100))]


def route(waypoints, knots, every):
    """(lat, lon, bearing) along a closed route, one every `every` seconds at `knots`, forever"""
    step = knots * 0.514444 * every  # m
    while True:
        for (lat0, lon0), (lat1, lon1) in zip(waypoints, waypoints[1:] + waypoints[:1]):
            north = (lat1 - lat0) * 111320
            east = (lon1 - lon0) * 111320 * math.cos(math.radians(lat0))
            length = math.hypot(north, east)
            bearing = math.degrees(math.atan2(east, north)) % 360
            for i in range(max(1, int(length / step))):
                f = i * step / length
                yield lat0 + (lat1 - lat0) * f, lon0 + (lon1 - lon0) * f, bearing


async def simulate_pati():
    for lat, lon, bearing in route(SIM_PATI_ROUTE, 5, 2):
        publish_pati('simulat', 'Patí (simulat)', lat, lon, 5, round(bearing), datetime.now(timezone.utc).isoformat(),
                     simulated=True)
        await asyncio.sleep(2)


async def simulate_blueboat():
    """As the BlueLab's tracker would send it, every 10 s (theirs, about every minute)"""
    settings = (None, 1, (), {'simulat': 'BlueBoat (simulat)'})
    start = time.time()
    for lat, lon, bearing in route(SIM_BLUEBOAT_ROUTE, 2, 10):
        hours = (time.time() - start) / 3600
        data = {'frontseat_lat': lat, 'frontseat_lon': lon, 'frontseat_heading': bearing or 360,
                'battery': round(16.4 - (hours % 6) * 0.25, 2), 'lorawan_temp': 36.5}
        fleet_report('simulat', datetime.now(timezone.utc).isoformat(), data, settings, simulated=True)
        await asyncio.sleep(10)


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
    if mirror:
        try:
            answer = await asyncio.to_thread(mirror.answer, target, fetch_upstream)
            if answer:
                return answer
        except Exception as error:  # The copy must never break the proxy: the server, then
            print(f'❌ ERDDAP copy could not answer {target}: {error!r}')
    return await asyncio.to_thread(fetch_upstream, target)


def read_mirror():
    path = read_env('ERDDAP_MIRROR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'erddap_mirror.sqlite')
    return None if path == '0' else Mirror(path)


async def update_mirror():
    while True:
        try:
            added = await asyncio.to_thread(mirror.update)
            if added:
                print('ERDDAP copy:', ', '.join(f'{name} +{count}' for name, count in added.items()))
        except Exception as error:
            print(f'❌ ERDDAP copy not updated: {error!r}')
        await asyncio.sleep(MIRROR_SECONDS)


# INTRANET
INTRANET_MAX_BYTES = 200 * 1024 * 1024


def buoy_status(db):
    """The buoy's AIS history in the database"""
    count, fixes, first, last = db.execute(
        "SELECT count(*), count(*) FILTER (WHERE accuracy), min(time), max(time) FROM positions "
        "WHERE platform = %s AND source = %s", (buoy_ais.MMSI, buoy_ais.SOURCE)).fetchone()
    return {'count': count, 'fixes': fixes, 'first': first and first.isoformat(), 'last': last and last.isoformat()}


def buoy_upload(text):
    """Adds a TUGEMI CSV of the buoy, writes its files for the app again; what it did"""
    db = boia_db.connect()
    try:
        rows = buoy_ais.read_csv(text)
        if not rows:
            raise ValueError(f'no positions of the buoy (MMSI {buoy_ais.MMSI}) in it')
        new = buoy_ais.add(db, rows)
        data = buoy_ais.export(db)
        print(f'Intranet: buoy CSV, {len(rows)} rows, {new} new; ' + buoy_ais.summary(data))
        return {'read': len(rows), 'new': new, 'from': min(r[0] for r in rows).astimezone(timezone.utc).isoformat(),
                'to': max(r[0] for r in rows).astimezone(timezone.utc).isoformat(), 'status': buoy_status(db),
                'position': data['position'], 'mooring': data['mooring']}
    finally:
        db.close()


def buoy_read():
    db = boia_db.connect()
    try:
        status = buoy_status(db)
    finally:
        db.close()
    try:
        with open(os.path.join(buoy_ais.data_dir(), 'buoy_ais.json')) as file:
            data = json.load(file)
        status.update(position=data.get('position'), mooring=data.get('mooring'))
    except (OSError, ValueError):
        pass
    return status


async def intranet(method, path, headers, body, peer):
    """(status code, content type, body) of an intranet request"""
    def answer(code, data):
        return code, 'application/json', json.dumps(data).encode()
    local = (read_env('INTRANET_LOCAL') or '') == '1' and peer in ('127.0.0.1', '::1')
    if not headers.get('x-intranet-user') and not local:
        return answer(401, {'error': 'login required'})
    if not read_env('DATABASE_URL'):
        return answer(503, {'error': 'no database'})
    try:
        if method == 'GET' and path == '/intranet/api/buoy':
            return answer(200, await asyncio.to_thread(buoy_read))
        if method == 'POST' and path == '/intranet/api/buoy-csv':
            if not body:
                return answer(400, {'error': 'empty file'})
            return answer(200, await asyncio.to_thread(buoy_upload, body.decode('utf-8-sig', errors='replace')))
    except ValueError as error:
        return answer(400, {'error': str(error)})
    except Exception as error:
        print('❌ Intranet:', error)
        return answer(500, {'error': str(error)})
    return answer(404, {'error': 'not found'})


# CONDITIONS
CONDITIONS_SECONDS = 3600
CONDITIONS_PAST_DAYS = 3  # Read again each time
CONDITIONS_FIRST_DAYS = 92  # The first time: all Open-Meteo gives
WAVE_VARIABLES = ['wave_height', 'wave_direction', 'wind_wave_height', 'wind_wave_direction', 'swell_wave_height',
                  'swell_wave_direction', 'secondary_swell_wave_height', 'secondary_swell_wave_direction']
WIND_VARIABLES = ['wind_speed_10m', 'wind_direction_10m']
# source -> (URL, variables); as Canvas3D.loadWaveForecast and the app's Open-Meteo weather forecast
CONDITION_SOURCES = {
    'open-meteo-marine': ('https://marine-api.open-meteo.com/v1/marine', WAVE_VARIABLES),
    'open-meteo-meteofrance': ('https://api.open-meteo.com/v1/meteofrance', WIND_VARIABLES),
}
CONDITIONS_AT = (41.37698, 2.216858)  # The buoy's mooring


def record_conditions():
    """Reads the past hours of each source and keeps them; how many values"""
    db = boia_db.connect()
    try:
        count = 0
        for source, (url, variables) in CONDITION_SOURCES.items():
            any_kept = db.execute('SELECT 1 FROM conditions WHERE source = %s LIMIT 1', (source,)).fetchone()
            days = CONDITIONS_PAST_DAYS if any_kept else CONDITIONS_FIRST_DAYS
            query = (f'?latitude={CONDITIONS_AT[0]}&longitude={CONDITIONS_AT[1]}&hourly={",".join(variables)}'
                     f'&past_days={days}&forecast_days=1&wind_speed_unit=ms&timezone=UTC')
            request = urllib.request.Request(url + query, headers={'User-Agent': 'boia-somorrostro (SIO ICM-CSIC)'})
            with urllib.request.urlopen(request, timeout=60) as response:
                hourly = json.load(response)['hourly']
            now = datetime.now(timezone.utc)
            rows = []
            for i, hour in enumerate(hourly['time']):
                when = datetime.fromisoformat(hour).replace(tzinfo=timezone.utc)
                if when > now:
                    continue  # Only what has happened: the forecast is not kept
                rows += [(when, source, variable, hourly[variable][i]) for variable in variables
                         if hourly.get(variable) and hourly[variable][i] is not None]
            with db.cursor() as cursor:
                cursor.executemany('INSERT INTO conditions VALUES (%s, %s, %s, %s) '
                                   'ON CONFLICT (time, source, variable) DO UPDATE SET value = EXCLUDED.value', rows)
            count += len(rows)
        return count
    finally:
        db.close()


async def update_conditions():
    while True:
        try:
            await asyncio.to_thread(record_conditions)
        except Exception as error:
            print(f'❌ Conditions not recorded: {error!r}')
        await asyncio.sleep(CONDITIONS_SECONDS)


def history_conditions(query):
    """The sea and the wind at the buoy the hour of a moment (the closest within 3 h)"""
    at = parse_time({key: values[0] for key, values in parse_qs(query).items()}.get('at'))
    if at is None:
        raise ValueError('at: an ISO time')
    db = boia_db.connect()
    try:
        rows = db.execute(
            'SELECT DISTINCT ON (source, variable) source, variable, value, extract(epoch FROM time)::bigint '
            'FROM conditions WHERE time BETWEEN to_timestamp(%s) - interval \'3 hours\' AND to_timestamp(%s) + interval \'3 hours\' '
            'ORDER BY source, variable, abs(extract(epoch FROM time) - %s)', (at, at, at)).fetchall()
    finally:
        db.close()
    values = {variable: value for _, variable, value, _ in rows}
    return {'time': min((t for *_, t in rows), key=lambda t: abs(t - at), default=None), 'values': values}


# HISTORY
HISTORY_MAX_DAYS = 3
HISTORY_POINTS = 3000  # Per platform at most
HISTORY_MIN_STEP = 20  # s
HISTORY_CACHE_SECONDS = 60
# The positions that tell where it was: the buoy's AIS also sends its charted position
HISTORY_WHERE = "(source <> 'tugemi' OR accuracy)"


def history_summary():
    db = boia_db.connect()
    try:
        rows = db.execute(
            'SELECT p.platform, pl.name, pl.kind, min(p.time), max(p.time), '
            "array_agg(DISTINCT to_char(p.time AT TIME ZONE 'UTC', 'YYYY-MM-DD')) "
            f'FROM positions p JOIN platforms pl ON pl.id = p.platform WHERE {HISTORY_WHERE} '
            'GROUP BY p.platform, pl.name, pl.kind ORDER BY p.platform').fetchall()
    finally:
        db.close()
    return {'platforms': [{'id': id, 'name': name, 'kind': kind, 'first': first.isoformat(), 'last': last.isoformat(),
                           'days': sorted(days)} for id, name, kind, first, last, days in rows]}


def history_positions(query):
    params = {key: values[0] for key, values in parse_qs(query).items()}
    start, end = parse_time(params.get('from')), parse_time(params.get('to'))
    if start is None or end is None or end <= start:
        raise ValueError('from and to: ISO times, from before to')
    end = min(end, start + HISTORY_MAX_DAYS * 86400)
    step = max(HISTORY_MIN_STEP, math.ceil((end - start) / HISTORY_POINTS))
    db = boia_db.connect()
    try:
        rows = db.execute(
            "SELECT platform, extract(epoch FROM date_bin(make_interval(secs => %s), time, 'epoch'))::bigint t, "
            'percentile_cont(0.5) WITHIN GROUP (ORDER BY lat), percentile_cont(0.5) WITHIN GROUP (ORDER BY lon), '
            'avg(sog), (array_agg(heading ORDER BY time DESC) FILTER (WHERE heading IS NOT NULL))[1] '
            f'FROM positions WHERE {HISTORY_WHERE} AND time >= to_timestamp(%s) AND time < to_timestamp(%s) '
            'GROUP BY 1, 2 ORDER BY 1, 2', (step, start, end)).fetchall()
    finally:
        db.close()
    tracks = {}
    for platform, t, lat, lon, sog, heading in rows:
        track = tracks.setdefault(platform, {'t': [], 'lat': [], 'lon': [], 'sog': [], 'heading': []})
        track['t'].append(t)
        track['lat'].append(round(lat, 6))
        track['lon'].append(round(lon, 6))
        track['sog'].append(None if sog is None else round(sog, 1))
        track['heading'].append(heading)
    return {'from': start, 'to': end, 'step': step, 'tracks': tracks}


async def history_answer(path, query):
    """(status code, body) of a history request"""
    def answer(code, data):
        return code, json.dumps(data, separators=(',', ':')).encode()
    if not read_env('DATABASE_URL'):
        return answer(503, {'error': 'no database'})
    key = (path, query)
    cached = history_cache.get(key)
    if cached and cached[0] > time.time() - HISTORY_CACHE_SECONDS:
        return 200, cached[1]
    try:
        if path == '/history/summary':
            code, body = answer(200, await asyncio.to_thread(history_summary))
        elif path == '/history/positions':
            code, body = answer(200, await asyncio.to_thread(history_positions, query))
        elif path == '/history/conditions':
            code, body = answer(200, await asyncio.to_thread(history_conditions, query))
        else:
            return answer(404, {'error': 'not found'})
    except ValueError as error:
        return answer(400, {'error': str(error)})
    except Exception as error:
        print('❌ History:', error)
        return answer(500, {'error': 'database'})
    for old in [k for k, (at, _) in history_cache.items() if at < time.time() - HISTORY_CACHE_SECONDS]:
        del history_cache[old]
    history_cache[key] = (time.time(), body)
    return code, body


history_cache = {}  # (path, query) -> (when, body)


# HTTP PORT: the proxy, patí positions, the intranet and the history
async def http_handler(reader, writer, devices, origins):
    status, content_type, body_out, extra = '400 Bad Request', 'text/plain', b'', ''
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 10)
        lines = head.decode(errors='ignore').split('\r\n')
        method, path = lines[0].split(' ')[:2]
        headers = {k.strip().lower(): v.strip() for k, _, v in (line.partition(':') for line in lines[1:] if line)}
        length = int(headers.get('content-length', 0) or 0)
        if length > INTRANET_MAX_BYTES:
            raise ValueError('too big')
        body = await asyncio.wait_for(reader.readexactly(length), 300)
        origin = headers.get('origin')
        if origin in origins:
            extra = f'Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n'
        if urlsplit(path).path.startswith('/intranet/api/'):
            peer = (writer.get_extra_info('peername') or ('',))[0]
            code, content_type, body_out = await intranet(method, urlsplit(path).path, headers, body, peer)
            status = f'{code} {"OK" if code == 200 else "Error"}'
            extra += 'Cache-Control: no-store\r\n'
        elif urlsplit(path).path.startswith('/history/'):
            code, body_out = await history_answer(urlsplit(path).path, urlsplit(path).query)
            content_type = 'application/json'
            status = f'{code} {"OK" if code == 200 else "Error"}'
            extra += 'Cache-Control: public, max-age=60\r\n'
        elif urlsplit(path).path.rstrip('/').endswith('/proxy'):
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


def publish_pati(device_id, name, lat, lon, speed, bearing, when, simulated=False):
    """Relays a patí's position as AIS messages: its static data the first time"""
    mmsi = f'PATI-{device_id}'
    metadata = {'MMSI_String': mmsi, 'ShipName': name, 'latitude': lat, 'longitude': lon, 'time_utc': when}
    if simulated:
        metadata['Simulated'] = True
    if mmsi not in pati_static:
        pati_static[mmsi] = {'MessageType': 'ShipStaticData', 'MetaData': metadata,
                             'Message': {'ShipStaticData': {'Type': PATI_TYPE, 'Dimension': PATI_DIMENSION}}}
        publish(pati_static[mmsi])
    publish({'MessageType': 'PositionReport', 'MetaData': metadata,
             'Message': {'PositionReport': {'TrueHeading': bearing, 'Sog': round(speed, 1)}}})


def pati_report(path, body, devices):
    """Relays a phone's position as AIS messages; returns the HTTP status"""
    try:
        device_id, lat, lon, speed, bearing, when = pati_fix(path, body)
        if device_id not in devices:
            print(f'⛔ Patí: unknown device {device_id!r}')
            return '403 Forbidden'
        publish_pati(device_id, devices[device_id], lat, lon, speed, bearing, when)
        return '200 OK'
    except (ValueError, KeyError, IndexError):
        return '400 Bad Request'


async def client_handler(ws, path=None):
    clients.add(ws)
    try:
        await ws.send(json.dumps({'bboxes': BBOXES}))
        if fleet['url']:
            await ws.send(json.dumps({'fleet': fleet}))
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
        fleet_settings = read_fleet_settings()
        fleet['url'] = fleet_settings[0]
        if fleet['url']:
            print('BlueLab fleet tracker:', fleet['url'])
            asyncio.create_task(fleet_poll(fleet_settings))
            asyncio.create_task(fleet_stream(fleet_settings))
        global recorder
        recorder = read_recorder()
        if recorder:
            print('History of our equipment: in the database', recorder.info.dbname)
            asyncio.create_task(update_conditions())
        global mirror
        mirror = read_mirror()
        if mirror:
            print('ERDDAP copy of the buoys:', mirror.path)
            asyncio.create_task(update_mirror())
        simulated = read_simulated_boats()
        if simulated:
            print('Simulated boats out:', ', '.join(simulated))
        if 'pati' in simulated:
            asyncio.create_task(simulate_pati())
        if 'blueboat' in simulated:
            asyncio.create_task(simulate_blueboat())
        await upstream(api_key)


if __name__ == '__main__':
    args = [int(arg) for arg in sys.argv[1:3]]
    asyncio.run(main(*(args + [8766, 8767][len(args):])))
