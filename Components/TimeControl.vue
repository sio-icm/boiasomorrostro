<template>
  <!-- The moment the whole app shows (see GUIManager.selectedTime): from the observations of the
       last days to the forecast of the next ones, by the hour. Floats over the 3D view, just above
       the data panel -->
  <div class="time-control" @pointerdown.stop>
    <button class="time-step clickable" @click="step(-1)" :title="$t('Previous hour')">&#8249;</button>
    <div class="time-center">
      <div class="time-label">
        <b>{{ label }}</b>
        <span class="time-kind" :class="kind">{{ $t(kindLabels[kind]) }}</span>
      </div>
      <input type="range" :min="-$gui.timePastHours" :max="$gui.timeFutureHours" step="1" :value="offset"
        @input="onInput" :aria-label="$t('Moment')">
    </div>
    <button class="time-step clickable" @click="step(1)" :title="$t('Next hour')">&#8250;</button>
    <button v-if="offset !== 0" class="time-now clickable" @click="$gui.selectedTime = undefined">{{ $t('Now') }}</button>
  </div>
</template>


<script>
export default {
  name: 'TimeControl',
  data() {
    return {
      kindLabels: { past: 'Measured', now: 'Now', future: 'Forecast' },
      hourTick: 0, // Changes every minute, so the present hour moves on
    };
  },
  mounted() {
    this.timer = setInterval(() => this.hourTick++, 60000);
  },
  unmounted() {
    clearInterval(this.timer);
    clearTimeout(this.debounce);
  },
  computed: {
    // Hours from the present hour to the moment
    offset() {
      this.hourTick;
      return Math.round((this.$gui.moment - this.$gui.currentHour) / 3600e3);
    },
    kind() {
      return this.offset < 0 ? 'past' : this.offset > 0 ? 'future' : 'now';
    },
    label() {
      this.hourTick;
      return this.$gui.moment.toLocaleString(this.$i18n.locale, { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    },
  },
  methods: {
    setOffset(hours) {
      this.$gui.selectedTime = new Date(this.$gui.currentHour.getTime() + hours * 3600e3);
    },
    step(hours) {
      this.setOffset(this.offset + hours);
    },
    // While dragging the bar, the label follows at once and the app a moment later (each change
    // redraws the 3D sea and the map)
    onInput(e) {
      const hours = parseInt(e.target.value);
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.setOffset(hours), 120);
    },
  },
};
</script>


<style scoped>
.time-control {
  position: absolute;
  top: -66px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(var(--darkBlueRGB), 0.7);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  z-index: 6;
  width: min(420px, calc(100vw - 32px));
}
.time-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.time-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 0.8rem;
}
.time-label b, .time-label span {
  color: white;
}
.time-kind {
  font-size: 0.68rem;
  padding: 0 6px;
  border-radius: 3px;
}
.time-kind.past { background: rgba(255, 255, 255, 0.2); }
.time-kind.now { background: var(--red); }
.time-kind.future { background: rgba(var(--lightBlueRGB), 0.85); }
.time-center input {
  width: 100%;
  accent-color: white;
  margin: 2px 0 0;
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
}
.time-now {
  border: none;
  border-radius: 3px;
  padding: 4px 10px;
  background: var(--red);
  color: white;
  font-size: 0.75rem;
}
</style>
