<template>
  <!-- The history mode's own time control (see GUIManager.historyTime): any moment since our
       equipment's positions are kept, played forward at some speed, which of them were out then
       (to go to each), and the way back to now. In TimeControl's place, over the data panel -->
  <div class="time-control history-time-control" @pointerdown.stop>
    <div class="time-center">
      <div class="time-label">
        <span class="history-kind">{{ $t('history3d.kind') }}</span>
        <b>{{ label }}</b>
        <span v-if="status" class="history-status">{{ status }}</span>
      </div>
      <div class="history-range">
        <input type="range" :min="minMinute" :max="maxMinute" step="1" :value="minute" @input="onInput"
          :disabled="!platforms.length" :aria-label="$t('history3d.moment')">
        <!-- The days each of our vessels has positions -->
        <div class="history-days" aria-hidden="true">
          <span v-for="mark in marks" :key="mark.key" :style="{ left: mark.left + '%', background: mark.color }"></span>
        </div>
      </div>
      <div class="history-buttons">
        <button class="time-step clickable" @click="jumpDay(-1)" :disabled="!platforms.length" :title="$t('history3d.previousDay')">&#171;</button>
        <button class="time-step clickable" @click="step(-1)" :disabled="!platforms.length" :title="$t('history3d.back')">&#8249;</button>
        <button class="time-step play clickable" @click="toggle" :disabled="!platforms.length" :title="$t(playing ? 'history3d.pause' : 'history3d.play')">
          <i class="fa-solid" :class="playing ? 'fa-pause' : 'fa-play'"></i>
        </button>
        <button class="time-step clickable" @click="step(1)" :disabled="!platforms.length" :title="$t('history3d.forward')">&#8250;</button>
        <button class="time-step clickable" @click="jumpDay(1)" :disabled="!platforms.length" :title="$t('history3d.nextDay')">&#187;</button>
        <button class="history-speed clickable" @click="speedIndex = (speedIndex + 1) % speeds.length" :title="$t('history3d.speed')">{{ speeds[speedIndex].label }}</button>
        <button class="time-now clickable" @click="$gui.historyTime = undefined" :title="$t('history3d.exitTitle')">{{ $t('Now') }}</button>
      </div>
      <!-- Which of ours were out then: tap to go to it -->
      <div class="history-platforms">
        <button v-for="p in platforms" :key="p.id" class="clickable" :class="{ present: present[p.id] }"
          :disabled="!present[p.id]" @click="goTo(p)" :title="present[p.id] ? $t('history3d.goTo') : $t('history3d.noData')">
          <span class="history-dot" :style="{ background: present[p.id] ? colorOf(p) : 'transparent', borderColor: colorOf(p) }"></span>{{ p.name || p.id }}
        </button>
      </div>
    </div>
  </div>
</template>


<script>
// The positions come from SceneManager.history (Assets/History/HistoryManager.js), made when the
// mode starts (see SceneManager.setHistory)
const COLORS = { buoy: '#f2c200', boat: '#e8463c', vehicle: '#4f7bff' };
const STEP_MINUTES = 10; // ‹ ›

export default {
  name: 'HistoryTimeControl',
  data() {
    return {
      platforms: [], first: undefined, last: undefined, present: {}, shown: undefined, loading: false, failed: false,
      playing: false, speedIndex: 1,
      // Minutes of the past per second
      speeds: [{ label: '×60', perSecond: 60e3 }, { label: '×600', perSecond: 600e3 }, { label: '×3600', perSecond: 3600e3 }],
    };
  },
  mounted() {
    // SceneManager's HistoryManager, once the mode started there
    const start = () => {
      const history = window.sceneManager?.history;
      if (!history) return;
      clearInterval(this.waiting);
      this.history = history;
      history.summary.then(summary => {
        this.platforms = summary.platforms;
        this.first = Math.min(...summary.platforms.map(p => Date.parse(p.first)));
        this.last = Math.min(Date.now(), Math.max(...summary.platforms.map(p => Date.parse(p.last))));
        // From a moment with data
        const time = this.$gui.historyTime;
        if (!(time >= this.first && time <= this.last)) this.$gui.historyTime = this.last;
      }, () => this.failed = true);
    };
    this.waiting = setInterval(start, 200);
    start();
    // Which are out at the moment shown, and whether it is still loading
    this.poll = setInterval(() => {
      if (!this.history) return;
      this.present = { ...this.history.present };
      this.loading = this.history.loading(this.$gui.historyTime);
    }, 300);
  },
  unmounted() {
    clearInterval(this.waiting);
    clearInterval(this.poll);
    clearTimeout(this.debounce);
    cancelAnimationFrame(this.frame);
  },
  computed: {
    time() {
      return this.shown ?? this.$gui.historyTime;
    },
    minute() {
      return Math.round(this.time / 60e3);
    },
    minMinute() {
      return this.first ? Math.floor(this.first / 60e3) : 0;
    },
    maxMinute() {
      return this.last ? Math.ceil(this.last / 60e3) : 1;
    },
    label() {
      if (this.time == undefined) return '';
      return new Date(this.time).toLocaleString(this.$i18n.locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },
    status() {
      if (this.failed) return this.$t('history3d.unavailable');
      if (this.loading) return this.$t('history3d.loading');
      if (this.platforms.length && !Object.values(this.present).some(Boolean)) return this.$t('history3d.noData');
      return '';
    },
    // A mark under the slider for each day of each vessel with positions (the buoy has nearly all)
    marks() {
      if (!this.first || !this.last) return [];
      const span = this.last - this.first;
      return this.platforms.filter(p => p.kind !== 'buoy').flatMap(p => p.days.map(day => ({
        key: p.id + day, color: this.colorOf(p),
        left: Math.min(100, Math.max(0, (Date.parse(day + 'T12:00:00Z') - this.first) / span * 100)),
      })));
    },
  },
  methods: {
    colorOf(platform) {
      return COLORS[platform.kind] || COLORS.boat;
    },
    set(time) {
      this.$gui.historyTime = Math.max(this.first ?? time, Math.min(this.last ?? time, time));
    },
    step(n) {
      this.stop();
      this.set(this.$gui.historyTime + n * STEP_MINUTES * 60e3);
    },
    // To the first position of a vessel of ours the day before or after, with any (or the buoy's)
    async jumpDay(direction) {
      this.stop();
      const vessels = this.platforms.filter(p => p.kind !== 'buoy');
      const days = [...new Set((vessels.length ? vessels : this.platforms).flatMap(p => p.days))].sort();
      const today = new Date(this.$gui.historyTime).toISOString().slice(0, 10);
      const day = direction > 0 ? days.find(d => d > today) : days.reverse().find(d => d < today);
      if (!day) return;
      const first = await this.history.firstIn(day, vessels.map(p => p.id));
      this.set(first ?? Date.parse(day + 'T00:00:00Z'));
    },
    goTo(platform) {
      if (platform.kind === 'buoy') window.sceneManager?.focusOnBuoy();
      else window.sceneManager?.follow(platform.id);
    },
    toggle() {
      if (this.playing) return this.stop();
      if (this.$gui.historyTime >= this.last) this.set(this.first);
      this.playing = true;
      let previous = performance.now();
      const frame = (now) => {
        const dt = Math.min(0.1, (now - previous) / 1000);
        previous = now;
        const time = this.$gui.historyTime + dt * this.speeds[this.speedIndex].perSecond;
        this.set(time);
        if (time >= this.last) return this.stop();
        this.frame = requestAnimationFrame(frame);
      };
      this.frame = requestAnimationFrame(frame);
    },
    stop() {
      this.playing = false;
      cancelAnimationFrame(this.frame);
    },
    // While dragging, the label follows at once and the 3D a moment later
    onInput(e) {
      this.stop();
      this.shown = parseInt(e.target.value) * 60e3;
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.set(this.shown);
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
  width: min(480px, calc(100vw - 32px));
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
  min-width: 0;
}
.time-label b, .time-label span {
  color: white;
}
.time-label b {
  white-space: nowrap;
}
.history-kind {
  font-size: 0.68rem;
  padding: 0 6px;
  border-radius: 3px;
  background: #6b4fbb;
  white-space: nowrap;
}
.history-status {
  margin-left: auto;
  font-size: 0.68rem;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.history-range {
  position: relative;
}
.history-range input {
  width: 100%;
  accent-color: white;
  margin: 2px 0 0;
}
.history-days {
  position: relative;
  height: 4px;
  margin: 0 8px 2px;
}
.history-days span {
  position: absolute;
  top: 0;
  width: 2px;
  height: 4px;
  margin-left: -1px;
  border-radius: 1px;
}
.history-buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.history-platforms {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.history-platforms button {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 11px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.68rem;
  white-space: nowrap;
}
.history-platforms button.present {
  color: white;
  border-color: rgba(255, 255, 255, 0.6);
}
.history-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid;
  box-sizing: border-box;
}
.time-step {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  font-size: 1.1rem;
  line-height: 1;
  flex: none;
}
.time-step.play {
  font-size: 0.75rem;
}
.time-step:disabled, .history-platforms button:disabled {
  opacity: 0.45;
  cursor: default;
}
.history-speed {
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 3px;
  padding: 3px 8px;
  background: transparent;
  color: white;
  font-size: 0.72rem;
  flex: none;
}
.time-now {
  margin-left: auto;
  border: none;
  border-radius: 3px;
  padding: 4px 10px;
  background: var(--red);
  color: white;
  font-size: 0.75rem;
  flex: none;
}
</style>
