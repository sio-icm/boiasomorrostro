import Source from './Source.js';

// Hourly atmospheric forecast at the buoy from Open-Meteo: free, keyless, and open to any website
// (unlike ICATMAR's OpenWeather proxy, which only answers its own). Météo-France's models, as the
// wind on the map (see Assets/Map/ForecastField.js)
// https://open-meteo.com/en/docs/meteofrance-api

const HALF_STEP_MS = 30 * 60 * 1000; // forecast entries are an hour apart


class SourceOpenMeteo extends Source {

  constructor({ fetchManager, src, mapping }) {
    super({ fetchManager });
    this.src = src;
    this.mapping = mapping; // { standardCode: { source: Open-Meteo hourly variable } }
    // Buoy location, set as a global in main.js
    this.lat = window.LATITUDE;
    this.lon = window.LONGITUDE;

    this.loadingPromise = this.load().catch(error => console.error('Could not load the Open-Meteo forecast', error));
  }

  // Fetches the whole forecast once: one row per hour with its date
  async load() {
    const variables = [...new Set(Object.values(this.mapping).map(variable => variable.source))];
    const url = `${this.src}?latitude=${this.lat}&longitude=${this.lon}&hourly=${variables.join(',')}`
      + '&wind_speed_unit=ms&forecast_days=5&timezone=UTC';
    const json = await this.fetchManager.fetch(url, 30).then(res => res.json());

    const hourly = json.hourly;
    this.data = hourly.time.map((time, index) => ({
      date: new Date(time + 'Z'),
      values: Object.fromEntries(variables.map(variable => [variable, hourly[variable][index]])),
    }));
    this.startDate = this.data[0].date;
    this.endDate = this.data[this.data.length - 1].date;
  }

  // Closest forecast hour to the date, or undefined outside the forecast
  async getValueAt(code, date) {
    await this.loadingPromise;
    if (this.data == undefined) return undefined; // the forecast could not be loaded

    const variable = this.mapping[code];
    if (variable == undefined) return undefined;

    const closest = this.data.reduce((best, row) =>
      Math.abs(row.date - date) < Math.abs(best.date - date) ? row : best, this.data[0]);
    if (Math.abs(closest.date - date) > HALF_STEP_MS) return undefined;

    return closest.values[variable.source] ?? undefined;
  }

}

export default SourceOpenMeteo;
