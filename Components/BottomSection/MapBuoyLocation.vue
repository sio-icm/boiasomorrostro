<template>
  <div id="map" class="map-container" :class="{ fullscreen: $gui.panelState === 'fullscreen' }"></div>
</template>

<script>
// Ship categories, headings and what their cards show: in Assets/Scripts/AIS/vesselInfo.js
const TRAIL_POINTS = 40; // positions kept for each ship's trail
// Other buoys of ICATMAR's network on the same ERDDAP, with the latest of each one shown on its card
const NETWORK_BUOYS = [
  { id: 'TORD', name: 'Tordera', latlng: [41.5997, 2.7698] },
  { id: 'TARR', name: 'Tarragona', latlng: [41.076267, 1.346883] },
  { id: 'TORT', name: 'Cap de Tortosa', latlng: [40.71485, 0.985183] },
  { id: 'CDCR', name: 'Cap de Creus', latlng: [42.3212, 3.3495] },
];
const ERDDAP = 'https://erddap.icatmar.cat/erddap/tabledap/';
const ROSE_SECTORS = 16;

// Leaflet's layer list with a heading over each group of overlays (options.groupOf: layer -> its
// group's name). The overlays are listed in the order they were given, so each group's together
const GroupedLayers = L.Control.Layers.extend({
  _update() {
    L.Control.Layers.prototype._update.call(this);
    const labels = [...this._overlaysList.children];
    let last;
    this._layers.filter(item => item.overlay).forEach((item, index) => {
      const group = this.options.groupOf.get(item.layer);
      if (group && group !== last && labels[index]) {
        const heading = L.DomUtil.create('div', 'map-layers-group');
        heading.textContent = group;
        this._overlaysList.insertBefore(heading, labels[index]);
      }
      last = group;
    });
    return this;
  },
});

export default {
  name: "MapComponent",

  mounted() {
    const buoyLatLng = [window.LATITUDE || 41.375694, window.LONGITUDE || 2.216194];

    // Ensure Leaflet is available globally via the script tag.
    // Zoom buttons go top-right: top-left is taken by the panel's close/fullscreen buttons
    let map = this.map = L.map("map", { zoomControl: false, maxZoom: 17 }).setView(buoyLatLng, 13);
    L.control.zoom({ position: 'topright' }).addTo(map);
    // Below the zoom: back to the buoy, at the starting zoom
    const CenterControl = L.Control.extend({
      onAdd: () => {
        const bar = L.DomUtil.create('div', 'leaflet-bar');
        const button = L.DomUtil.create('a', 'map-center-button', bar);
        button.href = '#';
        button.role = 'button';
        button.title = this.$i18n.t("Centre on the buoy");
        button.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
          <circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg>`;
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(button, 'click', (e) => {
          L.DomEvent.preventDefault(e);
          map.flyTo(buoyLatLng, 13, { duration: 1 });
        });
        return bar;
      },
    });
    new CenterControl({ position: 'topright' }).addTo(map);
    // Ruler: while on, each click on the map adds a point to a route, with the distance of each
    // leg and the total. Starts wherever you click (clicking near the buoy snaps to it)
    const MeasureControl = L.Control.extend({
      onAdd: () => {
        const bar = L.DomUtil.create('div', 'leaflet-bar');
        const button = this.measureButton = L.DomUtil.create('a', 'map-center-button', bar);
        button.href = '#';
        button.role = 'button';
        button.title = this.$i18n.t("Measure distances");
        button.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17 L17 3 L21 7 L7 21 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          <path d="M7 13l2 2M10 10l2 2M13 7l2 2" stroke="currentColor" stroke-width="2"/></svg>`;
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(button, 'click', (e) => {
          L.DomEvent.preventDefault(e);
          this.setMeasuring(!this.measuring);
        });
        return bar;
      },
    });
    new MeasureControl({ position: 'topright' }).addTo(map);

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
    const depthStops = [[-2500, 'var(--darkBlue)'], [-1000, '#1d5a8f'], [-300, 'var(--lightBlue)'], [-100, '#5aa6d2'], [-40, '#8cc6e6'], [-15, '#bfe0f1'], [-1, '#e1f1f8']];
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
    // The forecasts show the app's moment (see GUIManager.selectedTime)
    this.forecastTime = this.$gui.moment;
    window.eventBus.on('GUIManager_timeChanged', this.onTimeChanged);
    this.forecastControl = this.createForecastControl();
    // Wind rose of the buoy's last days of data, around it (see drawWindRose)
    this.windRoseLayer = L.layerGroup().addTo(map);
    // The other buoys of the network
    this.networkLayer = L.layerGroup(NETWORK_BUOYS.map(buoy => this.createNetworkBuoy(buoy, buoyLatLng)));
    // Ships from AIS and our vehicles, with their recent trails (see handleAISMessage)
    this.shipsLayer = L.layerGroup().addTo(map);
    // The Patí Científic's temperature profiles of 2021-22, at its stations (see drawProfileStations).
    // Off at first: past data, not what is out there now
    this.profilesLayer = L.layerGroup();
    this.drawProfileStations();
    // The layer list in groups (see GroupedLayers): what is out there now, the forecasts, the
    // chart's layers, and the data of past projects and campaigns
    const groups = [
      ["now", { "Ships": this.shipsLayer, "ICATMAR buoys": this.networkLayer, "Wind rose": this.windRoseLayer }],
      ["forecast", Object.fromEntries(Object.values(this.forecasts).map(forecast => [forecast.label, forecast.group]))],
      ["chart", { "Isobaths": isobaths, "Nautical marks": seamarks }],
      ["projects", { "Patí Científic profiles": this.profilesLayer }],
    ];
    const overlays = {};
    const groupOf = new Map();
    groups.forEach(([group, layers]) => Object.entries(layers).forEach(([label, layer]) => {
      overlays[this.$i18n.t(label)] = layer;
      groupOf.set(layer, this.$i18n.t(`mapLayers.${group}`));
    }));
    new GroupedLayers(
      { [this.$i18n.t("Light map")]: lightMap, [this.$i18n.t("Bathymetry")]: bathymetry },
      overlays,
      { position: 'topright', groupOf },
    ).addTo(map);
    const forecastName = (layer) => Object.keys(this.forecasts).find(name => this.forecasts[name].group === layer);
    // The layer control fires overlayadd for the first addTo below too
    map.on('overlayadd', (e) => { const name = forecastName(e.layer); if (name) this.showForecast(name); });
    map.on('overlayremove', (e) => { const name = forecastName(e.layer); if (name) this.updateForecastControl(); });
    this.forecasts.wind.group.addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    // Buoy: yellow buoy in our blue ring (see ownAssets.js), with a halo that pulses while it
    // transmits (see updateBuoyData), and the wind arrow around it
    const buoyIcon = L.divIcon({
      className: 'map-buoy',
      html: `<div class="map-buoy-pulse" style="display: none"></div><div class="map-own-ring map-buoy-ring"></div>
        <div class="map-wind" style="display: none"><div class="map-wind-arrow"></div></div>
        <svg class="map-buoy-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#f5c400" stroke="var(--darkBlue)" stroke-width="2"/><circle cx="12" cy="12" r="3.5" fill="var(--darkBlue)"/></svg>`,
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
      interactive: false, color: 'var(--darkBlue)', weight: 1, opacity: 0.5, dashArray: '4 4', fillOpacity: 0.15,
    }).addTo(map);
    this.updateViewCone();
    window.eventBus.on('Canvas3D_cameraChange', this.updateViewCone);
    // While measuring (see MeasureControl), clicks add points to the route instead
    this.measureLayer = L.layerGroup().addTo(map);
    this.measurePoints = [];
    map.on('click', (e) => {
      if (this.measuring) this.addMeasurePoint(e.latlng);
      else window.sceneManager?.faceBearing(this.bearing(L.latLng(buoyLatLng), e.latlng));
    });
    this.onMeasureKey = (e) => { if (e.key === 'Escape' && this.measuring) this.setMeasuring(false); };
    document.addEventListener('keydown', this.onMeasureKey);

    // Area covered by the AIS feed, faintly
    this.drawAISCoverage();
    window.eventBus.on('AISManager_bboxes', this.drawAISCoverage);

    // Tapping the buoy or a ship on the map takes the 3D camera there (see SceneManager.follow),
    // and tapping them in the 3D view opens their card here
    this.buoyMarker.on('click', () => window.sceneManager?.focusOnBuoy());
    window.eventBus.on('Canvas3D_objectPicked', this.showPicked);
    // The Patí Científic mode of the 3D view shows its stations here too
    this.$watch(() => this.$gui.patiMode, on => { if (on) this.map.addLayer(this.profilesLayer); }, { immediate: true });

    // Ships already received
    this.ships = {};
    if (window.AISManager) {
      Object.values(window.AISManager.getCurrentShips()).forEach(this.handleAISMessage);
    }

    // EVENTS
    // AIS messages
    window.eventBus.on('AISManager_receivedAISMessage', this.handleAISMessage);
    window.eventBus.on('AISManager_fleet', this.updateShipCards);
    // Map fills its container (see .map-container), so it must be told to
    // resize when the container does - e.g. the fullscreen toggle, which
    // dispatches this same 'resize' event once its CSS transition ends.
    window.addEventListener('resize', this.invalidateMapSize);

    // UPDATE
    this.startUpdateLoop();
  },
  unmounted() {
    document.removeEventListener('keydown', this.onMeasureKey);
    // Stop loop
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    // Unhook event listener
    window.eventBus.off('AISManager_receivedAISMessage', this.handleAISMessage);
    window.eventBus.off('AISManager_fleet', this.updateShipCards);
    window.eventBus.off('AISManager_bboxes', this.drawAISCoverage);
    window.eventBus.off('Canvas3D_objectPicked', this.showPicked);
    window.eventBus.off('GUIManager_timeChanged', this.onTimeChanged);
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
      // From where the camera is (x east, z south, in m from the buoy), not always the buoy:
      // the camera can be following a vessel (see SceneManager.follow)
      const metresPerDegree = 6371000 * Math.PI / 180;
      const camera = sceneManager.camera.position;
      const lat = window.LATITUDE - camera.z / metresPerDegree;
      const lng = window.LONGITUDE + camera.x / (metresPerDegree * Math.cos(window.LATITUDE * Math.PI / 180));
      const length = sceneManager.followed ? 1500 : 4000; // m
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
      this.setForecastTime(this.forecastTime);
    },
    async createForecastLayer(name) {
      const scales = window.PARTICLES_COLOR_SCALES;
      if (name === 'wind' || name === 'currents') {
        const field = await new window.ForecastField(name).load();
        const options = name === 'wind'
          ? { colors: scales.wind, speedFactor: 0.18, className: 'map-field-wind' }
          // Currents are ~50 times slower than the wind: faster particles, and in blue so they don't mix with the wind's
          : { colors: scales.currents, speedFactor: 6, density: 450, className: 'map-field-currents', seaOnly: true, particleColor: 'rgba(var(--darkBlueRGB), 0.75)' };
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
        min: range[0], max: range[1], time: this.forecastTime.toISOString(),
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
    onTimeChanged() {
      this.setForecastTime(this.$gui.moment);
    },
    setForecastTime(time) {
      this.forecastTime = time;
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
    // Bottom-left box: the forecasts' time (set with the app's time control) and the scale of each visible forecast
    createForecastControl() {
      const control = L.control({ position: 'bottomleft' });
      control.onAdd = () => {
        // The legends fold away by tapping the header, folded from the start on narrow screens
        const container = L.DomUtil.create('div', 'map-forecast-control');
        if (window.innerWidth < 770) container.classList.add('collapsed');
        container.innerHTML = `
          <div class="map-forecast-header" role="button" title="${this.$i18n.t("Show or hide legend")}">
            <div>${this.$i18n.t("Forecast")} <i class="map-forecast-chevron">&#9662;</i></div><b class="map-forecast-time"></b>
          </div>
          <div class="map-forecast-legends"></div>`;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        container.querySelector('.map-forecast-header').addEventListener('click', () => container.classList.toggle('collapsed'));
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
      container.querySelector('.map-forecast-time').textContent =
        this.forecastTime.toLocaleString(this.$i18n.locale, { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

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
      buoy.ready().then(() => { this.buoyReady = true; this.updateBuoyData(); this.drawWindRose(); });
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
      const live = buoy.latestDate && Date.now() - buoy.latestDate < window.OwnAssets.BUOY_LIVE_HOURS * 3600e3;
      this.buoyMarker.getElement().querySelector('.map-buoy-pulse').style.display = live ? '' : 'none';
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
      return `<div class="map-card"><div class="map-card-title">${t("Somorrostro buoy")}</div>${this.ownTagHTML('ICM-CSIC · ICATMAR')}${body}</div>`;
    },
    // Recompute Leaflet's internal size after the container has resized
    invalidateMapSize() {
      this.map.invalidateSize();
    },
    // DISTANCES
    // Bearing in degrees (0-360, clockwise from north) from one point to another
    bearing(from, to) {
      const north = (to.lat - from.lat) * 111320;
      const east = (to.lng - from.lng) * 111320 * Math.cos(from.lat * Math.PI / 180);
      return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
    },
    // Turning it off clears the route; while on, the map doesn't turn the 3D camera or zoom on double click
    setMeasuring(measuring) {
      this.measuring = measuring;
      this.measureButton.classList.toggle('active', measuring);
      this.map.getContainer().classList.toggle('map-measuring', measuring);
      measuring ? this.map.doubleClickZoom.disable() : this.map.doubleClickZoom.enable();
      if (!measuring) {
        this.measurePoints = [];
        this.measureLayer.clearLayers();
      }
    },
    addMeasurePoint(latlng) {
      // Snap to the buoy when clicking within 12 px of it
      const buoy = this.buoyMarker.getLatLng();
      if (this.map.latLngToContainerPoint(latlng).distanceTo(this.map.latLngToContainerPoint(buoy)) < 12) latlng = buoy;
      this.measurePoints.push(latlng);
      this.drawMeasure();
    },
    // The route, a dot on each point, and a label with the total so far at each one; the last
    // also with the bearing of its leg. Clicking a dot removes that point
    drawMeasure() {
      const points = this.measurePoints;
      this.measureLayer.clearLayers();
      L.polyline(points, { interactive: false, color: 'var(--darkBlue)', weight: 2, dashArray: '6 6' }).addTo(this.measureLayer);
      let total = 0;
      points.forEach((point, index) => {
        if (index > 0) total += this.map.distance(points[index - 1], point);
        const dot = L.circleMarker(point, { radius: 5, color: 'white', weight: 2, fillColor: 'var(--darkBlue)', fillOpacity: 1, bubblingMouseEvents: false })
          .addTo(this.measureLayer);
        dot.on('click', () => {
          points.splice(index, 1);
          this.drawMeasure();
        });
        if (index === 0) return;
        const isLast = index === points.length - 1;
        const label = isLast
          ? `${this.formatDistance(total)} · ${Math.round(this.bearing(points[index - 1], point))}°`
          : this.formatDistance(total);
        dot.bindTooltip(label, { permanent: true, direction: 'top', className: 'map-measure' + (isLast ? ' last' : ''), offset: [0, -6] });
      });
    },
    formatDistance(metres) {
      const nauticalMiles = (metres / 1852).toFixed(1);
      return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km (${nauticalMiles} NM)`;
    },
    // WIND ROSE
    // How often the wind blew from each of 16 directions in the buoy's last days of data
    // (petal length), and how strong (colour, the wind scale of the forecast)
    drawWindRose() {
      const source = this.$dataService.buoy.sources
        .map(source => source.findSensorFor('WSPD')?.sensor)
        .filter(sensor => sensor?.rows.length)
        .sort((a, b) => b.rows[b.rows.length - 1].date - a.rows[a.rows.length - 1].date)[0];
      if (source == undefined) return;
      const rows = source.rows.filter(row => row.values.WSPD != undefined && row.values.WDIR != undefined);
      if (rows.length === 0) return;
      const counts = new Array(ROSE_SECTORS).fill(0), speeds = new Array(ROSE_SECTORS).fill(0);
      rows.forEach(({ values }) => {
        const sector = Math.round(values.WDIR / (360 / ROSE_SECTORS)) % ROSE_SECTORS;
        counts[sector]++;
        speeds[sector] += values.WSPD;
      });
      const max = Math.max(...counts);
      const size = 150, center = size / 2, inner = 16, outer = center - 4, half = Math.PI / ROSE_SECTORS * 0.85;
      const point = (angle, radius) => `${(center + radius * Math.sin(angle)).toFixed(1)},${(center - radius * Math.cos(angle)).toFixed(1)}`;
      const petals = counts.map((count, sector) => {
        if (count === 0) return '';
        const angle = sector * 2 * Math.PI / ROSE_SECTORS, radius = inner + (outer - inner) * count / max;
        const [r, g, b] = this.windColor(speeds[sector] / count);
        return `<path d="M${point(angle - half, inner)} L${point(angle - half, radius)} A${radius},${radius} 0 0 1 ${point(angle + half, radius)}
          L${point(angle + half, inner)} A${inner},${inner} 0 0 0 ${point(angle - half, inner)} Z" fill="rgb(${r},${g},${b})"/>`;
      }).join('');
      this.windRoseLayer.clearLayers();
      L.marker(this.buoyMarker.getLatLng(), {
        interactive: false, zIndexOffset: -1000,
        icon: L.divIcon({
          className: 'map-wind-rose', iconSize: [size, size],
          html: `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
            <circle cx="${center}" cy="${center}" r="${outer}" class="map-wind-rose-ring"/>
            <circle cx="${center}" cy="${center}" r="${(inner + outer) / 2}" class="map-wind-rose-ring"/>${petals}</svg>`,
        }),
      }).addTo(this.windRoseLayer);
    },
    windColor(speed) {
      const scale = window.PARTICLES_COLOR_SCALES.wind;
      for (let k = 1; k < scale.length; k++) {
        if (speed <= scale[k][0]) {
          const [s0, c0] = scale[k - 1], [s1, c1] = scale[k];
          return c0.map((c, n) => Math.round(c + (c1[n] - c) * (speed - s0) / (s1 - s0)));
        }
      }
      return scale[scale.length - 1][1];
    },
    // NETWORK BUOYS
    createNetworkBuoy(buoy, buoyLatLng) {
      const marker = L.marker(buoy.latlng, {
        icon: L.divIcon({
          className: 'map-network-buoy', iconSize: [16, 16],
          html: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#f5c400" stroke="var(--darkBlue)" stroke-width="3"/></svg>`,
        }),
      });
      buoy.distance = this.formatDistance(this.map.distance(buoyLatLng, buoy.latlng));
      marker.bindPopup(() => this.networkCardHTML(buoy), { className: 'map-popup', minWidth: 190 });
      marker.on('popupopen', () => {
        if (buoy.data) return;
        this.loadNetworkBuoy(buoy).then(() => marker.getPopup().update());
      });
      return marker;
    },
    // Latest row of the wind, wave and sea temperature sensors
    async loadNetworkBuoy(buoy) {
      const latest = (sensor, columns) => {
        const url = `${ERDDAP}BUOY_${buoy.id}_${sensor}.csv?time,${columns}&orderByMax("time")`;
        return fetch(window.BoiaConfig.proxied(url)).then(res => res.ok ? res.text() : '').then(text => {
          const lines = text.trim().split('\n');
          if (lines.length < 3) return undefined;
          const cells = lines[2].split(',');
          return { date: new Date(cells[0]), values: cells.slice(1).map(parseFloat) };
        }).catch(() => undefined);
      };
      const [wind, wave, ctd] = await Promise.all([
        latest('GILL', 'WSPD_GILL,WDIR_GILL'), latest('WAVE', 'VHM0_WAVE,VMDR_WAVE'), latest('CTD', 'TEMP_CTD'),
      ]);
      buoy.data = { wind, wave, ctd };
    },
    networkCardHTML(buoy) {
      const t = (key) => this.$i18n.t(key);
      const data = buoy.data;
      let body;
      if (data == undefined) {
        body = `<div class="map-card-date">${t("Loading")}...</div>`;
      } else {
        const dates = [data.wind, data.wave, data.ctd].filter(Boolean).map(row => row.date);
        const arrow = (direction) => `<i class="map-card-arrow" style="transform: rotate(${direction + 180}deg)">&#8593;</i>`;
        const value = (row, index, decimals, unit) => row == undefined || isNaN(row.values[index]) ? '-' : `${row.values[index].toFixed(decimals)} ${unit}`;
        body = dates.length === 0 ? `<div class="map-card-date">${t("No data")}</div>` : `
          <div class="map-card-date">${t("Last data")}: ${this.formatTimeAgo((Date.now() - Math.max(...dates)) / 60000)}</div>
          <table class="map-card-table">
            <tr><td>${t("Wind speed")}</td><td>${value(data.wind, 0, 1, 'm/s')} ${data.wind ? arrow(data.wind.values[1]) : ''}</td></tr>
            <tr><td>${t("Wave height")}</td><td>${value(data.wave, 0, 1, 'm')} ${data.wave ? arrow(data.wave.values[1]) : ''}</td></tr>
            <tr><td>${t("Sea temperature")}</td><td>${value(data.ctd, 0, 1, 'ºC')}</td></tr>
          </table>`;
      }
      return `<div class="map-card"><div class="map-card-title">${t("Buoy")} ${buoy.name}</div>${body}
        <div class="map-card-date">${t("From Somorrostro")}: ${buoy.distance}</div></div>`;
    },
    // PATÍ CIENTÍFIC: its temperature profiles of 2021-22, exported once from the old IoT project
    // (tools/export_pati_cientific.py). A station's card shows one of them, chosen by date, over
    // the station's others in grey, on the same axes: how the water column changes over the year
    async drawProfileStations() {
      let data;
      try {
        data = await fetch('data/StaticData/pati_cientific.json').then(res => res.json());
      } catch (error) {
        console.warn('Patí Científic profiles not loaded:', error);
        return;
      }
      data.stations.forEach(station => {
        // The regular stations are numbered; profiles taken elsewhere once or twice, a dot
        const regular = station.id != null;
        const marker = L.marker([station.lat, station.lon], {
          icon: L.divIcon({
            className: 'map-profile-station' + (regular ? '' : ' minor'),
            iconSize: regular ? [20, 20] : [10, 10],
            html: regular ? `<span>${station.id}</span>` : '',
          }),
        });
        station.selected = station.profiles.length - 1; // The latest
        marker.bindPopup(() => this.profileCardHTML(station), { className: 'map-popup', minWidth: 236, maxWidth: 260 });
        marker.on('popupopen', () => this.bindProfileCard(marker, station));
        this.profilesLayer.addLayer(marker);
      });
    },
    // The card's date controls: they draw it again with another profile
    bindProfileCard(marker, station) {
      const element = marker.getPopup().getElement();
      if (!element) return;
      // Drawn again once the click is over: a button taken out of the page in the middle of its
      // click would reach the map as a click on it, which closes the card
      const select = (event, index) => {
        event.stopPropagation();
        station.selected = Math.max(0, Math.min(station.profiles.length - 1, index));
        setTimeout(() => {
          marker.getPopup().update();
          this.bindProfileCard(marker, station);
        });
      };
      element.querySelector('.map-profile-select')?.addEventListener('change', (e) => select(e, Number(e.target.value)));
      element.querySelector('.map-profile-prev')?.addEventListener('click', (e) => select(e, station.selected - 1));
      element.querySelector('.map-profile-next')?.addEventListener('click', (e) => select(e, station.selected + 1));
      // The water columns of that date at all the stations, in the 3D view (see GUIManager.patiDate)
      element.querySelector('.map-profile-3d')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.$gui.patiDate = station.profiles[station.selected].date;
      });
      // The station's water column over the year, in the history section (see WaterColumnChart)
      element.querySelector('.map-profile-year')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.$gui.waterColumnStation = station.id;
        this.$gui.selectedSection = 'history';
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
      });
    },
    profileCardHTML(station) {
      const t = (key) => this.$i18n.t(key);
      const profiles = station.profiles;
      const profile = profiles[station.selected];
      const dateText = (p) => new Date(p.date + 'T12:00:00').toLocaleDateString(this.$i18n.locale, { day: 'numeric', month: 'short', year: 'numeric' })
        + (p.time ? ` · ${p.time}` : '');
      const title = station.id != null ? `${t("Station")} ${station.id}` : t("Profile");
      const date = profiles.length > 1 ? `
        <div class="map-profile-nav">
          <button class="map-profile-prev" ${station.selected === 0 ? 'disabled' : ''} aria-label="${t("Previous")}">&#8249;</button>
          <select class="map-profile-select" aria-label="${t("Date")}">
            ${profiles.map((p, n) => `<option value="${n}" ${n === station.selected ? 'selected' : ''}>${dateText(p)}</option>`).join('')}
          </select>
          <button class="map-profile-next" ${station.selected === profiles.length - 1 ? 'disabled' : ''} aria-label="${t("Next")}">&#8250;</button>
        </div>` : `<div class="map-card-date">${dateText(profile)}</div>`;
      const last = profile.depth.length - 1;
      return `<div class="map-card">
        <div class="map-card-title">${title} <span class="map-profile-source">· Patí Científic</span></div>
        <div class="map-card-note">${t("Temperature by depth")}</div>
        ${date}
        ${this.profileChartSVG(profiles, station.selected)}
        <table class="map-card-table">
          <tr><td>${t("Surface")}</td><td>${profile.temperature[0].toFixed(1)} ºC</td></tr>
          <tr><td>${t("Bottom")} (${profile.depth[last].toFixed(0)} m)</td><td>${profile.temperature[last].toFixed(1)} ºC</td></tr>
        </table>
        <div class="map-card-note">${profiles.length} ${t("profiles")} · ${profiles[0].date.slice(0, 4)}–${profiles[profiles.length - 1].date.slice(2, 4)} · ICM-CSIC</div>
        ${station.id != null ? `<div class="map-profile-buttons">
          <button class="map-card-button map-profile-year">${t("Over the year")}</button>
          <button class="map-card-button map-profile-3d">${t("pati3d.inThreeD")}</button>
        </div>` : ''}
        <a class="map-card-link" href="${profile.doi}" target="_blank" rel="noopener">${t("Data on Zenodo")} &#8599;</a>
      </div>`;
    },
    // Temperature (top axis) against depth (down), as oceanographers draw them: the selected
    // profile in blue over the station's others, on axes fitting them all
    profileChartSVG(profiles, selected) {
      const W = 230, H = 170, left = 26, right = 8, top = 18, bottom = 6;
      const temperatures = profiles.flatMap(p => p.temperature);
      const t0 = Math.floor(Math.min(...temperatures)), t1 = Math.ceil(Math.max(...temperatures));
      const d1 = Math.max(5, Math.ceil(Math.max(...profiles.flatMap(p => p.depth)) / 5) * 5);
      const x = (t) => left + (t - t0) / (t1 - t0 || 1) * (W - left - right);
      const y = (d) => top + d / d1 * (H - top - bottom);
      const line = (p) => p.depth.map((d, n) => `${x(p.temperature[n]).toFixed(1)},${y(d).toFixed(1)}`).join(' ');
      const tStep = t1 - t0 > 8 ? 4 : 2;
      const dStep = d1 > 20 ? 10 : 5;
      let grid = '';
      for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1; t += tStep) {
        grid += `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${H - bottom}" class="map-profile-grid"/>
          <text x="${x(t)}" y="${top - 5}" text-anchor="middle">${t}</text>`;
      }
      for (let d = 0; d <= d1; d += dStep) {
        grid += `<line x1="${left}" x2="${W - right}" y1="${y(d)}" y2="${y(d)}" class="map-profile-grid"/>
          <text x="${left - 4}" y="${y(d) + 3}" text-anchor="end">${d}</text>`;
      }
      const others = profiles.map((p, n) => n === selected ? '' : `<polyline points="${line(p)}" class="map-profile-other"/>`).join('');
      return `<svg class="map-profile-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        ${grid}
        <text x="${W - right}" y="${top - 5}" text-anchor="end" class="map-profile-unit">ºC</text>
        <text x="2" y="${top - 5}" class="map-profile-unit">m</text>
        ${others}
        <polyline points="${line(profiles[selected])}" class="map-profile-line"/>
      </svg>`;
    },
    // Opens the card of what was tapped in the 3D view ('buoy' or a ship's MMSI), and pans to it
    showPicked(picked) {
      const marker = picked === 'buoy' ? this.buoyMarker : this.ships[picked]?.marker;
      if (!marker) return;
      this.map.panTo(marker.getLatLng());
      marker.openPopup();
    },
    // SHIPS (AIS)
    drawAISCoverage() {
      if (!window.AISManager) return;
      if (this.aisCoverage) this.aisCoverage.remove();
      this.aisCoverage = L.layerGroup(window.AISManager.bboxes.map(bbox => L.rectangle(bbox, {
        interactive: false, color: 'var(--darkBlue)', weight: 1, opacity: 0.35, dashArray: '2 6', fill: false,
      }))).addTo(this.map);
    },
    // Boats without AIS, our vehicles, categories and headings: see vesselInfo.js
    isPati(ship) {
      return window.VesselInfo.isPati(ship);
    },
    isBlueBoat(ship) {
      return window.VesselInfo.isBlueBoat(ship);
    },
    shipCategory(ship) {
      return window.VesselInfo.shipCategory(ship);
    },
    shipHeading(ship) {
      return window.VesselInfo.shipHeading(ship);
    },
    // Arrow pointing where it heads, a dot when stopped, a diamond for aids to navigation.
    // Bigger for long ships
    // Our vehicles (see ownAssets.js) in our blue ring, pulsing while they transmit
    shipIcon(ship) {
      const icon = this.baseShipIcon(ship);
      if (!window.OwnAssets.ownGroupOf(ship.MMSI)) return icon;
      const live = window.OwnAssets.isLive(ship);
      return L.divIcon({ ...icon.options, className: 'map-ship map-own',
        html: `<div class="map-own-ring${live ? ' live' : ''}"></div>${icon.options.html}` });
    },
    // Our equipment's tag on its card: who it belongs to
    ownTagHTML(owner) {
      return `<div class="map-own-tag">${this.$i18n.t("Own equipment")}${owner ? ' · ' + owner : ''}</div>`;
    },
    baseShipIcon(ship) {
      const { color } = this.shipCategory(ship);
      const heading = this.shipHeading(ship);
      const size = ship.length > 100 ? 26 : 20;
      let shape;
      if (this.isPati(ship)) {
        // A sail over a hull, pointing where it heads
        shape = `<g transform="rotate(${heading || 0} 10 10)" stroke="white" stroke-width="1.2" stroke-linejoin="round">
          <path d="M10 1 L10 13 L4 13 Z" fill="${color}"/><path d="M5 15 L15 15 L13 18 L7 18 Z" fill="${color}"/></g>`;
        return L.divIcon({ className: 'map-ship', html: `<svg viewBox="0 0 20 20" width="26" height="26">${shape}</svg>`,
          iconSize: [26, 26], iconAnchor: [13, 13] });
      } else if (this.isBlueBoat(ship)) {
        // Two hulls seen from above, pointing where it heads
        shape = `<g transform="rotate(${heading || 0} 10 10)" fill="${color}" stroke="#1d2329" stroke-width="1">
          <rect x="4" y="2.5" width="3.6" height="15" rx="1.8"/><rect x="12.4" y="2.5" width="3.6" height="15" rx="1.8"/>
          <rect x="6" y="8" width="8" height="4" fill="#1d2329"/></g>`;
        return L.divIcon({ className: 'map-ship', html: `<svg viewBox="0 0 20 20" width="24" height="24">${shape}</svg>`,
          iconSize: [24, 24], iconAnchor: [12, 12] });
      } else if (String(ship.MMSI).startsWith('99')) {
        shape = `<path d="M10 3 L17 10 L10 17 L3 10 Z" fill="${color}" stroke="white" stroke-width="1.5"/>`;
      } else if (ship.sog >= 0.5 && heading != undefined) {
        shape = `<path d="M10 1 L16 18 L10 14.5 L4 18 Z" fill="${color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"
          transform="rotate(${heading} 10 10)"/>`;
      } else {
        shape = `<circle cx="10" cy="10" r="5" fill="${color}" stroke="white" stroke-width="1.5"/>`;
      }
      return L.divIcon({
        className: 'map-ship',
        html: `<svg viewBox="0 0 20 20" width="${size}" height="${size}">${shape}</svg>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    },
    // A new AIS message: moves the ship and extends its trail
    handleAISMessage(ship) {
      if (ship.latitude == undefined || ship.longitude == undefined) return;
      const position = [ship.latitude, ship.longitude];
      let entry = this.ships[ship.MMSI];
      if (entry == undefined) {
        entry = this.ships[ship.MMSI] = {
          trail: L.polyline([], { interactive: false, weight: 2, opacity: 0.5 }).addTo(this.shipsLayer),
          marker: L.marker(position, { icon: this.shipIcon(ship) })
            .bindPopup(() => this.shipCardHTML(ship), { className: 'map-popup', minWidth: 190 })
            .on('click', () => window.sceneManager?.follow(ship.MMSI))
            .addTo(this.shipsLayer),
        };
      }
      entry.marker.setLatLng(position);
      entry.marker.setIcon(this.shipIcon(ship));
      entry.trail.setStyle({ color: this.shipCategory(ship).color });
      // Only when it has moved (~10 m), so ships at anchor don't pile up points
      const points = entry.trail.getLatLngs();
      const last = points[points.length - 1];
      if (last == undefined || this.map.distance(last, position) > 10) {
        entry.trail.setLatLngs(points.concat([position]).slice(-TRAIL_POINTS));
      }
      if (entry.marker.isPopupOpen()) entry.marker.getPopup().update();
    },
    // A ship's card, from what vesselInfo.js says of it (the 3D view's card shows the same)
    shipCardHTML(ship) {
      const t = (key) => this.$i18n.t(key);
      const info = window.VesselInfo.vesselInfo(ship, t);
      const rows = info.rows.map(row => `<tr><td>${row.label}</td><td>${row.value}${row.heading == undefined ? ''
        : ` <i class="map-card-arrow" style="transform: rotate(${row.heading}deg)">&#8593;</i>`}</td></tr>`).join('');
      const tag = info.tag ? `<div class="map-own-tag${info.tag.simulated ? ' map-simulated-tag' : ''}">${info.tag.text}</div>` : '';
      const footer = info.link ? `<a class="map-card-link" href="${info.link.href}" target="_blank" rel="noopener">${info.link.text} &#8599;</a>`
        : info.note ? `<div class="map-card-note">${info.note}</div>` : '';
      return `<div class="map-card">
        <div class="map-card-title">${info.title}</div>
        ${tag}
        <div class="map-card-date"><span class="map-ship-dot" style="background: ${info.category.color}"></span>${t(info.category.label)}
          · ${this.formatTimeAgo(info.minutes)}</div>
        <table class="map-card-table">${rows}</table>
        ${footer}
      </div>`;
    },
    // When the fleet tracker starts or stops answering: the open cards, current
    updateShipCards() {
      Object.values(this.ships).forEach(({ marker }) => {
        if (marker.isPopupOpen()) marker.getPopup().update();
      });
    },
    // Same steps as WindSection.formatTimeAgo, in minutes (see vesselInfo.js)
    formatTimeAgo(minutes) {
      return window.VesselInfo.timeAgo(minutes, (key, values) => this.$t(key, values));
    },
    // Keeps the "x min ago" of an open ship card current
    startUpdateLoop() {
      this.intervalId = setInterval(() => {
        Object.values(this.ships).forEach(({ marker }) => {
          if (marker.isPopupOpen()) marker.getPopup().update();
        });
      }, 10 * 1000);
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
  cursor: pointer;
}
.map-forecast-chevron {
  display: inline-block;
  font-style: normal;
  transition: transform 0.2s;
}
.map-forecast-control.collapsed .map-forecast-chevron {
  transform: rotate(-90deg);
}
.map-forecast-control.collapsed .map-forecast-legends {
  display: none;
}
@media screen and (max-width: 770px) {
  .map-forecast-control {
    width: 180px;
  }
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
/* OUR EQUIPMENT (see ownAssets.js): a blue ring, that pulses while it transmits */
.map-own-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 32px;
  height: 32px;
  margin: -16px 0 0 -16px;
  box-sizing: border-box;
  border: 2px solid var(--blue);
  border-radius: 50%;
  background: rgba(var(--blueRGB), 0.1);
}
.map-own-ring.live::after {
  content: '';
  position: absolute;
  inset: -2px;
  border: 2px solid var(--blue);
  border-radius: 50%;
  animation: map-own-pulse 2s ease-out infinite;
}
@keyframes map-own-pulse {
  from { transform: scale(1); opacity: 0.8; }
  to { transform: scale(2); opacity: 0; }
}
.map-own svg {
  position: relative; /* Over the ring */
}
.map-buoy-ring {
  width: 34px;
  height: 34px;
  margin: -17px 0 0 -17px;
}
.map-simulated-tag {
  background: #e0a21b !important;
}
.map-own-tag {
  display: inline-block;
  margin: 2px 0 4px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--blue);
  color: white;
  font-size: 0.62rem;
  font-weight: 600;
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
.map-card-note {
  font-size: 0.68rem;
  opacity: 0.75;
  margin-bottom: 4px;
}
.map-card-link {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--blue);
}
.map-card-arrow {
  display: inline-block;
  font-style: normal;
}
.map-wind-rose svg {
  opacity: 0.75;
}
.map-wind-rose-ring {
  fill: none;
  stroke: var(--darkBlue);
  stroke-opacity: 0.25;
  stroke-dasharray: 2 3;
}
/* PATÍ CIENTÍFIC: its stations, and the profile on their cards */
/* Past data (a project or campaign): hollow, with a dashed edge, unlike what is out there now */
.map-profile-station {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  border: 2px dashed #12a39a;
  box-sizing: border-box;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}
.map-profile-station span {
  color: #0e7f78;
  font-size: 0.65rem;
  font-weight: 700;
  text-shadow: none;
}
.map-profile-station.minor {
  border: 1.5px solid #12a39a;
  opacity: 0.85;
}
.map-profile-source {
  font-weight: 400;
  font-size: 0.75rem;
  opacity: 0.75;
}
.map-profile-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 2px;
}
.map-profile-nav select {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 0.75rem;
  color: var(--darkBlue);
  padding: 2px 4px;
  border: 1px solid rgba(var(--darkBlueRGB), 0.3);
  border-radius: 6px;
  background: white;
}
.map-profile-nav button {
  flex: none;
  width: 26px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(var(--darkBlueRGB), 0.3);
  border-radius: 6px;
  background: white;
  color: var(--darkBlue);
  text-shadow: none;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}
.map-profile-nav button:disabled {
  opacity: 0.35;
  cursor: default;
}
.map-profile-chart {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 4px 0;
}
.map-profile-chart text {
  font-size: 9px;
  fill: var(--darkBlue);
  opacity: 0.7;
}
.map-profile-chart .map-profile-unit {
  font-weight: 700;
  opacity: 0.9;
}
.map-profile-grid {
  stroke: var(--darkBlue);
  stroke-opacity: 0.12;
}
.map-profile-other {
  fill: none;
  stroke: var(--darkBlue);
  stroke-opacity: 0.13;
  stroke-width: 1;
}
.map-profile-line {
  fill: none;
  stroke: #12a39a;
  stroke-width: 2.2;
  stroke-linejoin: round;
}
.map-network-buoy svg {
  width: 16px;
  height: 16px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
}
.map-measure {
  background: var(--darkBlue);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 0.7rem;
}
.map-measure::before {
  border-top-color: var(--darkBlue);
}
.map-measure:not(.last) {
  opacity: 0.8;
  font-size: 0.62rem;
  padding: 2px 5px;
}
.leaflet-bar a.map-center-button.active {
  background-color: var(--blue);
}
.map-measuring {
  cursor: crosshair !important;
}
.map-center-button {
  display: flex !important;
  align-items: center;
  justify-content: center;
}
.map-ship-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 5px;
}
.map-ship svg {
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
}
.map-profile-buttons {
  display: flex;
  gap: 6px;
}
.map-card .map-card-button {
  width: 100%;
  padding: 6px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
}

/* CONTROLS like the rest of the app */
.leaflet-container {
  font-family: inherit;
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
/* A group's heading in the layer list (see GroupedLayers) */
.map-layers-group {
  margin: 8px 0 2px;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.6;
}
.map-layers-group:first-child {
  margin-top: 0;
}
</style>