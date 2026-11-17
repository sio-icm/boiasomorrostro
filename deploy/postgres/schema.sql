-- The SIO's database (see boia_db.py, which runs this on start; every statement may run again).
--
-- platforms  each thing that moves or measures: a buoy, a boat, a vehicle. Its id is the one the app
--            gives it: the MMSI for AIS ("992241239"), or "BLUEBOAT-<id>", "PATI-<id>"
-- positions  where each one was, and when: from its AIS, its tracker... (source). For AIS, msg_type
--            is the message type, and accuracy whether it is a GPS fix (an aid to navigation such as
--            the buoy also sends its fixed charted position). geom, for spatial queries (PostGIS)

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS platforms (
    id text PRIMARY KEY,
    name text,
    kind text,              -- buoy, boat, vehicle...
    owner text,
    created timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS positions (
    platform text NOT NULL REFERENCES platforms (id),
    time timestamptz NOT NULL,
    source text NOT NULL,   -- aisstream, tugemi, bluelab...
    msg_type smallint NOT NULL DEFAULT 0,
    lat double precision NOT NULL,
    lon double precision NOT NULL,
    accuracy boolean,
    sog real,               -- knots
    heading smallint,       -- degrees
    name text,              -- as it said its name then
    geom geography (Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED,
    PRIMARY KEY (platform, time, source, msg_type)
);
CREATE INDEX IF NOT EXISTS positions_time ON positions (time);
CREATE INDEX IF NOT EXISTS positions_geom ON positions USING gist (geom);

INSERT INTO platforms (id, name, kind, owner) VALUES
    ('992241239', 'Boia Somorrostro', 'buoy', 'ICM-CSIC'),
    ('224946750', 'Pelagia Primer', 'boat', 'ICM-CSIC')
ON CONFLICT (id) DO NOTHING;

-- conditions  the sea and the wind at the buoy, hour by hour, as the 3D view shows them (see
--             boia_server.py, CONDITIONS): from a model (source), each variable as Open-Meteo names
--             it (wave_height m, wave_direction degrees from, wind_speed_10m m/s...). Kept for the
--             3D view's history mode, as the services only keep a few days
CREATE TABLE IF NOT EXISTS conditions (
    time timestamptz NOT NULL,
    source text NOT NULL,
    variable text NOT NULL,
    value real,
    PRIMARY KEY (time, source, variable)
);
