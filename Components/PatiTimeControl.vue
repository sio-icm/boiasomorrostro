<template>
  <!-- The Patí Científic mode's own time control (see GUIManager.patiDate): the dates of its
       campaigns of 2021-22 instead of the hours of now, the temperature colours of the 3D water
       columns, and the way back to now. In TimeControl's place, over the data panel -->
  <div class="time-control pati-time-control" @pointerdown.stop>
    <button class="time-step clickable" @click="step(-1)" :disabled="index <= 0" :title="$t('pati3d.previous')">&#8249;</button>
    <div class="time-center">
      <div class="time-label">
        <span class="pati-kind">Patí Científic</span>
        <b>{{ label }}</b>
      </div>
      <input type="range" min="0" :max="dates.length - 1" step="1" :value="index" @input="onInput" :aria-label="$t('pati3d.date')">
      <div class="pati-legend">
        <span>{{ coldest }} ºC</span>
        <span class="pati-scale" :style="{ background: gradient }"></span>
        <span>{{ warmest }} ºC</span>
      </div>
      <!-- The station the camera is beside, and its year in the history section -->
      <div class="pati-stations">
        <span>{{ $t('history.station') }}</span>
        <span class="pati-station-buttons">
          <button v-for="id in stations" :key="id" class="clickable" :class="{ selected: id === $gui.patiStation }"
            @click="$gui.patiStation = id">{{ id }}</button>
        </span>
        <button class="pati-year clickable" @click="openYear">{{ $t('Over the year') }}</button>
      </div>
    </div>
    <button class="time-step clickable" @click="step(1)" :disabled="index >= dates.length - 1" :title="$t('pati3d.next')">&#8250;</button>
    <button class="time-now clickable" @click="$gui.patiDate = undefined" :title="$t('pati3d.exitTitle')">{{ $t('Now') }}</button>
  </div>
</template>


<script>
// As the water columns' colours (see Assets/PatiCientific/WaterColumnsEntity.js)
const COLORS = ['#2c3e9e', '#2f7fb5', '#1fa3a3', '#7cc47f', '#e8d24a', '#ef7d3c', '#d6454f'];

export default {
  name: 'PatiTimeControl',
  data() {
    return { dates: [], stations: [1, 2, 3, 4, 5, 6], shown: undefined, coldest: 11, warmest: 27, gradient: `linear-gradient(to right, ${COLORS.join(', ')})` };
  },
  async mounted() {
    this.dates = (await this.$gui.loadPati()).dates;
  },
  unmounted() {
    clearTimeout(this.debounce);
  },
  computed: {
    // The date the label shows: at once while dragging (shown), else the app's
    date() {
      return this.shown || this.$gui.patiDate;
    },
    index() {
      return this.dates.indexOf(this.$gui.patiDate);
    },
    label() {
      if (!this.date) return '';
      return new Date(this.date + 'T12:00:00Z').toLocaleDateString(this.$i18n.locale, { day: 'numeric', month: 'long', year: 'numeric' });
    },
  },
  methods: {
    // The station's water column over the year (see WaterColumnChart)
    openYear() {
      this.$gui.waterColumnStation = this.$gui.patiStation;
      this.$gui.selectedSection = 'history';
      if (this.$gui.panelState === 'hidden') this.$gui.panelState = 'compact';
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    },
    step(n) {
      const index = Math.max(0, Math.min(this.dates.length - 1, this.index + n));
      this.$gui.patiDate = this.dates[index];
    },
    // While dragging, the label follows at once and the 3D a moment later
    onInput(e) {
      this.shown = this.dates[parseInt(e.target.value)];
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.$gui.patiDate = this.shown;
        this.shown = undefined;
      }, 120);
    },
  },
};
</script>


<style scoped>
/* As TimeControl, which it stands in for */
.time-control {
  position: absolute;
  bottom: calc(100% + 14px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(var(--darkBlueRGB), 0.75);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  z-index: 6;
  width: min(460px, calc(100vw - 32px));
  box-sizing: border-box;
}
.time-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.time-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.8rem;
}
.time-label b, .time-label span, .pati-legend span {
  color: white;
}
.time-label b {
  white-space: nowrap;
}
.pati-kind {
  font-size: 0.68rem;
  padding: 0 6px;
  border-radius: 3px;
  background: #12a39a;
  white-space: nowrap;
}
.time-center input {
  width: 100%;
  accent-color: #12a39a;
  margin: 2px 0 0;
}
.pati-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.65rem;
  white-space: nowrap;
}
.pati-scale {
  flex: 1;
  height: 7px;
  border-radius: 4px;
}
.pati-stations {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 0.65rem;
}
.pati-stations > span:first-child {
  color: white;
  margin-right: 2px;
}
.pati-station-buttons {
  display: flex;
  gap: 4px;
}
.pati-stations button {
  min-width: 22px;
  height: 20px;
  padding: 0 5px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 4px;
  background: transparent;
  color: white;
  font-size: 0.7rem;
  line-height: 1;
}
.pati-stations button.selected {
  background: #12a39a;
  border-color: #12a39a;
}
.pati-stations .pati-year {
  margin-left: auto;
  white-space: nowrap;
}
.time-step {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  font-size: 1.2rem;
  line-height: 1;
  flex: none;
}
.time-step:disabled {
  opacity: 0.35;
}
.time-now {
  border: none;
  border-radius: 3px;
  padding: 4px 10px;
  background: var(--red);
  color: white;
  font-size: 0.75rem;
  flex: none;
}
</style>
