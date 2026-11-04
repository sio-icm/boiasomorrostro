<template>
  <!-- Container -->
  <div id="canvas3Dcontainer">
    <canvas id="canvas3D" ref="canvas3D"></canvas>



  </div>
</template>



<script>
// Import components

//import Map from "Map.vue";

export default {
  name: "Canvas3D",
  created() {
    
  },
  mounted() {
    // Also global, for the map's view cone (see MapBuoyLocation.vue)
    this.sceneManager = window.sceneManager = new window.SceneManager(this.$refs.canvas3D);
    this.sceneManager.startRender();
    this.sceneManager.windowWasResized();

    // Event listeners
    // Window resize
    window.addEventListener('resize', (e) => {
      // HACK: for some reason, using windows + arrows resizes the window and calls the event, but the width and height are not correct
      setTimeout(() => {this.sceneManager.windowWasResized()}, 100); 
    });
    // ***** INSTRUMENTS PANEL *****
    // Center on instruments
    window.eventBus.on('InstrumentsMenu_buoyButtonClicked', () => {
      this.sceneManager.focusOnBuoy();
    });
    window.eventBus.on('InstrumentsMenu_baseButtonClicked', () => {
      this.sceneManager.focusOnBase();
    });
    window.eventBus.on('AppManager_fpsButtonClicked', () => {
      this.sceneManager.showHideFPS();
    });

    // ***** TOP-RIGHT ICONS *****
    // Face northward
    window.eventBus.on('TopRightMenu_compassButtonClicked', () => {
      this.sceneManager.faceNorthward();
    });




    // ********** CMEMS DATA **********
    window.eventBus.on('WidgetExternalData_CMEMSDataLoaded', dataValues => {
      
      // Wave sign. height
      this.sceneManager.ocean.updateWaveSignificantHeight(dataValues['Wave significant height'].value);
      // Wave direction
      this.sceneManager.ocean.updateMeanWaveDirection(dataValues['Wave direction'].value);
      // Calculate spread according to difference between wave and wind wave direction
      let angleDiff = Math.abs(dataValues['Wave direction'].value - dataValues['Wind wave direction'].value);
      let dirSpreading = Math.min(Math.max(30, angleDiff * 2), 180);
      this.sceneManager.ocean.updateDirectionalSpread(dirSpreading);
      // Steepness based on wind wave
      let percentageWindWave = dataValues['Wind wave significant height'].value / dataValues['Wave significant height'].value;
      let steepness = 0.05 + 0.25 * Math.min(1, percentageWindWave); // TODO: use wind wave directly?
      this.sceneManager.ocean.updateSteepness(steepness);

      // Swell 1
      this.generateSwell(dataValues['Primary swell wave significant height'].value, dataValues['Primary swell wave direction'].value);
      // Swell 2
      this.generateSwell(dataValues['Secondary swell wave significant height'].value, dataValues['Secondary swell wave direction'].value, 1);

      // Flag
      if (this.sceneManager.flag) {
        this.sceneManager.flag.showFlag();
        // Phillips, O.M. 1957. On the generation of waves by turbulent wind. Journal of Fluid Mechanics. 2 (5): 417–445.
        // Hs = C * (U^2 / g)
        let wwHm0 = dataValues['Wind wave significant height'].value;
        let C = 0.08;
        let U = Math.sqrt(wwHm0 * 9.81 / C); // wind speed in m/s
        this.sceneManager.flag.setWindParameters('windSpeed', U * 3.6); // km/h
        this.sceneManager.flag.setWindParameters('windDirection', dataValues['Wind wave direction'].value);
      }
    })






    // ***** TIME BAR WITH DATA *****
    // In Casablanca, this is only called in the initial load
    const updateData = (dataInTimestamp) => {
      // Ocean
      if (this.sceneManager.ocean){
        if (dataInTimestamp['Hm0']){
          // TODO: THIS CALLS GENERATEWAVES 3 TIMES (PARAMETERS COULD BE SET AT ONCE)
          this.sceneManager.ocean.updateWaveSignificantHeight(dataInTimestamp['Hm0']);
          this.sceneManager.ocean.updateMeanWaveDirection(dataInTimestamp['Mdir']);
          this.sceneManager.ocean.updateDirectionalSpread(dataInTimestamp['Spr1']);
          // Generate swell
          this.generateSwell(dataInTimestamp['Hm0'], dataInTimestamp['Mdir']);
          // Calculate steepness
          let steepness = 0.1 + 0.3 * Math.min(1, dataInTimestamp['Hm0'] / 6);
          this.sceneManager.ocean.updateSteepness(steepness);
        } else if (this.forecastWaves) { // No measured waves (Somorrostro has no wave sensor): keep the forecast ones
        } else { // No ocean data
          this.sceneManager.ocean.updateWaveSignificantHeight(0.1);
          this.sceneManager.ocean.updateMeanWaveDirection(0);
          this.sceneManager.ocean.updateDirectionalSpread(180);
          this.sceneManager.ocean.updateSteepness(0.05);
          // Reset swell
          this.generateSwell(0.05, 180);
        }
      }
      // Wind
      // Ocean steepness
      // Where the wind comes from, for the patí's sail (see PatiEntity)
      if (dataInTimestamp['WDIR'] != undefined) this.sceneManager.windDirection = dataInTimestamp['WDIR'];
      if (dataInTimestamp['WSPD'] && this.sceneManager.ocean){
        let windKMH = dataInTimestamp['WSPD'] * 3.6;
        let steepness = 0.05 + 0.25 * Math.min(1, windKMH / 25);
        this.sceneManager.ocean.updateSteepness(steepness);
      }
      if (this.sceneManager.flag){
        if (dataInTimestamp['WSPD']){
          this.sceneManager.flag.showFlag();
          this.sceneManager.flag.setWindParameters('windSpeed', dataInTimestamp['WSPD'] * 3.6); // km/h
          this.sceneManager.flag.setWindParameters('windDirection', dataInTimestamp['WDIR']);
        } else { // Hide flag when there is no wind data
          this.sceneManager.flag.hideFlag();
        }
      }// Wind text
      if (this.sceneManager.windText){
        if (dataInTimestamp['WSPD']) {
          let text = (dataInTimestamp['WSPD'] * 3.6).toFixed(1);
          this.sceneManager.windText.updateText(text + " km/h");
        } else
          this.sceneManager.windText.removeText();
      }
      // Currents
      if (this.sceneManager.currents && dataInTimestamp['UCUR_0m']){
        this.sceneManager.currents.showCurrents();
        this.sceneManager.currents.setCurrentParameters(dataInTimestamp);
      } else if (this.sceneManager.currents) {
        this.sceneManager.currents.hideCurrents();
      }

      // Temperature and salinity texts
      if (this.sceneManager.tempText)
        if (dataInTimestamp['TEMP'])
          this.sceneManager.tempText.updateText(dataInTimestamp['TEMP'].toFixed(1) + " C");
        else
          this.sceneManager.tempText.removeText();
      if (this.sceneManager.salText)
        if (dataInTimestamp['PSAL'])
          this.sceneManager.salText.updateText(dataInTimestamp['PSAL'].toFixed(1) + " psu");
        else
          this.sceneManager.salText.removeText();

    };
    
    window.eventBus.on('DataStreamsBar_dataDailyUpdate', updateData);
    window.eventBus.on('DataStreamsBar_dataHalfHourlyUpdate', updateData);

    // ***** SEA PANEL *****
    // Change ocean steepness
    window.eventBus.on('SeaPanel_steepnessSliderClicked', (steepness) => {
      if (this.sceneManager.ocean)
        this.sceneManager.ocean.updateSteepness(steepness);
    });
    // Change wave significant height
    window.eventBus.on('SeaPanel_waveSignificantHeightSliderClicked', (hm0) => {
      if (this.sceneManager.ocean)
        this.sceneManager.ocean.updateWaveSignificantHeight(hm0);
    });
    // Change mean wave direction
    window.eventBus.on('SeaPanel_meanWaveDirectionKnobClicked', (mdir) => {
      if (this.sceneManager.ocean)
        this.sceneManager.ocean.updateMeanWaveDirection(mdir);
    });
    // Change swell 1
    window.eventBus.on('SeaPanel_swell1HeightSliderClicked', (height) => {
      if (this.sceneManager.ocean)
        this.sceneManager.ocean.updateSwell('height',height, 0);
    });
    window.eventBus.on('SeaPanel_swell1DirectionKnobClicked', (direction) => {
      if (this.sceneManager.ocean)
        this.sceneManager.ocean.updateSwell('direction', direction, 0);
    });
    window.eventBus.on('SeaPanel_swell1SteepnessSliderClicked', (steepness) => {
      if (this.sceneManager.ocean)
        this.sceneManager.ocean.updateSwell('steepness', steepness, 0);
    });
    // ***** WIND PANEL *****
    // Change wind
    window.eventBus.on('WindPanel_windSpeedSliderClicked', (windSpeed) => {
      if (this.sceneManager.flag)
        this.sceneManager.flag.setWindParameters('windSpeed', windSpeed);
      if (this.sceneManager.windText)
        this.sceneManager.windText.updateText(windSpeed.toFixed(1) + ' km/h');
    });
    window.eventBus.on('WindPanel_windDirectionKnobClicked', (direction) => {
      if (this.sceneManager.flag)
        this.sceneManager.flag.setWindParameters('windDirection', direction);
    });



    // ****** WAVES FORECAST *****
    // The buoy measures no waves, so the sea follows the forecast at the buoy, refreshed hourly
    // The moment shown (see GUIManager.selectedTime): sky, sea and wind for it. Again every hour,
    // so the present moves on and the forecast is refreshed
    this.applyMoment();
    window.eventBus.on('GUIManager_timeChanged', () => this.applyMoment());
    this.waveForecastInterval = setInterval(this.applyMoment, 60 * 60 * 1000);

    // ****** LOADING SCREEN  - INITIAL PARAMETERS *****
    window.eventBus.on('SceneManager_LoadingComplete', () => {
        let params = {
        'Hm0': 0.3,
        'Mdir': 97,
        'Spr1': 40,
        'WSPD': 6,
        'WDIR': 180,
      }
      updateData(params);
      this.applyMoment(); // The defaults above stand in until the forecast loads
    });

    



    // Tapping the buoy or a vessel goes to it, and tells the map (which opens its card).
    // A tap, not a drag: the pointer barely moved and was quickly released
    const canvas = this.$refs.canvas3D;
    let down;
    canvas.addEventListener('pointerdown', (e) => down = { x: e.clientX, y: e.clientY, time: e.timeStamp });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || e.timeStamp - down.time > 400) return;
      const rect = canvas.getBoundingClientRect();
      const picked = this.sceneManager.pickAt(e.clientX - rect.left, e.clientY - rect.top);
      if (picked == undefined) return;
      if (picked === 'buoy') this.sceneManager.focusOnBuoy();
      else this.sceneManager.follow(picked);
      window.eventBus.emit('Canvas3D_objectPicked', picked);
    });

    // Event emitters
    // Listeners: TopRightMenu, BottomSection
    this.sceneManager.controls.addEventListener('change', (e) => {
      window.eventBus.emit('Canvas3D_cameraChange', this.sceneManager);

      // Update text mesh
      if (this.sceneManager.scene){
        if (this.sceneManager.windText){
          this.sceneManager.windText.faceCamera();
        }
      }

    });

  },
  data() {
    return {

    }
  },
  methods: {
    // Sky, sea and wind of the moment shown (see GUIManager.selectedTime)
    async applyMoment() {
      const date = this.$gui.moment;
      this.sceneManager.setSkyTime(this.$gui.selectedTime); // undefined: now, and moving on
      await this.loadWaveForecast(date);
      await this.applyWind(date);
    },
    // Wind at the buoy at a moment: measured if there is data for that hour, else forecast.
    // Sets how steep (choppy) the sea is, and the sail of a patí (see PatiEntity)
    async applyWind(date) {
      const data = this.$dataService;
      let speed = await data.buoy.getValueAt('WSPD', date, 60);
      let direction = await data.buoy.getValueAt('WDIR', date, 60);
      if (speed == undefined) {
        speed = await data.weather.getValueAt('WSPD', date);
        direction = await data.weather.getValueAt('WDIR', date);
      }
      if (direction != undefined) this.sceneManager.windDirection = direction;
      if (speed != undefined && this.sceneManager.ocean) {
        this.sceneManager.ocean.updateSteepness(0.05 + 0.25 * Math.min(1, speed * 3.6 / 25));
      }
    },
    // Sea state at the buoy at a moment from Open-Meteo Marine (Copernicus Mediterranean waves
    // model), hourly from 3 days ago to 3 ahead: total sea, wind sea and the two swells,
    // applied as the CMEMS data used to be (see above)
    async loadWaveForecast(date = new Date()) {
      const variables = ['wave_height', 'wave_direction', 'wind_wave_height', 'wind_wave_direction', 'swell_wave_height',
        'swell_wave_direction', 'secondary_swell_wave_height', 'secondary_swell_wave_direction'];
      const url = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + (window.LATITUDE || 41.375694)
        + '&longitude=' + (window.LONGITUDE || 2.216194) + '&hourly=' + variables.join(',') + '&past_days=3&forecast_days=3&timezone=UTC';
      let hourly;
      try {
        hourly = (await (await window.FetchManager.fetch(url, 30)).json()).hourly;
      } catch (error) {
        console.warn('Could not load the waves forecast', error);
        return;
      }
      const ocean = this.sceneManager.ocean;
      if (!ocean || !hourly) return;
      // The hour closest to the moment
      let index = 0;
      hourly.time.forEach((time, i) => {
        if (Math.abs(Date.parse(time + 'Z') - date) < Math.abs(Date.parse(hourly.time[index] + 'Z') - date)) index = i;
      });
      const waves = Object.fromEntries(variables.map(variable => [variable, hourly[variable][index]]));
      if (waves.wave_height == undefined) return;
      this.forecastWaves = waves;
      const height = Math.max(0.1, waves.wave_height);
      ocean.updateWaveSignificantHeight(height);
      ocean.updateMeanWaveDirection(waves.wave_direction);
      // Spread: narrow for one wave system, wider the more wind sea comes from elsewhere.
      // Never all around, which makes a sea of bumps
      const windShare = Math.min(1, (waves.wind_wave_height || 0) / height);
      const angleDiff = Math.abs(((waves.wave_direction - waves.wind_wave_direction + 540) % 360) - 180);
      ocean.updateDirectionalSpread(Math.min(90, Math.max(25, 25 + angleDiff * windShare)));
      ocean.updateSteepness(0.05 + 0.25 * windShare);
      // The 16 waves already make up the whole sea, swell included; the swell's own (perfectly
      // regular) wave only hints at it, or it shows as even bands
      this.generateSwell(Math.max(0.05, (waves.swell_wave_height || 0) * 0.35), waves.swell_wave_direction ?? waves.wave_direction);
      // A small secondary swell crossing the main one looks like a grid of bumps rather than a
      // sea: only shown when it's at least a third of the main swell
      const primary = waves.swell_wave_height || 0, secondary = waves.secondary_swell_wave_height || 0;
      if (secondary >= Math.max(0.15, primary / 3)) this.generateSwell(secondary, waves.secondary_swell_wave_direction, 1);
      // Flat: even 5 cm is a perfectly regular train of short ripples. Not 0, which the
      // shader divides by
      else this.sceneManager.ocean.updateSwell('height', 0.001, 1);
    },
    //onclick: function(e){},    
    generateSwell: function(Hm0, Mdir, index) {
      // Calculate steepness
      let steepness = 0.1 + 0.2 * Math.min(1, Hm0/3);
      if (Hm0 < 0.1) steepness = 0.05;
      this.sceneManager.ocean.updateSwell('height', Hm0, index);
      this.sceneManager.ocean.updateSwell('direction', Mdir, index);
      this.sceneManager.ocean.updateSwell('steepness', steepness, index);
    },
  },
  components: {
    //"ol-map": Map,
  }
}
</script>


<style scoped>
#canvas3Dcontainer{
  position: relative;
  width: 100%;
  height: 100%;
}

#canvas3D {
  width: 100%;
  height: 100%;
  position: absolute;
  background-color: red;
  z-index: 0;
}
</style>