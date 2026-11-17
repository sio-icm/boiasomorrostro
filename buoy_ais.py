"""The buoy's AIS history: its positions as an aid to navigation (MMSI 992241239, "ODAS SOMORROSTRO"),
which aisstream.io doesn't relay. Downloaded by hand as CSV from the UPC's TUGEMI AIS database
(https://ais.fnb.upc.edu/database/multi-info: "By Multi MMSIs", all fields, CSV), which only lets
people query it (reCAPTCHA), and uploaded on the intranet (boia_server.py) or given to this script.

Every CSV is added to the SIO database (boia_db.py: table positions, source "tugemi"), without
repeating the rows already there, so the downloads may overlap. Then the buoy's files for the app
are written again from all of it, in DATA_DIR (BUOY_DATA_DIR in .env; data/StaticData by default):
buoy_ais.json, for the map (see MapBuoyLocation.drawBuoyAIS).

Its AIS sends two positions: mostly a fixed one (accuracy False), its charted position, always the
same; and about one report in five, its GPS fix (accuracy True), where it really is. Only these
tell where it is and how it swings:
  charted  the fixed position
  mooring  where the buoy is moored now (median of its GPS fixes of the last MOORING_DAYS days),
           since when it is out there (its daily positions near it ever since: before, the AIS was
           in the Port Olímpic), and how far it swings around it (p50, p90, p99 of the distances, m)
  cells    how many positions in each CELL x CELL m around the mooring, since then: [east, north, n]
  days     its median position each day, all of them (its deployment from the Port Olímpic): [date, lat, lon, n]
  gaps     when it didn't transmit for more than GAP_HOURS: [from, to] (ISO, UTC)
  position its last known position: the median of its GPS fixes of the last LAST_MINUTES before
           the last one (one fix alone may be a bad one)
And buoy_ais_track.json, how it moves, for the map's time bar: a position every STEP s (the median
of the GPS fixes in it; none, no position), as whole decimetres east and north of the mooring:
{start, step, lat, lon, i: [step number...], e: [...], n: [...]}
And buoy_position.js, its last known position, where the app puts the buoy (main.js).

Usage: python3 buoy_ais.py [file.csv ...]          (no files: only writes the files again)
       python3 buoy_ais.py --sqlite ais_history.sqlite   (the history kept before, in SQLite)
"""
import csv
import io
import json
import math
import os
import sqlite3
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone

import boia_db

ROOT = os.path.dirname(os.path.abspath(__file__))
MMSI = '992241239'
SOURCE = 'tugemi'
FILES = ('buoy_ais.json', 'buoy_ais_track.json', 'buoy_position.js')
MOORING_DAYS = 30
MOORED_WITHIN = 500  # m: a day whose median position is this close to the mooring, out there
OUTLIER = 400  # m from the mooring: a bad GPS fix (some are kilometres off)
CELL = 5  # m
GAP_HOURS = 6
LAST_MINUTES = 60
STEP = 600  # s


def data_dir():
    return boia_db.read_env('BUOY_DATA_DIR') or os.path.join(ROOT, 'data', 'StaticData')


def read_csv(text):
    """The CSV's rows (text of a TUGEMI download): (time, msg_type, lat, lon, accuracy, name), only
    the buoy's and with a position. ValueError if it isn't one"""
    def number(value):
        return float(value) if value not in ('', None) else None
    reader = csv.DictReader(line for line in io.StringIO(text) if not line.startswith('#'))
    missing = {'mmsi', 'lat', 'lon', 'receiver_timestamp', 'msg_type'} - set(reader.fieldnames or [])
    if missing:
        raise ValueError('not a TUGEMI AIS download: no ' + ', '.join(sorted(missing)))
    rows = []
    for row in reader:
        lat, lon = number(row['lat']), number(row['lon'])
        if row['mmsi'].strip() != MMSI or lat is None or lon is None:
            continue
        # "2026-03-26 15:48:21 UTC+0100"
        when = datetime.strptime(row['receiver_timestamp'].replace(' UTC', ' '), '%Y-%m-%d %H:%M:%S %z')
        accuracy = {'True': True, 'False': False}.get(row.get('accuracy'))
        rows.append((when, int(row['msg_type'] or 0), lat, lon, accuracy, row.get('name') or None))
    return rows


def add(db, rows):
    """Adds the rows ((time, msg_type, lat, lon, accuracy, name)) to the database; how many were new"""
    with db.transaction():
        db.execute('CREATE TEMP TABLE IF NOT EXISTS new_positions (time timestamptz, msg_type smallint, '
                   'lat double precision, lon double precision, accuracy boolean, name text)')
        db.execute('TRUNCATE new_positions')
        with db.cursor().copy('COPY new_positions FROM STDIN') as copy:
            for row in rows:
                copy.write_row(row)
        new = db.execute('INSERT INTO positions (platform, time, source, msg_type, lat, lon, accuracy, name) '
                         'SELECT %s, time, %s, msg_type, lat, lon, accuracy, name FROM new_positions '
                         'ON CONFLICT DO NOTHING', (MMSI, SOURCE)).rowcount
    return new


def from_sqlite(path):
    """The rows of the SQLite history kept before (tools/buoy_ais.py)"""
    old = sqlite3.connect(path)
    return [(datetime.fromtimestamp(t, timezone.utc), msg_type, lat, lon, None if accuracy is None else bool(accuracy), name)
            for t, msg_type, lat, lon, accuracy, name in old.execute(
                'SELECT time, msg_type, lat, lon, accuracy, name FROM positions WHERE mmsi = ? AND lat IS NOT NULL', (int(MMSI),))]


def metres(lat, lon, lat0, lon0):
    """(east, north) of a position from another, m"""
    return (lon - lon0) * 111320 * math.cos(math.radians(lat0)), (lat - lat0) * 111320


def percentile(values, p):
    return values[min(len(values) - 1, int(len(values) * p))]


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def export(db, out=None):
    """Writes the buoy's files for the app in out (data_dir()) from all its history; its summary"""
    out = out or data_dir()
    epoch = 'extract(epoch FROM time)::bigint'
    where = "platform = %s AND source = %s"
    rows = db.execute(f'SELECT {epoch}, lat, lon, name FROM positions WHERE {where} AND accuracy ORDER BY time',
                      (MMSI, SOURCE)).fetchall()
    if not rows:
        raise ValueError('no GPS fixes of the buoy in the database')
    charted = db.execute(f'SELECT lat, lon, count(*) n FROM positions WHERE {where} AND NOT accuracy '
                         'GROUP BY lat, lon ORDER BY n DESC LIMIT 1', (MMSI, SOURCE)).fetchone()
    names = [row[0] for row in db.execute(f'SELECT name FROM positions WHERE {where} AND name IS NOT NULL ORDER BY time',
                                          (MMSI, SOURCE))]
    times = [row[0] for row in db.execute(f'SELECT {epoch} FROM positions WHERE {where} ORDER BY time', (MMSI, SOURCE))]
    last = rows[-1][0]

    # Where it is moored now, and since when
    recent = [row for row in rows if row[0] > last - MOORING_DAYS * 86400]
    lat0 = statistics.median(row[1] for row in recent)
    lon0 = statistics.median(row[2] for row in recent)
    by_day = defaultdict(list)
    for t, lat, lon, _ in rows:
        by_day[datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%d')].append((lat, lon))
    days = []
    for day, positions in sorted(by_day.items()):
        lat, lon = statistics.median(p[0] for p in positions), statistics.median(p[1] for p in positions)
        days.append([day, round(lat, 6), round(lon, 6), len(positions)])
    since = days[-1][0]
    for day in reversed(days):
        if math.hypot(*metres(day[1], day[2], lat0, lon0)) > MOORED_WITHIN:
            break
        since = day[0]

    # How far it swings, and where it spends its time, since then
    start = datetime.strptime(since, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp()
    distances, cells, outliers = [], defaultdict(int), 0
    for t, lat, lon, _ in rows:
        if t < start:
            continue
        east, north = metres(lat, lon, lat0, lon0)
        distance = math.hypot(east, north)
        if distance > OUTLIER:
            outliers += 1
            continue
        distances.append(distance)
        cells[(math.floor(east / CELL), math.floor(north / CELL))] += 1
    distances.sort()

    gaps = [[iso(a), iso(b)] for a, b in zip(times, times[1:]) if b - a > GAP_HOURS * 3600]
    data = {
        'mmsi': int(MMSI),
        'name': names[-1] if names else None,
        'source': 'TUGEMI AIS database, UPC (ais.fnb.upc.edu)',
        'first': iso(times[0]), 'last': iso(times[-1]), 'count': len(times), 'fixes': len(rows),
        'charted': {'lat': charted[0], 'lon': charted[1]} if charted else None,
        'mooring': {
            'lat': round(lat0, 6), 'lon': round(lon0, 6), 'since': since,
            'count': len(distances), 'outliers': outliers,
            'p50': round(percentile(distances, 0.5)), 'p90': round(percentile(distances, 0.9)),
            'p99': round(percentile(distances, 0.99)),
        },
        'cell': CELL,
        'cells': sorted([x * CELL, y * CELL, n] for (x, y), n in cells.items()),
        'days': days,
        'gaps': gaps,
    }
    # Its last known position
    latest = [row for row in rows if row[0] > last - LAST_MINUTES * 60]
    data['position'] = {'time': iso(last), 'lat': round(statistics.median(row[1] for row in latest), 6),
                    'lon': round(statistics.median(row[2] for row in latest), 6)}
    os.makedirs(out, exist_ok=True)
    write(out, 'buoy_ais.json', json.dumps(data, separators=(',', ':')))
    write(out, 'buoy_position.js', "// Written by buoy_ais.py: the buoy's last known position, from its AIS (GPS fixes)\n"
          f"export default {json.dumps(data['position'])};\n")

    # How it moves: a position every STEP s
    start = rows[0][0] - rows[0][0] % STEP
    steps = defaultdict(list)
    for t, lat, lon, _ in rows:
        steps[(t - start) // STEP].append(metres(lat, lon, lat0, lon0))
    track = {'start': start, 'step': STEP, 'lat': data['mooring']['lat'], 'lon': data['mooring']['lon'], 'i': [], 'e': [], 'n': []}
    for i, positions in sorted(steps.items()):
        track['i'].append(i)
        track['e'].append(round(statistics.median(p[0] for p in positions) * 10))
        track['n'].append(round(statistics.median(p[1] for p in positions) * 10))
    write(out, 'buoy_ais_track.json', json.dumps(track, separators=(',', ':')))
    data['track'] = len(track['i'])
    return data


def write(out, name, text):
    """Writes a file whole: to a temporary one first, so the web never serves it half written"""
    path = os.path.join(out, name)
    with open(path + '.tmp', 'w') as file:
        file.write(text)
    os.replace(path + '.tmp', path)


def summary(data):
    m = data['mooring']
    return (f"{data['count']} positions, {data['first']} to {data['last']}; moored at {m['lat']}, {m['lon']} "
            f"since {m['since']}, swinging p50 {m['p50']} m, p90 {m['p90']} m ({m['outliers']} bad fixes left out); "
            f"{len(data['cells'])} cells, {len(data['gaps'])} gaps; "
            f"last at {data['position']['lat']}, {data['position']['lon']} ({data['position']['time']}); "
            f"track of {data['track']} steps")


if __name__ == '__main__':
    db = boia_db.connect()
    if db is None:
        sys.exit('No database: set DATABASE_URL (see boia_db.py)')
    args = sys.argv[1:]
    if args[:1] == ['--sqlite']:
        rows = from_sqlite(args[1])
        print(f'{args[1]}: {len(rows)} rows, {add(db, rows)} new')
        args = args[2:]
    for path in args:
        with open(path, newline='') as file:
            rows = read_csv(file.read())
        print(f'{os.path.basename(path)}: {len(rows)} rows, {add(db, rows)} new')
    print(summary(export(db)), 'in', data_dir())
