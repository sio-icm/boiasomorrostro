<template>
  <!-- The conditions at the app's moment (see GUIManager.selectedTime; now by default), over the
       3D view: measured at the buoy if it has data then, else forecast (and since when the buoy is
       silent). Opens the observations or the forecast. Hidden while the data panel covers the 3D view -->
  <div class="now-card clickable" v-if="rows.length && $gui.panelState !== 'fullscreen'" @click="open" :title="$t(measured ? 'Observations' : 'Forecast')">
    <div class="now-title">
      <span>{{ title }}</span>
      <span class="now-source">{{ measured ? $t('Buoy') + (age ? ' · ' + age : '') : $t('Forecast') }}</span>
    </div>
    <div class="now-row" v-for="row in rows" :key="row.label">
      <span>{{ row.label }}</span>
      <b>
        <i v-if="row.direction != undefined" class="now-arrow" :style="{ transform: `rotate(${row.direction + 180}deg)` }">&#8593;</i>
        {{ row.value }}
      </b>
    </div>
    <div class="now-warning" v-if="!measured && lastDate">{{ $t('Buoy without data since') }} {{ lastDate }}</div>
    <!-- While the camera is on the buoy: whose buoy it is -->
    <transition name="now-credits">
      <div class="now-credits" v-if="$gui.buoyInFocus" @click.stop>
        <a href="https://icatmar.cat" target="_blank" title="ICATMAR"><img class="icatmar" src="img/logos/ICATMAR512_white.png" alt="ICATMAR"></a>
        <a href="https://www.icm.csic.es" target="_blank" title="ICM-CSIC"><img src="img/logos/ICM_white.png" alt="ICM-CSIC"></a>
      </div>
    </transition>
  </div>
</template>


<script>
// Measured data older than this is not "now": the card shows the forecast instead (Open-Meteo)
const RECENT_HOURS = 3;

export default {
  name: 'NowCard',
  data() {
    return { rows: [], measured: false, age: '', lastDate: '' };
  },
  computed: {
    title() {
      return this.$gui.selectedTime
        ? this.$gui.selectedTime.toLocaleString(this.$i18n.locale, { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : this.$t('Now');
    },
  },
  watch: {
    '$gui.selectedTime'() {
      this.update();
    },
  },
  mounted() {
    this.update();
    this.interval = setInterval(this.update, 10 * 60 * 1000);
  },
  unmounted() {
    clearInterval(this.interval);
  },
  methods: {
    async update() {
      const data = this.$dataService;
      await data.buoy.ready();
      const t = (key) => this.$t(key);
      const format = (value, decimals, unit) => value == undefined || isNaN(value) ? undefined : `${value.toFixed(decimals)} ${unit}`;
      const latest = data.buoy.latestDate;
      const live = !this.$gui.selectedTime;
      const date = this.$gui.moment;
      let rows;
      // Now: the latest data, if recent. Another moment: the buoy's reading closest to that hour
      const hours = latest ? (Date.now() - latest) / 3600e3 : Infinity;
      const value = live
        ? async (code) => hours < RECENT_HOURS ? data.buoy.latestRow(code)?.values[code] : undefined
        : (code) => data.buoy.getValueAt(code, date, 60);
      const [speed, direction, sea, air] = await Promise.all(['WSPD', 'WDIR', 'TEMP', 'DRYT'].map(value));
      if (date !== this.$gui.moment && !live) return; // Another moment was picked meanwhile
      this.measured = speed != undefined || sea != undefined;
      if (this.measured) {
        rows = [
          { label: t('Wind'), value: format(speed, 1, 'm/s'), direction },
          { label: t('Sea temperature'), value: format(sea, 1, 'ºC') },
          { label: t('Air temperature'), value: format(air, 1, 'ºC') },
        ];
        this.age = live ? this.timeAgo(hours) : '';
      } else {
        const [wind, windDirection, air, marine] = await Promise.all([
          data.weather.getValueAt('WSPD', date), data.weather.getValueAt('WDIR', date), data.weather.getValueAt('DRYT', date),
          this.marineAt(date),
        ]);
        const { wave_height: waves, wave_direction: wavesDirection, sea_surface_temperature: sea } = marine;
        rows = [
          { label: t('Wind'), value: format(wind, 1, 'm/s'), direction: windDirection },
          { label: t('Waves'), value: format(waves, 1, 'm'), direction: wavesDirection },
          { label: t('Sea temperature'), value: format(sea, 1, 'ºC') },
          { label: t('Air temperature'), value: format(air, 1, 'ºC') },
        ];
        this.lastDate = latest ? latest.toLocaleDateString(this.$i18n.locale, { day: 'numeric', month: 'short' }) : '';
      }
      this.rows = rows.filter(row => row.value != undefined);
    },
    // Waves and sea temperature at the buoy at a moment, from Open-Meteo Marine (as the 3D sea,
    // see Canvas3D), hourly from 3 days ago to 3 ahead
    async marineAt(date) {
      const variables = ['wave_height', 'wave_direction', 'sea_surface_temperature'];
      const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${window.LATITUDE}&longitude=${window.LONGITUDE}`
        + `&hourly=${variables.join(',')}&past_days=3&forecast_days=3&timezone=UTC`;
      try {
        const hourly = (await (await window.FetchManager.fetch(url, 30)).json()).hourly;
        const index = hourly.time.findIndex(time => Math.abs(Date.parse(time + 'Z') - date) < 1800e3);
        return index < 0 ? {} : Object.fromEntries(variables.map(variable => [variable, hourly[variable][index]]));
      } catch (error) {
        return {};
      }
    },
    timeAgo(hours) {
      const minutes = Math.floor(hours * 60);
      if (minutes < 1) return this.$t('timeAgo.now');
      if (hours < 1) return this.$t('timeAgo.minutes', { n: minutes });
      return this.$t(hours < 2 ? 'timeAgo.hour' : 'timeAgo.hours', { n: Math.floor(hours) });
    },
    open() {
      this.$gui.selectedSection = this.measured ? 'observations' : 'forecast';
      if (this.$gui.panelState === 'hidden') this.$gui.panelState = 'compact';
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    },
  },
};
</script>


<style scoped>
.now-card {
  position: absolute;
  top: clamp(55px, 9vw, 80px);
  left: clamp(10px, 7vw, 70px);
  z-index: 10;
  min-width: 170px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(var(--darkBlueRGB), 0.7);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  font-size: 0.78rem;
}
.now-card span, .now-card b, .now-card div {
  color: white;
}
.now-title {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 4px;
}
.now-title .now-source {
  font-weight: normal;
  font-size: 0.7rem;
  opacity: 0.8;
  align-self: end;
}
.now-row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  line-height: 1.5;
}
.now-arrow {
  display: inline-block;
  font-style: normal;
}
.now-warning {
  margin-top: 4px;
  font-size: 0.66rem;
  color: #ffd27a !important;
}
.now-credits {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  max-height: 50px;
  overflow: hidden;
}
.now-credits img {
  display: block;
  height: 20px;
  opacity: 0.85;
  transition: opacity 0.2s;
}
.now-credits img.icatmar {
  height: 36px; /* Nearly square, with three lines of small text */
}
.now-credits a:hover img {
  opacity: 1;
}
.now-credits-enter-active, .now-credits-leave-active {
  transition: opacity 0.4s, max-height 0.4s, margin-top 0.4s, padding-top 0.4s;
}
.now-credits-enter-from, .now-credits-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
  padding-top: 0;
}
@media screen and (max-width: 770px) {
  .now-card {
    min-width: 140px;
    padding: 6px 10px;
    font-size: 0.7rem;
  }
  .now-credits img {
    height: 16px;
  }
  .now-credits img.icatmar {
    height: 30px;
  }
}
</style>
