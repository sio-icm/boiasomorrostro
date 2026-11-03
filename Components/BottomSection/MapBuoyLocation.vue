<template>
  <div id="map" class="map-container" :class="{ fullscreen: $gui.panelState === 'fullscreen' }"></div>
</template>

<script>
export default {
  name: "MapComponent",

  mounted() {
    const buoyLatLng = [window.LATITUDE || 41.375694, window.LONGITUDE || 2.216194];

    // Ensure Leaflet is available globally via the script tag.
    // Zoom buttons go top-right: top-left is taken by the panel's close/fullscreen buttons
    let map = this.map = L.map("map", { zoomControl: false, maxZoom: 17 }).setView(buoyLatLng, 13);
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Base maps: OpenStreetMap toned down to the app's blues (see .map-tiles-soft),
    // alone or with the sea depth (bathymetry) coloured on top. zIndex keeps the layers in order when switching
    const softMap = () => L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      className: 'map-tiles-soft',
      maxZoom: 17,
      zIndex: 1,
    });
    const lightMap = softMap().addTo(map);
    // EMODnet's mean depth, with a blue ramp in the app's colours (shallow light, deep dark blue; land transparent)
    const emodnetAttribution = '&copy; <a href="https://emodnet.ec.europa.eu/en/bathymetry" target="_blank">EMODnet Bathymetry</a>';
    const depthStops = [[-2500, '#0f3062'], [-1000, '#1d5a8f'], [-300, '#2f7fb5'], [-100, '#5aa6d2'], [-40, '#8cc6e6'], [-15, '#bfe0f1'], [-1, '#e1f1f8']];
    const depthStyle = `<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld"><NamedLayer><Name>emodnet:mean</Name>
      <UserStyle><FeatureTypeStyle><Rule><RasterSymbolizer><ColorMap type="ramp">
      ${depthStops.map(([depth, color]) => `<ColorMapEntry color="${color}" quantity="${depth}"/>`).join('')}
      <ColorMapEntry color="#e1f1f8" quantity="0" opacity="0"/>
      </ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
    const depth = L.tileLayer.wms("https://ows.emodnet-bathymetry.eu/wms", {
      layers: 'emodnet:mean', sld_body: depthStyle, format: 'image/png', transparent: true, version: '1.3.0',
      opacity: 0.9, zIndex: 2, attribution: emodnetAttribution,
    });
    const bathymetry = L.layerGroup([softMap(), depth]);
    // Depth contours (isobaths), labelled in metres
    const isobaths = L.tileLayer.wms("https://ows.emodnet-bathymetry.eu/wms", {
      layers: 'emodnet:contours', format: 'image/png', transparent: true, version: '1.3.0',
      zIndex: 3, attribution: emodnetAttribution,
    }).addTo(map);
    // Nautical marks on top: buoys, beacons, lighthouses, channels
    const seamarks = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openseamap.org" target="_blank">OpenSeaMap</a>',
      maxZoom: 17,
      zIndex: 4,
    }).addTo(map);
    // Forecasts: wind and currents with animated particles, sea temperature from Copernicus.
    // An empty group stands in for each one in the layer list, and its data is only
    // downloaded once it is switched on (see showForecast). They share one time control
    this.forecasts = {
      wind: { group: L.layerGroup(), label: "Wind forecast" },
      currents: { group: L.layerGroup(), label: "Currents forecast" },
      seaTemperature: { group: L.layerGroup(), label: "Sea temperature forecast" },
    };
    this.forecastTimes = Array.from({ length: 48 }, (_, hour) => {
      const time = new Date();
      time.setUTCMinutes(0, 0, 0);
      time.setUTCHours(time.getUTCHours() + hour);
      return time;
    });
    this.forecastHour = 0;
    this.forecastControl = this.createForecastControl();
    const overlays = {};
    Object.values(this.forecasts).forEach(forecast => overlays[this.$i18n.t(forecast.label)] = forecast.group);
    overlays[this.$i18n.t("Isobaths")] = isobaths;
    overlays[this.$i18n.t("Nautical marks")] = seamarks;
    L.control.layers(
      { [this.$i18n.t("Light map")]: lightMap, [this.$i18n.t("Bathymetry")]: bathymetry },
      overlays,
      { position: 'topright' }
    ).addTo(map);
    const forecastName = (layer) => Object.keys(this.forecasts).find(name => this.forecasts[name].group === layer);
    // The layer control fires overlayadd for the first addTo below too
    map.on('overlayadd', (e) => { const name = forecastName(e.layer); if (name) this.showForecast(name); });
    map.on('overlayremove', (e) => { const name = forecastName(e.layer); if (name) this.updateForecastControl(); });
    this.forecasts.wind.group.addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    // Buoy: yellow buoy with a pulsing halo and the wind arrow around it
    const buoyIcon = L.divIcon({
      className: 'map-buoy',
      html: `<div class="map-buoy-pulse"></div>
        <div class="map-wind" style="display: none"><div class="map-wind-arrow"></div></div>
        <svg class="map-buoy-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#f5c400" stroke="#0f3062" stroke-width="2"/><circle cx="12" cy="12" r="3.5" fill="#0f3062"/></svg>`,
      iconSize: [80, 80],
      iconAnchor: [40, 40],
      popupAnchor: [0, -14],
    });
    this.buoyMarker = L.marker(buoyLatLng, { icon: buoyIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup(this.buoyCardHTML(), { className: 'map-popup', minWidth: 200 });
    // The card's HTML is rebuilt every time it opens, so its button is hooked up again
    this.buoyMarker.on('popupopen', this.bindCardButton);
    this.buoyMarker.openPopup();
    this.loadBuoyData();

    // View cone: where the 3D camera is looking. Follows the camera, and clicking on the map turns
    // the camera towards that point
    this.viewCone = L.polygon([], {
      interactive: false, color: '#0f3062', weight: 1, opacity: 0.5, dashArray: '4 4', fillOpacity: 0.15,
    }).addTo(map);
    this.updateViewCone();
    window.eventBus.on('Canvas3D_cameraChange', this.updateViewCone);
    map.on('click', (e) => {
      const sceneManager = window.sceneManager;
      if (!sceneManager) return;
      const north = (e.latlng.lat - buoyLatLng[0]) * 111320;
      const east = (e.latlng.lng - buoyLatLng[1]) * 111320 * Math.cos(buoyLatLng[0] * Math.PI / 180);
      sceneManager.faceBearing(Math.atan2(east, north) * 180 / Math.PI);
    });

    // Add bboxes
    if (window.AISManager) {
      window.AISManager.bboxes.forEach((bbox) => {
        const bounds = [
          [bbox[0][0], bbox[0][1]], // Southwest corner
          [bbox[1][0], bbox[1][1]]  // Northeast corner
        ];
        L.rectangle(bounds, { color: "#ff7800", weight: 1 }).addTo(map);
      });
    }

    // Add current ships
    this.markers = {};
    if (window.AISManager) {
      let ships = window.AISManager.getCurrentShips();

      Object.keys(ships).forEach((key) => {
        let shipInfo = ships[key];
        this.handleAISMessage(shipInfo);
      });
    }

    // EVENTS
    // AIS messages
    window.eventBus.on('AISManager_receivedAISMessage', this.handleAISMessage);
    // Map fills its container (see .map-container), so it must be told to
    // resize when the container does - e.g. the fullscreen toggle, which
    // dispatches this same 'resize' event once its CSS transition ends.
    window.addEventListener('resize', this.invalidateMapSize);

    // UPDATE
    this.startUpdateLoop();
  },
  unmounted() {
    // Stop loop
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    // Unhook event listener
    window.eventBus.off('AISManager_receivedAISMessage', this.handleAISMessage);
    window.eventBus.off('Canvas3D_cameraChange', this.updateViewCone);
    window.removeEventListener('resize', this.invalidateMapSize);
    // Stops the wind animation along with everything else on the map
    this.map.remove();
  },


  methods: {
    // VIEW CONE
    // Sector from the buoy (the camera is a few metres from it) towards where the 3D camera looks,
    // as wide as its horizontal field of view and 4 km long (about the distance to the coast)
    updateViewCone() {
      const sceneManager = window.sceneManager;
      if (!sceneManager || !this.viewCone) return;
      const bearing = sceneManager.getCameraBearing();
      const halfWidth = Math.min(sceneManager.getCameraHorizontalFOV(), 170) / 2;
      const [lat, lng] = [window.LATITUDE, window.LONGITUDE];
      const length = 4000; // m
      const points = [[lat, lng]];
      for (let step = 0; step <= 12; step++) {
        const angle = (bearing - halfWidth + halfWidth * 2 * step / 12) * Math.PI / 180;
        points.push([
          lat + length * Math.cos(angle) / 111320,
          lng + length * Math.sin(angle) / (111320 * Math.cos(lat * Math.PI / 180)),
        ]);
      }
      this.viewCone.setLatLngs(points);
    },
    // FORECASTS
    // Downloads a forecast (once) and shows it with the time/legend control
    async showForecast(name) {
      const forecast = this.forecasts[name];
      // Loaded only once, even if switched on again while still loading
      forecast.loading ??= this.createForecastLayer(name).then(layer => forecast.layer = layer);
      try {
        await forecast.loading;
      } catch (error) {
        console.error('Could not load the forecast: ' + name, error);
        forecast.loading = undefined;
        this.map.removeLayer(forecast.group);
        return;
      }
      // It may have been switched off while loading
      if (!this.map.hasLayer(forecast.group)) return;
      if (!forecast.group.hasLayer(forecast.layer)) forecast.group.addLayer(forecast.layer);
      this.setForecastHour(this.forecastHour);
    },
    async createForecastLayer(name) {
      const scales = window.PARTICLES_COLOR_SCALES;
      if (name === 'wind' || name === 'currents') {
        const field = await new window.ForecastField(name).load();
        const options = name === 'wind'
          ? { colors: scales.wind, speedFactor: 0.18, className: 'map-field-wind' }
          // Currents are ~50 times slower than the wind: faster particles, and in blue so they don't mix with the wind's
          : { colors: scales.currents, speedFactor: 6, density: 450, className: 'map-field-currents', seaOnly: true, particleColor: 'rgba(15, 48, 98, 0.75)' };
        const layer = new window.ParticlesLayer(field, options);
        layer.field = field;
        return layer;
      }
      // Sea surface temperature: hourly forecast of the Copernicus Mediterranean model (4.2 km), drawn by
      // their WMTS server with a colour range centred on the temperature at the buoy
      const range = this.seaTemperatureRange = await this.loadSeaTemperatureRange();
      return L.tileLayer('https://wmts.marine.copernicus.eu/teroWmts?service=WMTS&version=1.0.0&request=GetTile' +
        '&layer=MEDSEA_ANALYSISFORECAST_PHY_006_013/cmems_mod_med_phy-tem_anfc_4.2km-2D_PT1H-m_202511/thetao' +
        '&style=cmap:thermal,range:{min}/{max}&format=image/png&tilematrixset=EPSG:3857&tilematrix={z}&tilerow={y}&tilecol={x}&time={time}', {
        min: range[0], max: range[1], time: this.forecastTimes[0].toISOString(),
        // The model is 4.2 km: low-resolution tiles enlarged by the browser look smooth instead of blocky
        maxNativeZoom: 6,
        opacity: 0.7, zIndex: 2,
        attribution: '&copy; <a href="https://doi.org/10.25423/CMCC/MEDSEA_ANALYSISFORECAST_PHY_006_013_EAS8" target="_blank">Copernicus Marine Service</a>',
      });
    },
    // Colour range for the sea temperature: forecast temperature at the buoy ± 3 ºC (one Open-Meteo point),
    // or the usual temperature of the month near Barcelona if it cannot be loaded
    async loadSeaTemperatureRange() {
      let center;
      try {
        const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${window.LATITUDE}&longitude=${window.LONGITUDE}&current=sea_surface_temperature`;
        center = (await (await window.FetchManager.fetch(url, 60)).json()).current.sea_surface_temperature;
      } catch (error) {
        console.error('Could not load the sea temperature at the buoy', error);
      }
      if (typeof center !== 'number') {
        const monthly = [13.5, 13, 13.5, 15, 18, 22, 25, 26, 24.5, 21.5, 18, 15];
        center = monthly[new Date().getMonth()];
      }
      return [Math.round(center - 3), Math.round(center + 3)];
    },
    setForecastHour(hour) {
      this.forecastHour = hour;
      const time = this.forecastTimes[hour];
      Object.entries(this.forecasts).forEach(([name, forecast]) => {
        if (!forecast.layer || !this.map.hasLayer(forecast.group)) return;
        if (forecast.layer.field) forecast.layer.setHour(forecast.layer.field.hourIndex(time));
        else if (forecast.layer.options.time !== time.toISOString()) {
          forecast.layer.options.time = time.toISOString();
          forecast.layer.redraw();
        }
      });
      this.updateForecastControl();
    },
    // Bottom-left box: forecast hour (slider) and the scale of each visible forecast
    createForecastControl() {
      const control = L.control({ position: 'bottomleft' });
      control.onAdd = () => {
        const container = L.DomUtil.create('div', 'map-forecast-control');
        container.innerHTML = `
          <div class="map-forecast-header">${this.$i18n.t("Forecast")} <b class="map-forecast-time"></b></div>
          <input type="range" min="0" max="${this.forecastTimes.length - 1}" step="1">
          <div class="map-forecast-legends"></div>`;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        container.querySelector('input').addEventListener('input', (e) => this.setForecastHour(parseInt(e.target.value)));
        return container;
      };
      return control;
    },
    // Shows the control with the legends of the visible forecasts, or hides it when there are none
    updateForecastControl() {
      const visible = Object.keys(this.forecasts).filter(name => this.forecasts[name].layer && this.map.hasLayer(this.forecasts[name].group));
      if (visible.length === 0) {
        this.forecastControl.remove();
        return;
      }
      if (!this.forecastControl.getContainer()?.parentNode) this.forecastControl.addTo(this.map);
      const container = this.forecastControl.getContainer();
      const time = this.forecastTimes[this.forecastHour];
      container.querySelector('.map-forecast-time').textContent =
        time.toLocaleString(this.$i18n.locale, { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      container.querySelector('input').value = this.forecastHour;

      const scales = window.PARTICLES_COLOR_SCALES;
      const gradient = (stops, max) => stops.map(([value, rgb]) => `rgb(${rgb}) ${value / max * 100}%`).join(', ');
      const legend = (title, background, ticks, source) => `
        <div class="map-forecast-legend-title">${this.$i18n.t(title)} <i>${source}</i></div>
        <div class="map-forecast-legend" style="background: linear-gradient(to right, ${background})"></div>
        <div class="map-forecast-scale">${ticks.map(tick => `<b>${tick}</b>`).join('')}</div>`;
      // cmocean "thermal", the colour map Copernicus draws the temperature with
      const thermal = '#042333, #2c3395, #744992, #b15f82, #eb7958, #fbb43d, #e8fa5b';
      const range = this.seaTemperatureRange || [0, 0];
      const legends = {
        wind: () => legend("Wind", gradient(scales.wind, 22), ['0', '5', '10', '15', '20 m/s'], 'Open-Meteo · Météo-France'),
        currents: () => legend("Currents", gradient(scales.currents, 0.8), ['0', '20', '40', '60', '80 cm/s'], 'Open-Meteo · Copernicus'),
        seaTemperature: () => legend("Sea temperature", thermal,
          [range[0], (range[0] + range[1]) / 2, range[1] + ' ºC'], 'Copernicus'),
      };
      container.querySelector('.map-forecast-legends').innerHTML = visible.map(name => legends[name]()).join('');
    },
    // BUOY CARD
    // Fills the card as soon as each sensor is loaded, without waiting for the whole buoy
    loadBuoyData() {
      const buoy = this.$dataService.buoy;
      buoy.sensorLoadPromises().forEach(({ promise }) => promise.then(() => this.updateBuoyData()));
      buoy.ready().then(() => { this.buoyReady = true; this.updateBuoyData(); });
    },
    // Latest observation of each variable shown in the card (see DPBuoys.latestRow)
    updateBuoyData() {
      const buoy = this.$dataService.buoy;
      const wind = buoy.latestRow('WSPD');
      this.buoyData = {
        date: buoy.latestDate,
        windSpeed: wind?.values.WSPD,
        windDirection: wind?.values.WDIR,
        seaTemp: buoy.latestRow('TEMP')?.values.TEMP,
        airTemp: buoy.latestRow('DRYT')?.values.DRYT,
      };
      this.buoyMarker.setPopupContent(this.buoyCardHTML());
      this.bindCardButton();
      // Wind arrow, pointing where the wind blows to (WDIR is where it comes from)
      if (this.buoyData.windDirection != undefined) {
        const windEl = this.buoyMarker.getElement().querySelector('.map-wind');
        windEl.style.display = '';
        windEl.style.transform = `rotate(${this.buoyData.windDirection + 180}deg)`;
      }
    },
    // "See observations" button inside the card (only there once the data is loaded)
    bindCardButton() {
      const button = this.buoyMarker.getPopup().getElement()?.querySelector('.map-card-button');
      if (button) L.DomEvent.on(button, 'click', () => this.$gui.selectedSection = 'observations');
    },
    buoyCardHTML() {
      const t = (key) => this.$i18n.t(key);
      const data = this.buoyData;
      const format = (value, decimals, unit) => value == undefined || isNaN(value) ? '-' : `${value.toFixed(decimals)} ${unit}`;
      let body;
      if (data == undefined || (data.date == undefined && !this.buoyReady)) {
        body = `<div class="map-card-date">${t("Loading")}...</div>`;
      } else if (data.date == undefined) {
        body = `<div class="map-card-date">${t("No data")}</div>`;
      } else {
        const date = data.date.toLocaleString(this.$i18n.locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const windArrow = data.windDirection == undefined ? '' :
          `<i class="map-card-arrow" style="transform: rotate(${data.windDirection + 180}deg)">&#8593;</i>`;
        body = `<div class="map-card-date">${t("Last data")}: ${date}</div>
          <table class="map-card-table">
            <tr><td>${t("Wind speed")}</td><td>${format(data.windSpeed, 1, 'm/s')} ${windArrow}</td></tr>
            <tr><td>${t("Sea temperature (0.5m)")}</td><td>${format(data.seaTemp, 1, 'ºC')}</td></tr>
            <tr><td>${t("Air temperature")}</td><td>${format(data.airTemp, 1, 'ºC')}</td></tr>
          </table>
          <button class="map-card-button">${t("See observations")}</button>`;
      }
      return `<div class="map-card"><div class="map-card-title">${t("Somorrostro buoy")}</div>${body}</div>`;
    },
    // Recompute Leaflet's internal size after the container has resized
    invalidateMapSize() {
      this.map.invalidateSize();
    },
    // Function to handle the received AIS messages
    handleAISMessage(shipInfo) {
      // Heading
      let heading;
      if (shipInfo.heading === 511) {
        if (shipInfo.empiricHeading) {
          heading = shipInfo.empiricHeading.toFixed(0);
        } else {
          heading = 511;
        }
      } else {
        heading = shipInfo.heading;
      }


      if (this.markers[shipInfo.MMSI]) {
        let marker = this.markers[shipInfo.MMSI];
        // Position update
        marker.setLatLng([shipInfo.latitude, shipInfo.longitude]);

        // Content
        let nowText = this.$i18n.t("now");

        marker.setPopupContent(
          `<b>${shipInfo.shipName}</b><br>
          <b>MMSI:</b> ${shipInfo.MMSI}<br>
          <b>Heading:</b> ${shipInfo.heading}°<br>
          <b>SOG:</b> ${shipInfo.sog} knots<br>
          <b>Type:</b> ${shipInfo.shipType}<br>
          <b>Messages:</b> ${shipInfo.typeOfMessages.join(", ")}<br>
          <b>Dimensions:</b> ${shipInfo.length} x ${shipInfo.beam} m<br>
          <b>Last Updated: </b><label id="last-update">${nowText}</label>`);
      }
      // Marker is new
      else {
        // Create New Ship Marker
        const icon = L.divIcon({
          html: `<div class="boat" style="transform: rotate(${heading}deg);"></div>`,
          className: '',
          iconSize: [30, 30]
        });

        const marker = L.marker([shipInfo.latitude, shipInfo.longitude], { icon }).addTo(this.map);
        let nowText = this.$i18n.t("now");
        marker.bindPopup(
          `<b>${shipInfo.shipName}</b><br>
          <b>MMSI:</b> ${shipInfo.MMSI}<br>
          <b>Heading:</b> ${heading}°<br>
          <b>SOG:</b> ${shipInfo.sog} knots<br>
          <b>Type:</b> ${shipInfo.shipType}<br>
          <b>Messages:</b> ${shipInfo.typeOfMessages.join(", ")}<br>
          <b>Dimensions:</b> ${shipInfo.length} x ${shipInfo.beam} m<br>
          <b>Last Updated: </b><label id="last-update">${nowText}</label>`);

        this.markers[shipInfo.MMSI] = marker;
        marker.getElement().classList.add('ship-marker');
      }
      // Marker style
      let shipMarkerStyle = this.markers[shipInfo.MMSI].getElement().children[0].style;
      // Heading
      shipMarkerStyle.transform = `rotate(${heading}deg)`;
      // Dimensions
      shipMarkerStyle.width = `${shipInfo.beam * 0.5}px`;
      shipMarkerStyle.height = `${shipInfo.length * 0.5}px`;

    },
    // UPDATE LOOP
    startUpdateLoop() {
      this.intervalId = setInterval(() => {
        const now = Date.now();
        const timeSinceLastCall = (now - this.prevTime) / 1000;
        this.prevTime = now;
        if (timeSinceLastCall > 11) console.log("Time interval was bigger than 10 seconds: " + timeSinceLastCall.toFixed(1));

        // Update
        let ships = window.AISManager.getCurrentShips();
        Object.keys(ships).forEach(key => {
          let shipInfo = ships[key];
          let timeSinceLastUpdate = (now - new Date(shipInfo.lastTmst).getTime()) / (1000 * 60);
          let marker = this.markers[shipInfo.MMSI];
          let lastUpdatedMessage = '';
          if (timeSinceLastUpdate < 1) {
            lastUpdatedMessage = this.$i18n.t('< 1 minute ago');
          } else {
            lastUpdatedMessage = Math.round(timeSinceLastCall) + ' ' + this.$i18n.t('minutes ago');
          }

          marker.getPopup().setContent(marker.getPopup().getContent().replace(/<label id="last-update">(.+?)<\/label>/, `<label id="last-update">${lastUpdatedMessage}</label>`));

        });

      }, 10 * 1000); // 10 second interval
    }
  },
};
</script>

<style scoped>
.map-container {
  width: 100%;
  /* Fixed-ish size in "visible" mode: the map has no natural content height,
     so this keeps the panel a reasonable size regardless of viewport. */
  height: clamp(250px, 45vh, 400px);
  z-index: 1;
}
/* Fullscreen: cover the whole (now genuinely tall) container instead of staying capped */
.map-container.fullscreen {
  height: 100%;
}
</style>

<!-- Not scoped: these elements are created by Leaflet, outside this component's template -->
<style>
/* BASE MAP: monochrome OpenStreetMap tinted blue, so the buoy and the data stand out */
.map-tiles-soft {
  filter: grayscale(1) sepia(0.25) hue-rotate(170deg) saturate(1.6) brightness(1.06) contrast(0.92);
}

/* FORECASTS (see Assets/Map/ParticlesLayer.js) */
/* Speed colour fields, faint so the map shows through */
.map-field-colors.map-field-wind {
  opacity: 0.28;
}
.map-field-colors.map-field-currents {
  opacity: 0.35;
}
.map-forecast-control {
  background: rgba(255, 255, 255, 0.92);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  padding: 6px 10px;
  width: 220px;
  color: var(--darkBlue);
  font-size: 0.72rem;
}
.map-forecast-header {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.map-forecast-control input {
  width: 100%;
  accent-color: var(--darkBlue);
  margin: 2px 0;
}
.map-forecast-legend-title {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 4px;
  font-size: 0.68rem;
}
.map-forecast-legend-title i {
  font-style: normal;
  font-size: 0.58rem;
  opacity: 0.6;
  align-self: end;
}
.map-forecast-legend-title, .map-forecast-legend-title i {
  white-space: nowrap;
}
.map-forecast-legend {
  height: 6px;
  border-radius: 3px;
}
.map-forecast-scale {
  display: flex;
  justify-content: space-between;
  font-size: 0.62rem;
}
.map-forecast-scale b {
  font-weight: normal;
}

/* BUOY MARKER */
.map-buoy {
  position: relative;
}
.map-buoy-icon {
  position: absolute;
  left: 29px;
  top: 29px;
  width: 22px;
  height: 22px;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
}
.map-buoy-pulse {
  position: absolute;
  left: 25px;
  top: 25px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(245, 196, 0, 0.5);
  animation: map-buoy-pulse 2s ease-out infinite;
}
@keyframes map-buoy-pulse {
  from { transform: scale(0.6); opacity: 1; }
  to { transform: scale(2.2); opacity: 0; }
}
/* Wind arrow: rotates around the buoy, the arrow points where the wind blows to */
.map-wind {
  position: absolute;
  inset: 0;
}
.map-wind-arrow {
  position: absolute;
  left: 34px;
  top: 0;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 18px solid var(--darkBlue);
  filter: drop-shadow(0 0 2px white);
}

/* BUOY CARD */
.map-popup .leaflet-popup-content-wrapper {
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(var(--darkBlueRGB), 0.35);
}
.map-popup .leaflet-popup-content {
  margin: 12px 14px;
}
.map-card {
  color: var(--darkBlue);
  font-size: 0.8rem;
}
.map-card-title {
  font-weight: 600;
  font-size: 0.95rem;
}
.map-card-date {
  color: var(--blue);
  font-size: 0.7rem;
  margin-bottom: 6px;
}
.map-card-table {
  width: 100%;
  margin-bottom: 8px;
}
.map-card-table td {
  padding: 2px 0;
}
.map-card-table td:last-child {
  text-align: right;
  font-weight: 600;
  white-space: nowrap;
  padding-left: 10px;
}
.map-card-arrow {
  display: inline-block;
  font-style: normal;
}
.map-card .map-card-button {
  width: 100%;
  padding: 6px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
}

/* CONTROLS like the rest of the app */
.leaflet-container {
  font-family: "Poppins", "Sans-serif";
}
.leaflet-bar a, .leaflet-control-layers-toggle {
  background-color: var(--darkBlue);
  color: white;
}
.leaflet-bar a:hover {
  background-color: var(--blue);
  color: white;
}
.leaflet-bar {
  border: none !important;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
}
.leaflet-control-layers {
  border: none !important;
  border-radius: 10px !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
  color: var(--darkBlue);
}
/* Undo the app's global white span text (see globalStyle.css) */
.leaflet-control-layers span {
  color: var(--darkBlue);
  text-shadow: none;
  font-size: 0.8rem;
}
</style>