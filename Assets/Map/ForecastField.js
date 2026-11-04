import FetchManager from '/boiasomorrostro/Assets/Scripts/data/FetchManager.js';

// Gridded hourly forecasts around the buoy, from Open-Meteo: free and keyless, but limited to
// 10 000 points a day. Each load asks for ROWS x COLS points, so it is cached for an hour
// (see FetchManager) and only loaded when its map layer is shown.
//  wind:     Météo-France AROME (~1.3 km)          https://open-meteo.com/en/docs/meteofrance-api
//  currents: Copernicus SMOC via Open-Meteo (~8 km) https://open-meteo.com/en/docs/marine-weather-api

const BOUNDS = { south: 41.10, north: 41.64, west: 1.86, east: 2.58 };
const ROWS = 7;
const COLS = 7;
const CACHE_MINUTES = 60;

const SOURCES = {
  wind: {
    url: 'https://api.open-meteo.com/v1/forecast?hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&models=meteofrance_seamless',
    speed: 'wind_speed_10m',
    direction: 'wind_direction_10m',
    toMs: 1,
    fromDirection: true, // Meteorological convention: where it comes from
  },
  currents: {
    url: 'https://marine-api.open-meteo.com/v1/marine?hourly=ocean_current_velocity,ocean_current_direction',
    speed: 'ocean_current_velocity',
    direction: 'ocean_current_direction',
    toMs: 1 / 3.6, // km/h
    fromDirection: false, // Oceanographic convention: where it flows to
  },
};

class ForecastField {

  bounds = BOUNDS;

  constructor(sourceName) {
    this.source = SOURCES[sourceName];
  }

  // Loads the forecast. Resolves to this, with:
  //  times: Date per forecast hour
  //  u, v:  per hour, Float32Array of ROWS*COLS (row 0 = south), velocity in m/s
  //         (where it goes to), NaN where there is no data (e.g. currents on land)
  async load() {
    const lats = [], lons = [];
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < COLS; j++) {
        lats.push((BOUNDS.south + (BOUNDS.north - BOUNDS.south) * i / (ROWS - 1)).toFixed(3));
        lons.push((BOUNDS.west + (BOUNDS.east - BOUNDS.west) * j / (COLS - 1)).toFixed(3));
      }
    }
    // The app's moment goes from 3 days ago to 2 ahead (see GUIManager.selectedTime)
    const url = this.source.url + '&latitude=' + lats.join(',') + '&longitude=' + lons.join(',') + '&past_days=3&forecast_days=3&timezone=UTC';
    const points = await (await FetchManager.fetch(url, CACHE_MINUTES)).json();

    const { speed: speedKey, direction: directionKey, toMs, fromDirection } = this.source;
    this.times = points[0].hourly.time.map(t => new Date(t + 'Z'));
    this.u = this.times.map(() => new Float32Array(ROWS * COLS));
    this.v = this.times.map(() => new Float32Array(ROWS * COLS));
    points.forEach((point, index) => {
      point.hourly[speedKey].forEach((speed, hour) => {
        const direction = point.hourly[directionKey][hour];
        if (speed == null || direction == null) {
          this.u[hour][index] = this.v[hour][index] = NaN;
          return;
        }
        const sign = fromDirection ? -1 : 1;
        this.u[hour][index] = sign * speed * toMs * Math.sin(direction * Math.PI / 180); // east
        this.v[hour][index] = sign * speed * toMs * Math.cos(direction * Math.PI / 180); // north
      });
    });
    return this;
  }

  // Index of the forecast hour closest to a date
  hourIndex(date) {
    let best = 0;
    this.times.forEach((time, index) => {
      if (Math.abs(time - date) < Math.abs(this.times[best] - date)) best = index;
    });
    return best;
  }

  // 0 on the border of the grid, growing to 1 half a cell inside: to fade the field out at its edges
  edge(lat, lon) {
    const y = (lat - BOUNDS.south) / (BOUNDS.north - BOUNDS.south) * (ROWS - 1);
    const x = (lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west) * (COLS - 1);
    return Math.max(0, Math.min(1, 2 * Math.min(x, y, COLS - 1 - x, ROWS - 1 - y)));
  }

  // Velocity [u, v] in m/s at a position and forecast hour (bilinear interpolation), or undefined
  // outside the grid. Corners without data are left out, so the coast keeps the nearby sea values
  sample(lat, lon, hour) {
    const y = (lat - BOUNDS.south) / (BOUNDS.north - BOUNDS.south) * (ROWS - 1);
    const x = (lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west) * (COLS - 1);
    if (x < 0 || y < 0 || x > COLS - 1 || y > ROWS - 1) return undefined;
    const i = Math.min(Math.floor(y), ROWS - 2), j = Math.min(Math.floor(x), COLS - 2);
    const fy = y - i, fx = x - j;
    const corners = [
      [i * COLS + j, (1 - fx) * (1 - fy)], [i * COLS + j + 1, fx * (1 - fy)],
      [(i + 1) * COLS + j, (1 - fx) * fy], [(i + 1) * COLS + j + 1, fx * fy],
    ];
    const u = this.u[hour], v = this.v[hour];
    let sumU = 0, sumV = 0, sumWeight = 0;
    corners.forEach(([index, weight]) => {
      if (isNaN(u[index])) return;
      sumU += u[index] * weight;
      sumV += v[index] * weight;
      sumWeight += weight;
    });
    // Mostly surrounded by land: no data (keeps currents from spreading far inland)
    return sumWeight > 0.3 ? [sumU / sumWeight, sumV / sumWeight] : undefined;
  }
}

export { ForecastField };
