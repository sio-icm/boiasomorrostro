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

    // Base maps: OpenStreetMap toned down to the app's blues by default (see .map-tiles-soft),
    // and the sea depth (bathymetry) as alternative
    const lightMap = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      className: 'map-tiles-soft',
      maxZoom: 17,
    }).addTo(map);
    const bathymetry = L.tileLayer("https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://emodnet.ec.europa.eu/en/bathymetry" target="_blank">EMODnet Bathymetry</a>',
      maxZoom: 17,
    });
    // Nautical marks on top: buoys, beacons, lighthouses, channels
    const seamarks = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openseamap.org" target="_blank">OpenSeaMap</a>',
      maxZoom: 17,
    }).addTo(map);
    L.control.layers(
      { [this.$i18n.t("Light map")]: lightMap, [this.$i18n.t("Bathymetry")]: bathymetry },
      { [this.$i18n.t("Nautical marks")]: seamarks },
      { position: 'topright' }
    ).addTo(map);
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
    window.removeEventListener('resize', this.invalidateMapSize);
  },


  methods: {
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