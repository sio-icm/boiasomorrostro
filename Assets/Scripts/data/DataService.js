import Catalogue from './products/Catalogue.js';

class DataService {

  constructor(FetchManager) {
    this.catalogue = Catalogue;

    const weather = Catalogue.find(p => p.name === 'Open-Meteo');
    this.weather = new weather.Class(weather, FetchManager);

    const cmems = Catalogue.find(p => p.name === 'Copernicus Marine Service');
    this.cmems = new cmems.Class(cmems, FetchManager);

    const buoy = Catalogue.find(p => p.name === 'Somorrostro buoy');
    this.buoy = new buoy.Class(buoy, FetchManager);

    // Forecast section - modelled data around the buoy
    this.forecastProducts = [
      { name: weather.name, product: this.weather },
      { name: cmems.name, product: this.cmems },
    ];
    // Observations section - measured at the buoy
    this.observationProducts = [
      { name: buoy.name, product: this.buoy },
    ];
  }

}


export default DataService;
