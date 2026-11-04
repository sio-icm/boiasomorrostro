import Source from './Source.js';
import { PROXY_URL } from '/boiasomorrostro/Assets/Scripts/config.js';

// Discovers every buoy/sensor under datasetCommonKey on one ERDDAP server -
// same discovery logic as VISOC's SourceErddapBuoys (dataset IDs follow
// datasetCommonKey + <buoyName> + '_' + <sensorId>, e.g. BUOY_SOMO_METEO).
// Extended here to also fetch actual observation data (VISOC's version is
// metadata/discovery only), scoped to buoyId so this app - dedicated to one
// buoy - doesn't pull data for every other buoy the server happens to host.

const DAYS_LOADED = 3;
// ERDDAP columns that are coordinates/dimensions, not sensor readings - never
// auto-fetched as a data variable in their own right (a `depth` column is
// still requested explicitly for a profiled sensor - see depthsOf()).
const NON_DATA_COLUMNS = ['time', 'latitude', 'longitude', 'station_id', 'depth'];
// A profiled sensor's depth bins are whole metres, one row per bin (e.g.
// ADCP's "first cell at 2.0m, 1.0m cell thickness") - min/max come from its
// own ERDDAP metadata (see depthsOf()), the step is fixed at 1m.
const DEPTH_STEP_M = 1;

// Whole-metre depth bins for a profiled sensor (one whose ERDDAP metadata
// declares a `depth` column, e.g. ADCP), or undefined for a plain one.
function depthsOf(sensor) {
  const range = sensor.variables['depth']?.actual_range; // e.g. "2.0, 41.0"
  if (!range) return undefined;
  const [min, max] = range.split(',').map(s => Math.round(parseFloat(s)));
  const depths = [];
  for (let d = min; d <= max; d += DEPTH_STEP_M) depths.push(d);
  return depths;
}

// Earliest start and latest end among a list of entries (sensors or buoys -
// both carry startDate/endDate), shared by dateRange() and per-buoy dates.
function dateRangeOf(entries) {
  const startDates = entries.map(e => e.startDate).filter(Boolean);
  const endDates = entries.map(e => e.endDate).filter(Boolean);
  return {
    startDate: startDates.length ? new Date(Math.min(...startDates)) : undefined,
    endDate: endDates.length ? new Date(Math.max(...endDates)) : undefined,
  };
}

class SourceErddapBuoys extends Source {

  constructor({ fetchManager, src, datasetCommonKey, buoyId, mapping, sensorMapping }) {
    super({ fetchManager });
    this.src = src;
    this.baseUrl = src.replace(/\/index\.html$/, '');
    this.datasetCommonKey = datasetCommonKey;
    // Discovery (this.buoys) still covers every buoy under datasetCommonKey,
    // same as VISOC - buoyId only limits which one's sensors also get their
    // observation data fetched.
    this.buoyId = buoyId;
    // Raw ERDDAP name -> { code, direction, unitTransform }. A name not
    // listed here keeps its raw name as its standard code, unchanged - only
    // rename, flag a direction, or convert units when the source isn't
    // already standard.
    this.mapping = mapping || {};
    // { sensorId: { rawName: { code, direction, unitTransform } } }, checked
    // before the flat mapping above - only needed when two sensors report the
    // same raw name (e.g. CTD and SAMI both report 'TEMP').
    this.sensorMapping = sensorMapping || {};

    // Array of buoys. Inside each buoy object: id, array of sensors (metadata,
    // variables, rows...), lat-long, institution, acknowledgement
    this.buoys = [];
    this.error = undefined; // set if discovery itself fails outright

    // Resolves once discovery (this.buoys, with sensor.codes already
    // resolved) is done and every loaded sensor's own data fetch has at
    // least started - NOT once their data has actually arrived. Lets
    // getValueAt/sensorLoadingPromise() wait on just the one sensor a code
    // belongs to, instead of every sensor on this source (see below).
    this.discoveryPromise = this.discover().catch(error => {
      this.error = error;
      console.error(`Could not load ${src}`, error);
    });

    // Resolves once every loaded sensor's own fetch has settled - the
    // overall "this source is done" signal (see DPBuoys.status/latestDate).
    this.loadingPromise = this.discoveryPromise.then(() => Promise.all(this.sensorLoadingPromises || []));
  }

  proxied(url) {
    return PROXY_URL + '?url=' + encodeURIComponent(url);
  }

  // Same discovery as VISOC's SourceErddapBuoys, then starts - without
  // awaiting - each loaded sensor's own observation-data fetch (see
  // loadSensorData / sensorLoadingPromise).
  async discover() {
    const allDatasets = await this.fetchAllDatasets();
    // Only buoyId's sensors when given: the server hosts the whole network, and asking for
    // every other buoy's metadata took ~100 requests that nothing used
    const prefix = this.buoyId ? `${this.datasetCommonKey}${this.buoyId}_` : this.datasetCommonKey;
    const buoyDatasets = allDatasets.filter(d => d['datasetID'].startsWith(prefix));

    // Fetch every sensor's info in parallel, but only group them into buoys
    // afterward, synchronously - doing the grouping inside the parallel map
    // risks two sensors of the same buoy both seeing no entry yet and each
    // creating their own, instead of sharing one.
    const sensorEntries = await Promise.all(buoyDatasets.map(async d => {
      const dataset = d['datasetID'];
      const withoutPrefix = dataset.slice(this.datasetCommonKey.length);
      const lastUnderscore = withoutPrefix.lastIndexOf('_');
      const name = withoutPrefix.slice(0, lastUnderscore); // buoy id, e.g. 'SOMO'
      const sensorId = withoutPrefix.slice(lastUnderscore + 1); // e.g. 'METEO'

      const infoUrl = `${this.baseUrl}/info/${dataset}/index.jsonlKVP`;
      const infoText = await this.fetchManager.fetch(this.proxied(infoUrl)).then(res => res.text());
      const { variables, metadata } = this.parseERDDAPMetadata(infoText);

      const sensor = {
        id: sensorId,
        dataset,
        variables,
        metadata,
        rows: [], // filled by loadSensorData(), only for the buoy(s) this source actually loads
        startDate: metadata['time_coverage_start'] ? new Date(metadata['time_coverage_start']) : undefined,
        endDate: metadata['time_coverage_end'] ? new Date(metadata['time_coverage_end']) : undefined,
      };

      return { name, sensor };
    }));

    const buoysByName = new Map();
    sensorEntries.forEach(({ name, sensor }) => {
      if (!buoysByName.has(name)) {
        // lat/long, institution, acknowledgement and license are per-dataset
        // NC_GLOBAL attributes, but are expected to be the same across every
        // sensor of a buoy - taken from whichever sensor is processed first.
        const { metadata } = sensor;
        buoysByName.set(name, {
          id: name,
          sensors: [],
          latitude: metadata['nominal_latitude'] ? Number(metadata['nominal_latitude']) : undefined,
          longitude: metadata['nominal_longitude'] ? Number(metadata['nominal_longitude']) : undefined,
          institution: metadata['institution'],
          acknowledgement: metadata['acknowledgement'],
          license: metadata['license'],
        });
      }
      buoysByName.get(name).sensors.push(sensor);
    });

    // Each buoy's own startDate/endDate - earliest/latest among its sensors.
    this.buoys = [...buoysByName.values()].map(buoy => ({ ...buoy, ...dateRangeOf(buoy.sensors) }));

    const { startDate, endDate } = this.dateRange();
    this.startDate = startDate;
    this.endDate = endDate;

    // Start (don't await) the actual observation-data fetch, scoped to
    // buoyId if given - each sensor's own promise is kept so callers can
    // watch it individually instead of waiting for every sensor to finish.
    const buoysToLoad = this.buoyId ? this.buoys.filter(b => b.id === this.buoyId) : this.buoys;
    this.sensorLoadingPromises = buoysToLoad.flatMap(buoy => buoy.sensors.map(sensor => {
      sensor.loadingPromise = this.loadSensorData(sensor);
      return sensor.loadingPromise;
    }));
  }

  // ERDDAP's allDatasets lists every dataset on the server with its time range.
  // Cached by FetchManager, so every source on the same server shares the one request.
  async fetchAllDatasets() {
    const url = `${this.baseUrl}/tabledap/allDatasets.jsonlKVP`;
    const text = await this.fetchManager.fetch(this.proxied(url), 10).then(res => res.text());
    return text.trim().split('\n').filter(line => line).map(line => JSON.parse(line));
  }

  // Earliest start and latest end across every buoy/sensor - each may have
  // started/stopped reporting at a different time.
  dateRange() {
    return dateRangeOf(this.buoys.flatMap(buoy => buoy.sensors));
  }

  // The buoy this source actually loads data for (buoyId, or the first
  // discovered one if unset)
  get buoy() {
    return this.buoys.find(b => b.id === this.buoyId) || this.buoys[0];
  }

  // Standard code + direction/unitTransform for a sensor's raw column - a
  // sensor-specific override wins over a flat one, which wins over just
  // keeping the raw name unchanged (see this.sensorMapping / this.mapping).
  mappingFor(sensorId, rawName) {
    return (this.sensorMapping[sensorId] && this.sensorMapping[sensorId][rawName])
      || this.mapping[rawName]
      || { code: rawName };
  }

  // The last DAYS_LOADED days of one sensor's data, ending at its own maxTime
  // rather than at "now" - a sensor can lag by days, and anchoring on the
  // latest available data is what keeps the timeline and the wind rose
  // showing something instead of an empty range. Every numeric variable
  // ERDDAP lists for this sensor is fetched, except coordinates. A profiled
  // sensor (e.g. ADCP) reports one row per (time, depth) instead of one per
  // time - each raw column gets one standard code per depth bin, and its
  // `depth` column is requested alongside time to tell rows apart.
  async loadSensorData(sensor) {
    try {
      const rawNames = Object.keys(sensor.variables)
        .filter(name => !NON_DATA_COLUMNS.includes(name))
        .filter(name => ['float', 'double'].includes(sensor.variables[name].dataType));
      if (rawNames.length == 0 || !sensor.endDate) return;

      const depths = depthsOf(sensor);

      // Standard code (+ direction/unitTransform) per raw column, resolved
      // once - one per depth bin for a profiled sensor (see depthsOf()).
      sensor.codes = {}; // { code: { rawName, direction, unitTransform, depth? } }
      rawNames.forEach(rawName => {
        const mapped = this.mappingFor(sensor.id, rawName);
        if (depths) {
          depths.forEach(depth => {
            sensor.codes[`${mapped.code}_${depth}`] = { rawName, direction: mapped.direction, unitTransform: mapped.unitTransform, depth };
          });
        } else {
          sensor.codes[mapped.code] = { rawName, direction: mapped.direction, unitTransform: mapped.unitTransform };
        }
      });

      const startDate = new Date(sensor.endDate.getTime() - DAYS_LOADED * 24 * 3600 * 1000);
      const columns = depths ? `time,depth,${rawNames.join(',')}` : `time,${rawNames.join(',')}`;
      const url = `${this.baseUrl}/tabledap/${sensor.dataset}.csv?${columns}`
        + `&time>=${startDate.toISOString()}`;

      const text = await this.fetchManager.fetch(this.proxied(url), 10)
        .then(res => res.text())
        .catch(error => {
          // ERDDAP returns 404 (not 200 + empty body) when a query matches zero
          // rows - that means no recent data, not a failed request.
          if (error.name === 'HTTPError' && error.status === 404) return null;
          throw error;
        });
      if (text == null) sensor.rows = [];
      else sensor.rows = depths ? this.parseProfiledCSV(text, rawNames, sensor.codes) : this.parseCSV(text, rawNames, sensor.codes);
    } catch (error) {
      console.error(`Could not load data for ${sensor.dataset}`, error);
    }
  }

  // ERDDAP CSV: line 1 = column names, line 2 = units, then rows. Missing
  // values come as NaN and are dropped so they don't count as data. Columns
  // are keyed by their standard code (see sensor.codes / mappingFor).
  parseCSV(text, rawNames, codes) {
    const rawToCode = {};
    Object.entries(codes).forEach(([code, meta]) => { rawToCode[meta.rawName] = { code, unitTransform: meta.unitTransform }; });

    const lines = text.trim().split('\n');
    return lines.slice(2).map(line => {
      const cells = line.split(',');
      const values = {};
      rawNames.forEach((rawName, i) => {
        const raw = parseFloat(cells[i + 1]); // cell 0 is time
        if (isNaN(raw)) return;
        const { code, unitTransform } = rawToCode[rawName];
        values[code] = unitTransform ? unitTransform(raw) : raw;
      });
      return { date: new Date(cells[0]), values };
    });
  }

  // Same as parseCSV, but for a profiled sensor: each CSV row is one
  // (time, depth) pair rather than one per time, so rows sharing a timestamp
  // are merged into one - same { date, values } shape as every other sensor,
  // just with a depth-suffixed code per raw column (see loadSensorData).
  parseProfiledCSV(text, rawNames, codes) {
    const rawDepthToCode = {}; // 'rawName_depth' -> { code, unitTransform }
    Object.entries(codes).forEach(([code, meta]) => { rawDepthToCode[`${meta.rawName}_${meta.depth}`] = { code, unitTransform: meta.unitTransform }; });

    const lines = text.trim().split('\n');
    const rowsByTime = new Map(); // preserves first-seen (ascending time) order
    lines.slice(2).forEach(line => {
      const cells = line.split(',');
      const timeStr = cells[0];
      const depth = Math.round(parseFloat(cells[1])); // cell 0 = time, cell 1 = depth
      let row = rowsByTime.get(timeStr);
      if (!row) {
        row = { date: new Date(timeStr), values: {} };
        rowsByTime.set(timeStr, row);
      }
      rawNames.forEach((rawName, i) => {
        const raw = parseFloat(cells[i + 2]);
        if (isNaN(raw)) return;
        const entry = rawDepthToCode[`${rawName}_${depth}`];
        if (!entry) return; // a depth outside this sensor's declared bins
        row.values[entry.code] = entry.unitTransform ? entry.unitTransform(raw) : raw;
      });
    });
    return [...rowsByTime.values()];
  }

  // Which sensor (of the loaded buoy) declares a standard code, and that
  // code's direction flag - undefined if none of them do. Only needs
  // discovery, not that sensor's data to have arrived yet (sensor.codes is
  // resolved before loadSensorData's own fetch - see discover()).
  findSensorFor(code) {
    if (!this.buoy) return undefined;
    for (const sensor of this.buoy.sensors) {
      const meta = sensor.codes?.[code];
      if (meta) return { sensor, variable: meta };
    }
    return undefined;
  }

  // Most recent row that has a value for the code, or undefined
  latestRow(code) {
    const found = this.findSensorFor(code);
    if (!found) return undefined;
    const { rows } = found.sensor;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].values[code] != undefined) return rows[i];
    }
    return undefined;
  }

  // A sensor's own loading promise, once discovery knows about it -
  // undefined if this source never has that sensor. Resolves independently
  // of every other sensor, so a sensor's rows can show up in the timeline as
  // soon as they're ready (see DPBuoys.sensorLoadPromises).
  sensorLoadingPromise(sensorId) {
    return this.discoveryPromise.then(() => this.buoy?.sensors.find(s => s.id === sensorId)?.loadingPromise);
  }

  // Most recent timestamp across the loaded buoy's sensors
  get latestDate() {
    if (!this.buoy) return undefined;
    const dates = this.buoy.sensors.map(s => s.rows[s.rows.length - 1]?.date).filter(Boolean);
    return dates.length ? new Date(Math.max(...dates)) : undefined;
  }

  // Whether any of the loaded buoy's sensors actually returned rows
  get hasData() {
    return this.buoy ? this.buoy.sensors.some(s => s.rows.length > 0) : false;
  }

  // Mean of the 15-minute samples inside [date, date + intervalMinutes),
  // circular for directions (e.g. 350º and 10º must average to 0º, not 180º).
  async getValueAt(code, date, intervalMinutes) {
    await this.discoveryPromise;

    const found = this.findSensorFor(code);
    if (!found) return undefined;
    // Only this code's own sensor, not every sensor on this source - so e.g.
    // METEO shows up as soon as it's ready, without waiting on CTD/SAMI/ADCP.
    await found.sensor.loadingPromise;
    const { rows } = found.sensor;
    const { variable } = found;

    const from = date.getTime();
    const to = from + intervalMinutes * 60 * 1000;
    const samples = rows
      .filter(row => row.date.getTime() >= from && row.date.getTime() < to)
      .map(row => row.values[code])
      .filter(value => value != undefined);

    if (samples.length == 0) return undefined;
    if (!variable.direction) return samples.reduce((a, b) => a + b, 0) / samples.length;

    const sin = samples.reduce((sum, deg) => sum + Math.sin(deg * Math.PI / 180), 0);
    const cos = samples.reduce((sum, deg) => sum + Math.cos(deg * Math.PI / 180), 0);
    return Math.atan2(sin, cos) * 180 / Math.PI;
  }

}

export default SourceErddapBuoys;
