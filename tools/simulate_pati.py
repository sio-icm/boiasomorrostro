#!/usr/bin/env python3
"""Sails a simulated patí de vela off the Barceloneta, sending its positions to boia_server.py
as the Traccar Client phone app would (OsmAnd protocol), so the whole path can be tested on land.

Usage: python3 tools/simulate_pati.py [relay patí URL]   (default http://localhost:8767/)
Stop it with Ctrl+C.
"""
import math
import sys
import time
import urllib.request
from urllib.parse import urlencode

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8767/'
DEVICE_ID = 'simulador'
SPEED = 5.0      # knots
EVERY = 2.0      # seconds between positions
# A loop from the Somorrostro beach, passing ~300 m west of the buoy (41.3757 N, 2.2162 E)
WAYPOINTS = [
    (41.3835, 2.2010),
    (41.3790, 2.2110),
    (41.3757, 2.2125),
    (41.3722, 2.2050),
    (41.3770, 2.1985),
]


def legs():
    """Positions along the loop, one every EVERY seconds at SPEED, forever"""
    step = SPEED * 0.514444 * EVERY  # m
    while True:
        for (lat0, lon0), (lat1, lon1) in zip(WAYPOINTS, WAYPOINTS[1:] + WAYPOINTS[:1]):
            north = (lat1 - lat0) * 111320
            east = (lon1 - lon0) * 111320 * math.cos(math.radians(lat0))
            length = math.hypot(north, east)
            bearing = math.degrees(math.atan2(east, north)) % 360
            for i in range(int(length / step)):
                f = i * step / length
                yield lat0 + (lat1 - lat0) * f, lon0 + (lon1 - lon0) * f, bearing


for lat, lon, bearing in legs():
    query = urlencode({'id': DEVICE_ID, 'lat': f'{lat:.6f}', 'lon': f'{lon:.6f}', 'speed': SPEED,
                       'bearing': round(bearing), 'timestamp': int(time.time())})
    try:
        with urllib.request.urlopen(urllib.request.Request(URL + '?' + query, method='POST'), timeout=5) as res:
            print(f'{lat:.5f} {lon:.5f} {bearing:3.0f}º → {res.status}')
    except OSError as error:
        print('Relay not reachable:', error)
    time.sleep(EVERY)
