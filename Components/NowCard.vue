<template>
  <!-- The conditions now, over the 3D view: measured at the buoy if its data is recent, else
       forecast (and since when the buoy is silent). Opens the observations or the forecast.
       Hidden while the data panel covers the 3D view -->
  <div class="now-card clickable" v-if="rows.length && $gui.panelState !== 'fullscreen'" @click="open" :title="$t(measured ? 'Observations' : 'Forecast')">
    <div class="now-title">
      <span>{{ $t('Now') }}</span>
      <span class="now-source">{{ measured ? $t('Buoy') + ' · ' + age : $t('Forecast') }}</span>
    </div>
    <div class="now-row" v-for="row in rows" :key="row.label">
      <span>{{ row.label }}</span>
      <b>
        <i v-if="row.direction != undefined" class="now-arrow" :style="{ transform: `rotate(${row.direction + 180}deg)` }">&#8593;</i>
        {{ row.value }}
      </b>
    </div>
    <div class="now-warning" v-if="!measured && lastDate">{{ $t('Buoy without data since') }} {{ lastDate }}</div>
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
      const hours = latest ? (Date.now() - latest) / 3600e3 : Infinity;
      this.measured = hours < RECENT_HOURS;
      let rows;
      if (this.measured) {
        const value = (code) => data.buoy.latestRow(code)?.values[code];
        rows = [
          { label: t('Wind'), value: format(value('WSPD'), 1, 'm/s'), direction: value('WDIR') },
          { label: t('Sea temperature'), value: format(value('TEMP'), 1, 'ºC') },
          { label: t('Air temperature'), value: format(value('DRYT'), 1, 'ºC') },
        ];
        this.age = this.timeAgo(hours);
      } else {
        const now = new Date();
        const [wind, windDirection, air, marine] = await Promise.all([
          data.weather.getValueAt('WSPD', now), data.weather.getValueAt('WDIR', now), data.weather.getValueAt('DRYT', now),
          this.marineNow(),
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
    // Waves and sea temperature now at the buoy, from Open-Meteo Marine (as the 3D sea, see Canvas3D)
    async marineNow() {
      const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${window.LATITUDE}&longitude=${window.LONGITUDE}`
        + '&current=wave_height,wave_direction,sea_surface_temperature';
      try {
        return (await (await window.FetchManager.fetch(url, 30)).json()).current || {};
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
  border-radius: 12px;
  background: rgba(15, 48, 98, 0.55);
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
@media screen and (max-width: 770px) {
  .now-card {
    min-width: 140px;
    padding: 6px 10px;
    font-size: 0.7rem;
  }
}
</style>
