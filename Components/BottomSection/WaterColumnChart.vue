<template>
  <!-- The water column at one of the Patí Científic's stations over 2021-22: depth against time,
       coloured by temperature. Each vertical band is one profile (see the map's stations) -->
  <div class="water-column">
    <div class="water-column-toolbar">
      <span class="water-column-label">{{ $t('history.station') }}</span>
      <div class="button-group horizontal">
        <button v-for="s in stations" :key="s.id" class="clickable" :class="{ selectedOption: s.id === station }"
          @click="$emit('update:station', s.id)">
          <span>{{ s.id }}</span>
        </button>
      </div>
      <span v-if="current" class="water-column-info">
        {{ current.profiles.length }} {{ $t('profiles') }} ·
        <a :href="current.profiles[current.profiles.length - 1].doi" target="_blank" rel="noopener">{{ $t('Data on Zenodo') }} &#8599;</a>
      </span>
    </div>
    <div class="water-column-chart" ref="chart"></div>
    <div class="water-column-note">{{ $t('history.waterColumnNote') }}</div>
  </div>
</template>


<script>
// Data: data/StaticData/pati_cientific.json (see tools/export_pati_cientific.py)
const DATA_URL = 'data/StaticData/pati_cientific.json';
const HALF_BAND = 4 * 86400e3; // ms: each profile's band reaches at most this far on each side
const MAX_GAP = 1.5; // m: missing depths in a profile up to this are filled from the nearest ones
// Cold to warm, as the sea temperature forecast on the map
const COLORS = ['#2c3e9e', '#2f7fb5', '#1fa3a3', '#7cc47f', '#e8d24a', '#ef7d3c', '#d6454f'];

let dataPromise;
function loadData() {
  if (dataPromise == undefined) dataPromise = fetch(DATA_URL).then(res => res.json());
  return dataPromise;
}

export default {
  name: 'WaterColumnChart',
  props: {
    echarts: { type: Object, required: true },
    station: { type: Number, default: 1 },
  },
  emits: ['update:station'],
  data() {
    return { stations: [] };
  },
  computed: {
    current() {
      return this.stations.find(s => s.id === this.station);
    },
  },
  watch: {
    station() { this.draw(); },
  },
  async mounted() {
    window.addEventListener('resize', this.resize);
    this.chart = this.echarts.init(this.$refs.chart);
    const data = await loadData().catch(() => undefined);
    if (this.unmounted || !data) return;
    this.stations = data.stations.filter(s => s.id != null);
    this.draw();
  },
  unmounted() {
    this.unmounted = true;
    window.removeEventListener('resize', this.resize);
    this.chart?.dispose();
  },
  methods: {
    resize() {
      this.chart?.resize();
    },
    time(profile) {
      return Date.parse(`${profile.date}T${profile.time || '12:00'}:00`);
    },
    // One rectangle per profile and depth bin: [from, to, top, bottom, temperature, time, depth]
    cells(station, bin) {
      const times = station.profiles.map(this.time);
      return station.profiles.flatMap((profile, n) => {
        const from = n > 0 ? Math.max(times[n] - HALF_BAND, (times[n - 1] + times[n]) / 2) : times[n] - HALF_BAND;
        const to = n < times.length - 1 ? Math.min(times[n] + HALF_BAND, (times[n] + times[n + 1]) / 2) : times[n] + HALF_BAND;
        // Each cell reaches halfway to its neighbours, over a few missing bins (up to MAX_GAP)
        const depths = profile.depth;
        return depths.map((depth, k) => {
          const top = k > 0 && depth - depths[k - 1] <= MAX_GAP ? (depths[k - 1] + depth) / 2 : Math.max(0, depth - bin / 2);
          const bottom = k < depths.length - 1 && depths[k + 1] - depth <= MAX_GAP ? (depth + depths[k + 1]) / 2 : depth + bin / 2;
          return [from, to, top, bottom, profile.temperature[k], times[n], depth];
        });
      });
    },
    tooltip(params) {
      const [, , , , temperature, time, depth] = params.value;
      const date = new Date(time).toLocaleDateString(this.$i18n.locale, { day: 'numeric', month: 'short', year: 'numeric' });
      return `<div class="history-tooltip-date">${date}</div>
        <div class="history-tooltip-row">${this.$t('history.depth')}<b>${depth.toFixed(1)} m</b></div>
        <div class="history-tooltip-row">${this.$t('history.temperature')}<b>${temperature.toFixed(1)} ºC</b></div>`;
    },
    draw() {
      const station = this.current;
      if (!station || !this.chart) return;
      const cells = this.cells(station, 0.5);
      const temperatures = cells.map(cell => cell[4]);
      // The canvas doesn't take CSS variables
      const darkBlue = getComputedStyle(document.documentElement).getPropertyValue('--darkBlue').trim() || '#0d2a4c';
      const coldest = Math.floor(Math.min(...temperatures)), warmest = Math.ceil(Math.max(...temperatures));
      const deepest = Math.max(...cells.map(cell => cell[3]));
      this.chart.setOption({
        animation: false,
        textStyle: { fontFamily: '"TT Commons", sans-serif' },
        grid: { left: 52, right: 20, top: 40, bottom: 28 },
        xAxis: { type: 'time', axisLabel: { fontSize: 10 }, splitLine: { show: false },
          min: cells[0][0], max: cells[cells.length - 1][1] },
        yAxis: { type: 'value', inverse: true, min: 0, max: Math.ceil(deepest / 5) * 5, name: `${this.$t('history.depth')} (m)`,
          nameLocation: 'start', nameGap: 10, nameTextStyle: { align: 'left', fontSize: 11, fontWeight: 600, color: 'var(--darkBlue)' },
          axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(var(--darkBlueRGB), 0.08)' } } },
        visualMap: { type: 'continuous', dimension: 4, min: coldest, max: warmest,
          inRange: { color: COLORS }, orient: 'horizontal', right: 20, top: 0, itemWidth: 10, itemHeight: 140,
          text: [`${warmest} ºC`, `${coldest} ºC`], textGap: 6, calculable: false, textStyle: { fontSize: 10, color: darkBlue } },
        tooltip: { trigger: 'item', confine: true, formatter: this.tooltip,
          textStyle: { fontSize: 11, color: 'var(--darkBlue)' }, extraCssText: 'border-radius: 10px; box-shadow: 0 4px 16px rgba(var(--darkBlueRGB), 0.25);' },
        dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }],
        series: [{
          type: 'custom', data: cells, encode: { x: [0, 1], y: [2, 3] },
          renderItem: (params, api) => {
            const start = api.coord([api.value(0), api.value(2)]);
            const end = api.coord([api.value(1), api.value(3)]);
            return { type: 'rect', shape: { x: start[0], y: start[1], width: Math.max(1, end[0] - start[0]), height: Math.max(1, end[1] - start[1]) },
              // Stroked in its own colour too, so neighbouring cells leave no hairline between them
              style: { fill: api.visual('color'), stroke: api.visual('color'), lineWidth: 0.8 } };
          },
        }],
      }, true);
      this.$nextTick(this.resize);
    },
  },
};
</script>


<style scoped>
.water-column {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.water-column-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-top: 6px;
  font-size: 0.72rem;
}
.water-column-toolbar span {
  color: var(--darkBlue);
}
.water-column-label {
  font-weight: 600;
}
.water-column-toolbar button {
  min-width: 30px;
  padding: 3px 8px 1px;
  background: white;
  color: var(--darkBlue);
  border: 1px solid rgba(var(--darkBlueRGB), 0.25);
  font-weight: 500;
}
.water-column-toolbar button.selectedOption {
  background: #12a39a;
  border-color: #12a39a;
  box-shadow: none;
}
.water-column-toolbar button.selectedOption span {
  color: white;
}
.water-column-info a {
  color: var(--blue);
  font-weight: 600;
}
.water-column-chart {
  flex: 1;
  min-height: 220px;
  width: 100%;
}
.water-column-note {
  font-size: 0.68rem;
  opacity: 0.7;
  color: var(--darkBlue);
  padding: 2px 0 8px;
}
</style>
