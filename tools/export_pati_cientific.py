"""Exports the Patí Científic's temperature profiles (2021-2022) from the old IoT project's API
(iot-dashboard, on iot.icm.csic.es:8000) to data/StaticData/pati_cientific.json, so the app
doesn't depend on that API or its database. Run once; the data doesn't change.

Each profile comes from its own open dataset on Zenodo (its DOI is kept). Its date comes from
the original file's name: some sensors' clocks were wrong (year 2000). The profiles are grouped
into stations by position (the original labels are not consistent), and each one is reduced to
the mean temperature every BIN metres of depth.

Usage, from a computer that reaches the server (CMIMA VPN):
    ssh -fN -L 18000:localhost:8000 bardaji@iot.icm.csic.es
    python3 tools/export_pati_cientific.py http://localhost:18000/api/v1
"""
import json
import math
import os
import re
import sys
import urllib.request
from collections import defaultdict

API = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8000/api/v1'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'StaticData', 'pati_cientific.json')
BIN = 0.5  # m
STATION_RADIUS = 250  # m: profiles closer than this to a station's centre belong to it
MIN_PROFILES = 10  # A regular station, numbered; fewer, profiles taken there once or twice


def get(path):
    with urllib.request.urlopen(API + path, timeout=60) as response:
        return json.load(response)


def distance(a, b):
    """Metres between two (lat, lon)"""
    dy = (a[0] - b[0]) * 111195
    dx = (a[1] - b[1]) * 111195 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def profile(sensor):
    meta = sensor['metadata']
    found = re.search(r'_(\d{4})(\d{2})(\d{2})_', meta['source_file'])
    date = f'{found[1]}-{found[2]}-{found[3]}'
    records = get(f"/data/{sensor['id']}?limit=1000")["data"]  # The API's most; profiles have fewer than 500
    assert len(records) < 1000, f"{meta['source_file']}: more than 1000 records"
    bins = defaultdict(list)
    for record in records:
        values = record['data']
        if values.get('depth') is None or values.get('temperature') is None or values['depth'] < 0:
            continue
        bins[round(values['depth'] / BIN)].append(values['temperature'])
    # The time of day only if the sensor's clock was right
    times = sorted(r['timestamp'] for r in records if r['timestamp'][:10] == date)
    levels = sorted(bins)
    return {
        'date': date, 'time': times[0][11:16] if times else None,
        'lat': meta['fix_lat'], 'lon': meta['fix_lon'], 'doi': meta['dataset_doi'],
        'depth': [round(level * BIN, 2) for level in levels],
        'temperature': [round(sum(bins[level]) / len(bins[level]), 2) for level in levels],
    }


def main():
    sensors = [s for s in get('/sensors/') if s['metadata'].get('data_source') == 'PATI_CIENTIFIC_TD']
    profiles = []
    for n, sensor in enumerate(sensors, 1):
        profiles.append(profile(sensor))
        print(f'\r{n}/{len(sensors)}', end='', flush=True, file=sys.stderr)
    print()

    # Stations: each profile joins the nearest one within STATION_RADIUS, or starts a new one
    stations = []
    for p in sorted(profiles, key=lambda p: p['date']):
        position = (p['lat'], p['lon'])
        near = [s for s in stations if distance(position, s['centre']) < STATION_RADIUS]
        station = min(near, key=lambda s: distance(position, s['centre'])) if near else None
        if station is None:
            station = {'profiles': []}
            stations.append(station)
        station['profiles'].append(p)
        station['centre'] = (sum(q['lat'] for q in station['profiles']) / len(station['profiles']),
                             sum(q['lon'] for q in station['profiles']) / len(station['profiles']))
    # The regular stations (MIN_PROFILES or more) numbered from west to east; the few profiles
    # taken elsewhere are kept too, with no number (id null)
    stations.sort(key=lambda s: s['centre'][1])
    number = 0
    for s in stations:
        if len(s['profiles']) >= MIN_PROFILES:
            number += 1
            s['id'] = number
        else:
            s['id'] = None
    result = {
        'source': 'Patí Científic (ICM-CSIC), temperature and depth sensor. Each profile, an open dataset on Zenodo (doi)',
        'bin': BIN,
        'stations': [{
            'id': s['id'], 'lat': round(s['centre'][0], 5), 'lon': round(s['centre'][1], 5),
            'profiles': sorted(s['profiles'], key=lambda p: (p['date'], p['time'] or '')),
        } for s in stations],
    }
    with open(OUT, 'w') as out:
        json.dump(result, out, ensure_ascii=False, separators=(',', ':'))
    for s in result['stations']:
        dates = [p['date'] for p in s['profiles']]
        print(f"Station {s['id']}: {len(dates)} profiles at {s['lat']}, {s['lon']}, {min(dates)} → {max(dates)}")
    print('→', os.path.normpath(OUT), os.path.getsize(OUT) // 1024, 'kB')


if __name__ == '__main__':
    main()
