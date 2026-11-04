import SourceOpenWeatherAPI from '../sources/SourceOpenWeatherAPI.js';
import SourceCMEMS from '../sources/SourceCMEMS.js';
import SourceErddapBuoys from '../sources/SourceErddapBuoys.js';

import DPOpenWeatherAPI from './DPOpenWeatherAPI.js';
import DPCMEMS from './DPCMEMS.js';
import DPBuoys from './DPBuoys.js';


// Somorrostro's raw ERDDAP columns already match the codes used elsewhere in
// this app (see SourceErddapBuoys - a name not listed here just keeps its raw
// name as its code), except three variables that are directions.
const BUOY_MAPPING = {
  WDIR: { code: 'WDIR', direction: true },
  WRDR: { code: 'WRDR', direction: true },
  HCDT: { code: 'HCDT', direction: true },
};
// CTD and SAMI both report their temperature as a raw column literally named
// 'TEMP' - this per-sensor override gives SAMI's its own code so it doesn't
// collide with CTD's (which keeps 'TEMP' via BUOY_MAPPING above).
const BUOY_SENSOR_MAPPING = {
  SAMI: { TEMP: { code: 'SAMITEMP' } },
};

// ADCP profiles current across 40 depth bins (2-41m, 1m steps) - one row per
// depth (see SourceErddapBuoys's profiled-sensor handling, which builds a
// 'HCSP_<depth>'/'HCDT_<depth>' code pair per bin). `suffix` is appended
// as-is after the translated name (see DataTimeline.vue/DTLayout.vue).
const ADCP_MIN_DEPTH = 2;
const ADCP_MAX_DEPTH = 41;
function adcpCurrentVariables() {
  const variables = [];
  for (let depth = ADCP_MIN_DEPTH; depth <= ADCP_MAX_DEPTH; depth++) {
    variables.push({
      code: `HCSP_${depth}`,
      name: 'Sea water velocity',
      suffix: `(${depth}m)`,
      unitGroup: 'current',
      directionCode: `HCDT_${depth}`,
      sensor: 'ADCP',
    });
  }
  return variables;
}


// Data products
// variables -> rows of the data timeline. Each cell is coloured according to
// range, and shows an arrow when directionCode points at another variable.
// unitGroup (see Assets/Scripts/data/units.js) makes a variable's unit
// clickable, cycling through that group's options; plain unit/range/decimals
// are used as-is for variables without one. Which rows show in the compact
// panel state, and how they're grouped in fullscreen, are view-layer
// decisions (see ObservationsSection.vue / ForecastSection.vue), not encoded
// here.
const dataProducts = [

  // Open Weather API
  {
    name: 'Open Weather API',
    Class: DPOpenWeatherAPI,
    description: 'Atmospheric forecast at the buoy location',
    type: 'forecast',
    link: 'https://openweather.co.uk/technology',
    variables: [
      { code: 'WSPD',  name: 'Wind speed',      unitGroup: 'wind',    directionCode: 'WDIR', fromDirection: true },
      { code: 'GUST',  name: 'Wind gust',       unitGroup: 'wind' },
      { code: 'DRYT',  name: 'Air temperature', unitGroup: 'airTemp' },
      { code: 'RELH',  name: 'Humidity',        unit: '%', range: [0, 100], decimals: 0 },
      { code: 'CLOUD', name: 'Cloudiness',      unit: '%', range: [0, 100], decimals: 0 },
    ],
    sources: [
      {
        Class: SourceOpenWeatherAPI,
        src: 'https://api.icatmar.cat/openWeatherAPI',
        institution: 'OpenWeather',
        // Standard code -> path inside a forecast entry (https://openweathermap.org/forecast5)
        mapping: {
          WSPD:  { source: 'wind.speed' },
          WDIR:  { source: 'wind.deg' },
          GUST:  { source: 'wind.gust' },
          DRYT:  { source: 'main.temp' },
          RELH:  { source: 'main.humidity' },
          CLOUD: { source: 'clouds.all' },
        },
      }
    ]
  },


  // Copernicus Marine Service
  {
    name: 'Copernicus Marine Service',
    Class: DPCMEMS,
    description: 'Wave, current and biogeochemistry models at the buoy location',
    type: 'forecast',
    link: 'https://data.marine.copernicus.eu/products',
    variables: [
      { code: 'VHM0',  name: 'Wave significant height',  unitGroup: 'waves',   directionCode: 'VMDR', fromDirection: true },
      { code: 'VTM02', name: 'Wave period',              unit: 's',     range: [0, 15],      decimals: 1 },
      { code: 'HCSP',  name: 'Sea water velocity',       unitGroup: 'current', directionCode: 'HCDT' },
      { code: 'TEMP',  name: 'Sea surface temperature',  unitGroup: 'seaTemp' },
      { code: 'PSAL',  name: 'Salinity',                 unit: '‰',     range: [36, 39],     decimals: 1 },
      { code: 'CHLA',  name: 'Chlorophyll',              unit: 'mg/m³', range: [0.01, 0.4],  decimals: 2 },
    ],
    sources: [
      {
        Class: SourceCMEMS,
        src: 'https://wmts.marine.copernicus.eu/teroWmts/',
        institution: 'E.U. Copernicus Marine Service Information',
        // Standard code -> WMTS layer (see Assets/Scripts/WMTS/WMTSCustomDefinitions.js).
        // Directions are read from the animation layers of the same variable.
        mapping: {
          VHM0:  { layer: 'Wave significant height' },
          VMDR:  { layer: 'Wave significant height', direction: true },
          VTM02: { layer: 'Wave period' },
          HCSP:  { layer: 'Sea water velocity' },
          HCDT:  { layer: 'Sea water velocity', direction: true },
          TEMP:  { layer: 'Sea surface temperature' },
          PSAL:  { layer: 'Salinity' },
          CHLA:  { layer: 'Chlorophyll' },
        },
      }
    ]
  },


  // Somorrostro buoy - observations
  {
    name: 'Somorrostro buoy',
    Class: DPBuoys,
    description: 'Meteorological observations measured at the buoy',
    type: 'real-time',
    link: 'https://erddap.icatmar.cat/erddap/info/BUOY_SOMO_METEO/index.html',
    // Ordered and grouped by sensor (see ObservationsSection.vue's extended
    // view, which splits these into one block per sensor) - which rows show
    // in the compact view is a view-layer decision, not encoded here.
    variables: [
      // METEO
      { code: 'WSPD', name: 'Wind speed',              unitGroup: 'wind',     directionCode: 'WDIR', fromDirection: true, sensor: 'METEO' },
      { code: 'WRSP', name: 'Relative wind speed',     unitGroup: 'wind',     directionCode: 'WRDR', fromDirection: true, sensor: 'METEO' },
      // Direction-only: no magnitude of its own, just an arrow (see DataTimeline.vue)
      { code: 'WCDR', name: 'Corrected wind direction', directionOnly: true, fromDirection: true, unit: 'º', sensor: 'METEO' },
      { code: 'DRYT', name: 'Air temperature',         unitGroup: 'airTemp',  sensor: 'METEO' },
      { code: 'DEWT', name: 'Dew point temperature',   unitGroup: 'airTemp',  sensor: 'METEO' },
      { code: 'WETT', name: 'Wet bulb temperature',    unitGroup: 'airTemp',  sensor: 'METEO' },
      { code: 'ATMS', name: 'Atmospheric pressure',    unitGroup: 'pressure', sensor: 'METEO' },
      { code: 'RELH', name: 'Humidity',                unit: '%',      range: [0, 100],   decimals: 0, sensor: 'METEO' },
      { code: 'ADNS', name: 'Air density',             unit: 'kg/m³',  range: [1.1, 1.3],  decimals: 2, sensor: 'METEO' },
      // CTD - same colour scale as air temperature for now (see colorLegends.js)
      { code: 'TEMP', name: 'Sea temperature (0.5m)', unitGroup: 'airTemp', sensor: 'CTD' },
      // CTD - noColor: true until these get their own legend (see colorLegends.js)
      { code: 'PSAL', name: 'Salinity',                 unit: '‰',    range: [36, 39], decimals: 1, noColor: true, sensor: 'CTD' },
      { code: 'DOX1', name: 'Dissolved oxygen',         unit: 'ml/L', range: [0, 8],   decimals: 2, noColor: true, sensor: 'CTD' },
      { code: 'PRES', name: 'Sea pressure',             unit: 'dbar', range: [0, 5],   decimals: 2, noColor: true, sensor: 'CTD' },
      { code: 'CNDC', name: 'Electrical conductivity',  unit: 'S/m',  range: [4, 7],   decimals: 2, noColor: true, sensor: 'CTD' },
      // SAMI - fixed at this depth, not a queryable dimension
      { code: 'SAMITEMP', name: 'Sea temperature (4m)', unitGroup: 'airTemp', sensor: 'SAMI' },
      { code: 'PHPH', name: 'Water pH', unit: '', range: [7, 9], decimals: 2, sensor: 'SAMI' },
      // ADCP - one row per depth bin (see adcpCurrentVariables)
      ...adcpCurrentVariables(),
    ],
    // Same sensors on both servers; whichever is ahead answers first (see DPBuoys).
    // datasetCommonKey is the prefix of the buoys' datasets (same as VISOC's
    // SourceErddapBuoys); buoyId limits discovery and data-fetching to SOMO.
    sources: [
      {
        Class: SourceErddapBuoys,
        src: 'https://erddap.icatmar.cat/erddap/index.html',
        datasetCommonKey: 'BUOY_',
        buoyId: 'SOMO',
        institution: 'ICATMAR',
        mapping: BUOY_MAPPING,
        sensorMapping: BUOY_SENSOR_MAPPING,
      },
      {
        Class: SourceErddapBuoys,
        src: 'https://hebe.icm.csic.es/erddap/index.html',
        datasetCommonKey: 'BUOY_',
        buoyId: 'SOMO',
        institution: 'ICM-CSIC',
        mapping: BUOY_MAPPING,
        sensorMapping: BUOY_SENSOR_MAPPING,
      }
    ]
  },

];


export default dataProducts;
