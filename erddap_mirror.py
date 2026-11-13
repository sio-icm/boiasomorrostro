"""A local copy of the buoys' ERDDAP datasets, so the app keeps its data when an ERDDAP fails or
stops listing them for a while. Used by boia_server.py's proxy.

update() asks each server in MIRRORED, every few minutes, for the rows newer than the copy's of the
datasets the app uses, and keeps them in SQLite with the datasets' metadata. answer() then
answers the app's queries on those datasets from the copy, as ERDDAP would:
  tabledap/allDatasets.jsonlKVP     the server's list, plus the copied datasets it doesn't list now
  info/<dataset>/index.jsonlKVP      the copied metadata, ending at the copy's latest row
  tabledap/<dataset>.csv?<columns>   with time constraints (an ISO time, max(time) or now, +/- an
                                     amount), orderByMax/orderByMin("time"),
                                     orderByMean/orderByClosest("time/<n><unit>")
Anything else (another format or constraint) is left to the server: answer() returns None.

A row the server drops later stays in the copy, and one it corrects is updated on the next
download of its time only. What the server no longer has can't be recovered: the copy starts the
first time it reads it.
"""
import csv
import io
import json
import math
import re
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit

# The datasets copied from each server: the Somorrostro buoy's, and the wind, waves and sea
# temperature of the other buoys of the network (see the map)
BUOYS = re.compile(r'^BUOY_(SOMO_[A-Z0-9_]+|[A-Z0-9]+_(GILL|WAVE|CTD))$')
MIRRORED = {'erddap.icatmar.cat': BUOYS, 'hebe.icm.csic.es': BUOYS}
CHUNK = 31 * 86400  # s: rows asked for at once, so a first download isn't one huge answer
INFO_SECONDS = 86400  # The metadata is read again once a day
TIMEOUT = 120  # s
UNITS = {'second': 1, 'minute': 60, 'hour': 3600, 'day': 86400, 'week': 7 * 86400}
NOT_FOUND = (b'Error {\n    code=404;\n    message="Not Found: Your query produced no matching results. '
             b'(local copy)";\n}\n')


class Mirror:

    def __init__(self, path):
        self.path = path
        self.servers_up = {}  # host -> whether it answered last time, to log only changes
        with self.db() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS datasets (host TEXT, dataset TEXT, listing TEXT, info TEXT, '
                       'info_read REAL, columns TEXT, units TEXT, PRIMARY KEY (host, dataset))')
            # data: the row's values as ERDDAP writes them in CSV, in the order of the dataset's columns
            db.execute('CREATE TABLE IF NOT EXISTS rows (host TEXT, dataset TEXT, time REAL, depth REAL, data TEXT, '
                       'PRIMARY KEY (host, dataset, time, depth))')

    def db(self):
        return sqlite3.connect(self.path, timeout=30)

    # UPDATING
    def update(self):
        """Downloads what's new on every server; returns {dataset: rows added or updated}"""
        added = {}
        for host, pattern in MIRRORED.items():
            try:
                listing = [json.loads(line) for line in get(f'https://{host}/erddap/tabledap/allDatasets.jsonlKVP')
                           .decode().splitlines() if line.strip()]
                for entry in listing:
                    if pattern.match(entry.get('datasetID') or ''):
                        count = self.update_dataset(host, entry)
                        if count:
                            added[f'{host} {entry["datasetID"]}'] = count
                self.set_up(host, True)
            except (OSError, ValueError) as error:
                self.set_up(host, False, error)
        return added

    def set_up(self, host, up, error=None):
        if self.servers_up.get(host) != up:
            print(f'✅ ERDDAP {host} copied' if up else f'❌ ERDDAP {host} not answering, served from the copy: {error}')
        self.servers_up[host] = up

    def update_dataset(self, host, entry):
        dataset = entry['datasetID']
        with self.db() as db:
            known = db.execute('SELECT info_read FROM datasets WHERE host=? AND dataset=?', (host, dataset)).fetchone()
            if known is None:
                db.execute('INSERT INTO datasets (host, dataset) VALUES (?, ?)', (host, dataset))
            db.execute('UPDATE datasets SET listing=? WHERE host=? AND dataset=?', (json.dumps(entry), host, dataset))
            last = db.execute('SELECT MAX(time) FROM rows WHERE host=? AND dataset=?', (host, dataset)).fetchone()[0]
        if known is None or not known[0] or time.time() - known[0] > INFO_SECONDS:
            info = get(f'https://{host}/erddap/info/{dataset}/index.jsonlKVP').decode()
            with self.db() as db:
                db.execute('UPDATE datasets SET info=?, info_read=? WHERE host=? AND dataset=?',
                           (info, time.time(), host, dataset))
        # From the copy's latest row (or the dataset's start) to the server's, a chunk at a time. Its
        # maxTime only to cut the chunks: it can lag behind its rows, so the last query is open
        newest = parse_time(entry['maxTime']) if entry.get('maxTime') else None
        start = last if last is not None else (parse_time(entry['minTime']) - 1 if entry.get('minTime') else None)
        count = 0
        while True:
            query = f'&time>{format_time(start)}' if start is not None else ''
            end = start + CHUNK if start is not None and newest is not None and newest > start + CHUNK else None
            if end is not None:
                query += f'&time<={format_time(end)}'
            count += self.download(host, dataset, query)
            if end is None:
                return count
            start = end

    def download(self, host, dataset, query):
        """Keeps the rows of a query of every column; returns how many"""
        try:
            text = get(f'https://{host}/erddap/tabledap/{dataset}.csv?{query}').decode()
        except urllib.error.HTTPError as error:
            if error.code == 404:  # No rows
                return 0
            raise
        lines = list(csv.reader(io.StringIO(text)))
        if len(lines) < 2:
            return 0
        names, units = lines[0], lines[1]
        with self.db() as db:
            stored = db.execute('SELECT columns, units FROM datasets WHERE host=? AND dataset=?', (host, dataset)).fetchone()
            columns, column_units = (json.loads(stored[0]), json.loads(stored[1])) if stored[0] else ([], [])
            # A column the server added: after the known ones (older rows don't have it)
            for name, unit in zip(names, units):
                if name not in columns:
                    columns.append(name)
                    column_units.append(unit)
            db.execute('UPDATE datasets SET columns=?, units=? WHERE host=? AND dataset=?',
                       (json.dumps(columns), json.dumps(column_units), host, dataset))
            at = {name: index for index, name in enumerate(names)}
            rows = []
            for cells in lines[2:]:
                if len(cells) != len(names):
                    continue
                values = [cells[at[name]] if name in at else 'NaN' for name in columns]
                depth = float(cells[at['depth']]) if 'depth' in at and cells[at['depth']] != 'NaN' else 0
                rows.append((host, dataset, parse_time(cells[at['time']]), depth, json.dumps(values)))
            db.executemany('INSERT OR REPLACE INTO rows VALUES (?, ?, ?, ?, ?)', rows)
        return len(rows)

    # ANSWERING
    def answer(self, url, fetch):
        """(status, content type, body) of an ERDDAP URL from the copy, or None to ask the server.
        fetch(url) asks the server, for the datasets the copy doesn't have"""
        parts = urlsplit(url)
        if parts.hostname not in MIRRORED:
            return None
        path, query = parts.path, unquote(parts.query)
        if path == '/erddap/tabledap/allDatasets.jsonlKVP':
            return self.all_datasets(parts.hostname, query, fetch(url))
        found = re.fullmatch(r'/erddap/info/([^/]+)/index\.jsonlKVP', path)
        if found:
            return self.info(parts.hostname, found[1])
        found = re.fullmatch(r'/erddap/tabledap/([^/]+)\.csv', path)
        if found:
            return self.table(parts.hostname, found[1], query)
        return None

    def copied(self, db, host, dataset=None):
        """{dataset: (listing, info, columns, units, latest time)} of the copied datasets with rows"""
        sql = ('SELECT dataset, listing, info, columns, units, (SELECT MAX(time) FROM rows r '
               'WHERE r.host=d.host AND r.dataset=d.dataset) FROM datasets d WHERE host=?')
        args = [host]
        if dataset:
            sql += ' AND dataset=?'
            args.append(dataset)
        return {row[0]: row[1:] for row in db.execute(sql, args) if row[3] and row[5] is not None}

    def all_datasets(self, host, query, upstream):
        """The server's list with the copied datasets it doesn't list now, ending at the copy's latest
        row; only the copied ones if it doesn't answer"""
        status, content_type, body = upstream
        entries = []
        if status == 200:
            try:
                entries = [json.loads(line) for line in body.decode().splitlines() if line.strip()]
            except ValueError:
                entries = []
        with self.db() as db:
            copied = self.copied(db, host)
        if not copied:
            return None
        listed = {entry.get('datasetID') for entry in entries}
        for dataset, (listing, _, _, _, latest) in sorted(copied.items()):
            if dataset not in listed and listing:
                entry = json.loads(listing)
                entry['maxTime'] = format_time(latest)
                entries.append(entry)
        keys = [key for key in query.split('&')[0].split(',') if key]
        if keys:
            entries = [{key: entry.get(key) for key in keys} for entry in entries]
        body = ''.join(json.dumps(entry, ensure_ascii=False) + '\n' for entry in entries)
        return 200, 'application/x-jsonlines; charset=UTF-8', body.encode()

    def info(self, host, dataset):
        with self.db() as db:
            copied = self.copied(db, host, dataset)
        if dataset not in copied or not copied[dataset][1]:
            return None
        info, latest = copied[dataset][1], copied[dataset][4]
        lines = []
        for line in info.splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get('Variable Name') == 'NC_GLOBAL' and row.get('Attribute Name') == 'time_coverage_end':
                row['Value'] = format_time(latest)
            lines.append(json.dumps(row, ensure_ascii=False))
        return 200, 'application/x-jsonlines; charset=UTF-8', ('\n'.join(lines) + '\n').encode()

    def table(self, host, dataset, query):
        with self.db() as db:
            copied = self.copied(db, host, dataset)
            if dataset not in copied:
                return None
            _, _, columns, units, latest = copied[dataset]
            columns, units = json.loads(columns), json.loads(units)
            request = parse_query(query, columns, latest)
            if request is None:
                return None
            selected, low, high, order = request
            sql = 'SELECT data FROM rows WHERE host=? AND dataset=?'
            args = [host, dataset]
            for (operator, value) in low + high:
                sql += f' AND time {operator} ?'
                args.append(value)
            rows = [json.loads(data) for (data,) in db.execute(sql + ' ORDER BY time, depth', args)]
        at = [columns.index(name) for name in selected]
        rows = [[row[i] if i < len(row) else 'NaN' for i in at] for row in rows]
        rows = ordered(rows, selected, order)
        if rows is None:
            return None
        if not rows:
            return 404, 'text/plain; charset=UTF-8', NOT_FOUND
        out = io.StringIO()
        writer = csv.writer(out, lineterminator='\n')
        writer.writerow(selected)
        writer.writerow([units[columns.index(name)] for name in selected])
        writer.writerows(rows)
        return 200, 'text/csv; charset=UTF-8', out.getvalue().encode()


def parse_query(query, columns, latest):
    """(columns, lower time limits, upper time limits, (orderBy function, argument)) of an ERDDAP
    query, or None if the copy can't answer it"""
    parts = query.split('&')
    selected = [name for name in parts[0].split(',') if name] or columns
    if any(name not in columns for name in selected):
        return None
    low, high, order = [], [], None
    for part in parts[1:]:
        if not part:
            continue
        found = re.fullmatch(r'time(>=|<=|>|<|=)(.+)', part)
        if found:
            value = time_value(found[2], latest)
            if value is None:
                return None
            operator = found[1]
            if operator == '=':
                low.append(('>=', value))
                high.append(('<=', value))
            else:
                (low if operator.startswith('>') else high).append((operator, value))
            continue
        found = re.fullmatch(r'(orderByMax|orderByMin|orderByMean|orderByClosest)\("([^"]*)"\)', part)
        if found and order is None:
            order = (found[1], found[2].replace(' ', ''))
            continue
        return None
    return selected, low, high, order


def time_value(text, latest):
    """Seconds of an ERDDAP time constraint: an ISO time, or max(time) or now, +/- an amount"""
    text = text.strip().strip('"')
    found = re.fullmatch(r'(max\(time\)|now)(?:([-+])(\d+(?:\.\d+)?)(second|minute|hour|day|week)s?)?', text.replace(' ', ''))
    if found:
        base = latest if found[1] == 'max(time)' else time.time()
        if found[2]:
            amount = float(found[3]) * UNITS[found[4]]
            base += amount if found[2] == '+' else -amount
        return base
    try:
        return parse_time(text)
    except ValueError:
        return None


def ordered(rows, columns, order):
    """The rows after an orderBy, as ERDDAP: None if the copy doesn't do that one"""
    if order is None:
        return rows
    function, argument = order
    if 'time' not in columns:
        return None
    t = columns.index('time')
    if function in ('orderByMax', 'orderByMin'):
        if argument != 'time' or not rows:
            return rows if argument == 'time' else None
        times = [parse_time(row[t]) for row in rows]
        pick = max(times) if function == 'orderByMax' else min(times)
        return [row for row, when in zip(rows, times) if when == pick]
    found = re.fullmatch(r'time/(\d+(?:\.\d+)?)(second|minute|hour|day|week)s?', argument)
    if not found:
        return None
    step = float(found[1]) * UNITS[found[2]]
    groups = {}
    for row in rows:
        when = parse_time(row[t])
        key = math.floor(when / step) if function == 'orderByMean' else round(when / step)
        groups.setdefault(key, []).append((when, row))
    result = []
    for key in sorted(groups):
        members = groups[key]
        if function == 'orderByClosest':
            result.append(min(members, key=lambda member: abs(member[0] - key * step))[1])
            continue
        row = []
        for index, name in enumerate(columns):
            if index == t:
                row.append(format_time(key * step))
                continue
            values = [number(member[1][index]) for member in members]
            if any(value is None for value in values):
                return None  # A text column: ERDDAP's mean isn't defined for it
            values = [value for value in values if not math.isnan(value)]
            row.append(repr(sum(values) / len(values)) if values else 'NaN')
        result.append(row)
    return result


def number(text):
    try:
        return float(text)
    except ValueError:
        return None


def parse_time(text):
    """Seconds of an ISO time, UTC unless it says otherwise (as ERDDAP)"""
    date = datetime.fromisoformat(text.replace('Z', '+00:00'))
    return (date if date.tzinfo else date.replace(tzinfo=timezone.utc)).timestamp()


def format_time(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def get(url):
    url = url.replace('<', '%3C').replace('>', '%3E').replace('"', '%22')  # Some servers refuse them as they are
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'boia-server'}), timeout=TIMEOUT) as res:
        return res.read()
