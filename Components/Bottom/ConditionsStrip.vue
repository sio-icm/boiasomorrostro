<template>
  <!-- The conditions at the buoy (wind, waves, temperatures), in a strip over the time control,
       while the 3D view's card shows a followed vessel (see NowCard). Opens the observations or the
       forecast, as the card -->
  <div class="conditions-strip clickable" v-if="shown" @click="open" :title="$t(conditions.measured ? 'Observations' : 'Forecast')">
    <span class="conditions-title">{{ conditions.title }} <i>{{ conditions.source }}</i></span>
    <span class="conditions-item" v-for="row in conditions.rows" :key="row.label">
      {{ row.label }}
      <b>
        <i v-if="row.direction != undefined" class="conditions-arrow" :style="{ transform: `rotate(${row.direction + 180}deg)` }">&#8593;</i>
        {{ row.value }}
      </b>
    </span>
  </div>
</template>


<script>
export default {
  name: 'ConditionsStrip',
  computed: {
    conditions() {
      return this.$gui.conditions;
    },
    shown() {
      return this.$gui.followed && this.conditions?.rows.length && this.$gui.panelState !== 'fullscreen';
    },
  },
  methods: {
    // As NowCard.open
    open() {
      this.$gui.selectedSection = this.conditions.measured ? 'observations' : 'forecast';
      if (this.$gui.panelState === 'hidden') this.$gui.panelState = 'compact';
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    },
  },
};
</script>


<style scoped>
.conditions-strip {
  position: absolute;
  bottom: calc(100% + 72px); /* Over the time control (top: -66px, see TimeControl); on two lines on a phone, growing upwards */
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: baseline;
  gap: 2px 14px;
  width: max-content;
  max-width: min(560px, calc(100vw - 32px));
  box-sizing: border-box;
  padding: 5px 12px;
  border-radius: 6px;
  background: rgba(var(--darkBlueRGB), 0.7);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  font-size: 0.72rem;
}
.conditions-strip span, .conditions-strip b, .conditions-strip i {
  color: white;
  white-space: nowrap;
}
.conditions-title {
  font-weight: 600;
}
.conditions-title i {
  font-weight: normal;
  font-size: 0.66rem;
  opacity: 0.8;
}
.conditions-arrow {
  display: inline-block;
  font-style: normal;
}
</style>
