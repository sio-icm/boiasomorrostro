import FetchManager from '/boiasomorrostro/Assets/Scripts/data/FetchManager.js';

// Gridded wind forecast around the buoy, from Open-Meteo (Météo-France AROME, ~1.3 km, falling back to ARPEGE).
// Free and keyless, but limited to 10 000 points a day: each load asks for ROWS x COLS points,
// so it is cached for an hour (see FetchManager) and only loaded when the wind layer is shown.
// https://open-meteo.com/en/docs/meteofrance-api

const BOUNDS = { south: 41.10, north: 41.64, west: 1.86, east: 2.58 };
const ROWS = 7;
const COLS = 7;
const MODEL = 'meteofrance_seamless';
const CACHE_MINUTES = 60;

class WindField {

  bounds = BOUNDS;
  rows = ROWS;
  cols = COLS;

  // Loads the forecast. Resolves to this, with:
  //  times: Date per forecast hour
  //  u, v:  per hour, Float32Array of ROWS*COLS (row 0 = south), wind velocity in m/s (where it blows to)
  async load() {
    const lats = [], lons = [];
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < COLS; j++) {
        lats.push((BOUNDS.south + (BOUNDS.north - BOUNDS.south) * i / (ROWS - 1)).toFixed(3));
        lons.push((BOUNDS.west + (BOUNDS.east - BOUNDS.west) * j / (COLS - 1)).toFixed(3));
      }
    }
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats.join(',') + '&longitude=' + lons.join(',') +
      '&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&forecast_days=2&timezone=UTC&models=' + MODEL;
    const points = await (await FetchManager.fetch(url, CACHE_MINUTES)).json();

    this.times = points[0].hourly.time.map(t => new Date(t + 'Z'));
    this.u = this.times.map(() => new Float32Array(ROWS * COLS));
    this.v = this.times.map(() => new Float32Array(ROWS * COLS));
    points.forEach((point, index) => {
      point.hourly.wind_speed_10m.forEach((speed, hour) => {
        // Direction is where the wind comes from: the velocity points the opposite way
        const direction = point.hourly.wind_direction_10m[hour] * Math.PI / 180;
        this.u[hour][index] = -(speed ?? 0) * Math.sin(direction); // east
        this.v[hour][index] = -(speed ?? 0) * Math.cos(direction); // north
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

  // Wind [u, v] in m/s at a position and forecast hour (bilinear interpolation),
  // or undefined outside the grid
  sample(lat, lon, hour) {
    const y = (lat - BOUNDS.south) / (BOUNDS.north - BOUNDS.south) * (ROWS - 1);
    const x = (lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west) * (COLS - 1);
    if (x < 0 || y < 0 || x > COLS - 1 || y > ROWS - 1) return undefined;
    const i = Math.min(Math.floor(y), ROWS - 2), j = Math.min(Math.floor(x), COLS - 2);
    const fy = y - i, fx = x - j;
    const interpolate = (grid) =>
      (grid[i * COLS + j] * (1 - fx) + grid[i * COLS + j + 1] * fx) * (1 - fy) +
      (grid[(i + 1) * COLS + j] * (1 - fx) + grid[(i + 1) * COLS + j + 1] * fx) * fy;
    return [interpolate(this.u[hour]), interpolate(this.v[hour])];
  }
}

export { WindField };
