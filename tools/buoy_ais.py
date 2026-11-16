"""The buoy's AIS history: its positions as an aid to navigation (MMSI 992241239, "ODAS SOMORROSTRO"),
which aisstream.io doesn't relay. Downloaded by hand as CSV from the UPC's TUGEMI AIS database
(https://ais.fnb.upc.edu/database/multi-info: "By Multi MMSIs", all fields, CSV), which only lets
people query it (reCAPTCHA).

Every CSV given is added to an SQLite file (AIS_HISTORY, ais_history.sqlite next to the repo's
root by default; not in git), without repeating the rows already there, so the downloads may
overlap. Then data/StaticData/buoy_ais.json is written again from all of it, for the map (see
MapBuoyLocation.drawBuoyAIS).

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

Usage: python3 tools/buoy_ais.py [file.csv ...]   (no files: only writes the JSON again)
"""
import csv
import json
import math
import os
import sqlite3
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DB = os.environ.get('AIS_HISTORY') or os.path.join(ROOT, 'ais_history.sqlite')
OUT = os.path.join(ROOT, 'data', 'StaticData', 'buoy_ais.json')
MMSI = 992241239
MOORING_DAYS = 30
MOORED_WITHIN = 500  # m: a day whose median position is this close to the mooring, out there
OUTLIER = 400  # m from the mooring: a bad GPS fix (some are kilometres off)
CELL = 5  # m
GAP_HOURS = 6


def connect():
    db = sqlite3.connect(DB)
    db.execute('''CREATE TABLE IF NOT EXISTS positions (
        mmsi INTEGER, time INTEGER, msg_type INTEGER, lat REAL, lon REAL, accuracy INTEGER, name TEXT,
        PRIMARY KEY (mmsi, time, msg_type))''')
    return db


def add(db, path):
    """The CSV's rows, added; how many were new"""
    def number(text):
        return float(text) if text not in ('', None) else None
    rows = []
    with open(path, newline='') as file:
        for row in csv.DictReader(line for line in file if not line.startswith('#')):
            # "2026-03-26 15:48:21 UTC+0100"
            when = datetime.strptime(row['receiver_timestamp'].replace(' UTC', ' '), '%Y-%m-%d %H:%M:%S %z')
            accuracy = {'True': 1, 'False': 0}.get(row.get('accuracy'))
            rows.append((int(row['mmsi']), int(when.timestamp()), int(row['msg_type'] or 0),
                         number(row['lat']), number(row['lon']), accuracy, row.get('name') or None))
    before = db.total_changes
    db.executemany('INSERT OR IGNORE INTO positions VALUES (?, ?, ?, ?, ?, ?, ?)', rows)
    db.commit()
    return len(rows), db.total_changes - before


def metres(lat, lon, lat0, lon0):
    """(east, north) of a position from another, m"""
    return (lon - lon0) * 111320 * math.cos(math.radians(lat0)), (lat - lat0) * 111320


def percentile(values, p):
    return values[min(len(values) - 1, int(len(values) * p))]


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def export(db):
    rows = db.execute('SELECT time, lat, lon, name FROM positions WHERE mmsi = ? AND accuracy = 1 ORDER BY time',
                      (MMSI,)).fetchall()
    charted = db.execute('SELECT lat, lon, count(*) n FROM positions WHERE mmsi = ? AND accuracy = 0 '
                         'GROUP BY lat, lon ORDER BY n DESC LIMIT 1', (MMSI,)).fetchone()
    names = [row[0] for row in db.execute('SELECT name FROM positions WHERE mmsi = ? AND name IS NOT NULL ORDER BY time', (MMSI,))]
    times = [row[0] for row in db.execute('SELECT time FROM positions WHERE mmsi = ? ORDER BY time', (MMSI,))]
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
        'mmsi': MMSI,
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
    with open(OUT, 'w') as file:
        json.dump(data, file, separators=(',', ':'))
    return data


if __name__ == '__main__':
    db = connect()
    for path in sys.argv[1:]:
        read, new = add(db, path)
        print(f'{os.path.basename(path)}: {read} rows, {new} new')
    data = export(db)
    m = data['mooring']
    print(f"{data['count']} positions, {data['first']} to {data['last']}; moored at {m['lat']}, {m['lon']} "
          f"since {m['since']}, swinging p50 {m['p50']} m, p90 {m['p90']} m ({m['outliers']} bad fixes left out); "
          f"{len(data['cells'])} cells, {len(data['gaps'])} gaps; {os.path.getsize(OUT) // 1024} KB")
