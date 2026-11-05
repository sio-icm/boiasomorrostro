<template>
  
  <div id="sea-state-analysis-panel" ref="sea-state-analysis-panel" class="content">

    <p>In this section the sea state is analized and standard measures are provided, such as the Hm0, Hmax, Ts, Tp... These measures are provided
      by measuring the height at the position 0,0 for a given period of time.
    </p>

    <p>In the following table you can configure the sampling rate and the duration of the measurement.</p>

    <!-- TABLE -->
    <div class="container-vertical options">
      <!-- DURATION -->
      <div class="container-horizontal">
        <span>Duration</span>
        <div><input type="range" min="10" max="50" :value="duration" @input="durationChanged"><span>{{ duration }} minutes</span></div>
      </div>
      <!-- SAMPLING RATE -->
      <div class="container-horizontal">
        <span>Sampling rate</span>
        <div><input type="range" step="0.1" min="0.5" max="5" :value="samplingRate"  @input="samplingRateChanged"><span>{{ samplingRate }} /s</span></div>
      </div>
    </div>

    <!-- Wave signal -->
    <p>
      <strong>Sea surface height at point 0,0</strong>
    </p>
    <div id="wave-height-chart" class="chart" ref="wave-height-chart"></div>

    <p>
      <strong>Spectrum</strong>
    </p>
    <div id="wave-spectrum-chart" class="chart" ref="wave-spectrum-chart"></div>

  </div>
  

</template>






<script>




export default {
  name: "SeaStateAnalysisPanel",
  created() {
    this.oceanAnalysis = new window.OceanAnalysis(this.samplingRate, this.duration * 60);
  },
  mounted() {
    // If scene exists, analyize waves
    if (window.sceneManager != undefined){
      this.update();
    }
    // Events
    window.eventBus.on('DiscreteWavesPanel_setDiscreteWaves', (discreteWaves) => {
      this.discreteWaves = discreteWaves;
      // Analize parameters
    });

    // Window resize
    window.addEventListener('resize', this.windowResize);
  },
  unmounted() {
    window.removeEventListener('resize', this.windowResize);
  },
  data() {
    return {
      duration: 20,
      samplingRate: 3,
    }
  },
  methods: {

    // USER INPUT
    durationChanged: function(e){
      this.duration = e.target.value;
      this.update();
    },
    samplingRateChanged: function(e){
      this.samplingRate = e.target.value;
      this.update();
    },

    // Update data
    update: function(){
      // Get discrete waves
      this.discreteWaves = window.sceneManager.getDiscreteWaves();
      // Generate signal
      let signal = this.oceanAnalysis.createSignal(this.discreteWaves, this.samplingRate, this.duration * 60);
      // Update heights chart
      this.updateHeightsChart(signal);
      // Calculate spectrum
      let spectrumMag = this.oceanAnalysis.getSpectrumMagnitude(this.discreteWaves);
      // TODO
    },

    // Update chart
    updateHeightsChart: function(signal){
      // Prepare data struct for chart
      let timeSeriesData = [];
      for (let i = 0; i < signal.length; i++){
        timeSeriesData.push({
          date: (i / this.samplingRate) * 1000,
          height: signal[i],
        });
      }
      let el = this.$refs["wave-height-chart"];
      // Remove current SVG
      if (el.children[0] != undefined){
        el.replaceChildren();
      }
      // Create chart
      this.chart = d3_timeseries()
              //.addSerie(timeSeriesData,{x:'date',y:'height'},{interpolate:'monotone',color:"#333"})
              .addSerie(timeSeriesData,{x:'date',y:'height'},{color:"#333"})
              .width(600)
              .height(250)
              .yscale.label("Wave height")
              .yscale.units("m")
              .xscale.label("Time")
      this.chart('#wave-height-chart')
      // Assign style
      //el = this.$refs["wave-height-chart"];
      //el.children[0].style.overflow = "auto";
    },

    // WINDOW RESIZE
    windowResize: function(){
    },

  },
  components: {

  }
}
</script>



<style scoped>

.content {
  padding: 20px;
  overflow: auto;
  font-size: small;
  max-width: 700px;
}

.container-vertical{
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;

  
}

.options {
  padding: 20px;
  background: var(--lightBlue);
  border-radius: 20px;
  margin-bottom: 20px;
}

.container-horizontal {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  justify-content: space-evenly;
  padding: 2px;
}

.container-horizontal > * {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  max-height: 25px;
}

.section {
  background: linear-gradient(90deg, transparent 0%, #77cfef 10%, #77cfef 90%, transparent 100%);
}

input {
  border-radius: 5px;
  text-align: center;
  font-size: small;
}

.renderButton{
  margin: 20px 20px 20px 20px;
}

.calibButton{
  width: auto;
}

.progress-container {
  width: 100%;
  background: #77cfef;
  margin-top: 10px;
  margin-bottom: 10px;
  border-radius: 25px;
  border-color: var(--darkBlue);
  border-width: thin;
  border-style: solid;
}

.progress-container > * {
  background: linear-gradient(180deg, #52b5d9, #459dbd);
  border-radius: 15px;
  margin: 1px;
  height: 24px;
}

.chart {
  padding-bottom: 20px;
}


</style>