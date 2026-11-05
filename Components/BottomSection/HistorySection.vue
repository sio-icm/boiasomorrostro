<template>
  <div id="history-section" :class="{ fullscreen: $gui.panelState === 'fullscreen' }">
    <!-- Range and downloads -->
    <div class="history-toolbar">
      <div class="button-group horizontal">
        <button v-for="range in ranges" :key="range.id" class="clickable"
          :class="{ selectedOption: range.id === rangeId }" @click="setRange(range.id)">
          <span>{{ $t('history.' + range.id) }}</span>
        </button>
      </div>
      <div class="history-info">
        <span v-if="loading">{{ $t('Loading') }}...</span>
        <span v-else-if="rangeLabel">{{ rangeLabel }}</span>
        <span class="history-downloads">{{ $t('history.download') }}:
          <a v-for="sensor in sensors" :key="sensor" :href="downloadURL(sensor)" target="_blank">{{ sensor }}</a>
        </span>
      </div>
    </div>
    <div v-if="emptyCharts.length" class="history-empty">{{ $t('history.noData') }}: {{ emptyCharts.join(', ') }}</div>
    <!-- One chart per variable, stacked, sharing the time axis -->
    <div class="history-charts" ref="charts" :style="{ height: chartsHeight + 'px' }"></div>
  </div>
</template>


<script>
// Every observation of the buoy since it was deployed, straight from ICATMAR's ERDDAP.
// Long ranges are averaged by the server (orderByMean), so even the whole series is a few
// hundred points per variable. Charts with Apache ECharts, loaded only when this section opens.

const ERDDAP = 'https://erddap.icatmar.cat/erddap/tabledap/';
const CACHE_MINUTES = 30;

// Ranges back from the latest data (the buoy may have stopped), and how each is averaged
// gap: longer than this between two points means missing data, and the line is broken there
const RANGES = [
  { id: 'days7', since: 'max(time)-7days', gap: 3600e3 },
  { id: 'days30', since: 'max(time)-30days', every: 'time/1hour', gap: 3 * 3600e3 },
  { id: 'all', every: 'time/6hours', gap: 18 * 3600e3 },
];

// Charts, top to bottom. Each series is a column of a buoy sensor's dataset (BUOY_SOMO_<sensor>)
const CHARTS = [
  { id: 'wind', unit: 'm/s', series: [
    { sensor: 'METEO', column: 'WSPD', label: 'wind', color: 'var(--lightBlue)' },
    { sensor: 'METEO', column: 'WDIR', label: 'direction', color: 'var(--darkBlue)', direction: true },
  ] },
  { id: 'temperature', unit: 'ºC', series: [
    { sensor: 'METEO', column: 'DRYT', label: 'air', color: '#ef7d3c' },
    { sensor: 'CTD', column: 'TEMP', label: 'sea', color: '#1fa3a3' },
  ] },
  { id: 'pressure', unit: 'hPa', series: [{ sensor: 'METEO', column: 'ATMS', label: 'pressure', color: '#7d8a99' }] },
  { id: 'humidity', unit: '%', series: [{ sensor: 'METEO', column: 'RELH', label: 'humidity', color: '#5aa6d2' }] },
  { id: 'salinity', unit: 'PSU', series: [{ sensor: 'CTD', column: 'PSAL', label: 'salinity', color: '#3f9a5a' }] },
  { id: 'oxygen', unit: 'ml/l', series: [{ sensor: 'CTD', column: 'DOX1', label: 'oxygen', color: '#a05cc4' }] },
  { id: 'ph', unit: '', series: [{ sensor: 'SAMI', column: 'PHPH', label: 'ph', color: '#d6454f' }] },
];
const CHART_HEIGHT = 120; // px of each chart
const SLIDER_HEIGHT = 50; // px of the zoom slider under them

let echartsPromise;
function loadECharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (echartsPromise == undefined) {
    echartsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/boiasomorrostro/lib/echarts/echarts.min.js';
      script.onload = () => resolve(window.echarts);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return echartsPromise;
}

export default {
  name: 'HistorySection',
  data() {
    return {
      ranges: RANGES,
      rangeId: 'days7',
      loading: false,
      rangeLabel: '',
      emptyCharts: [],
      visibleCount: CHARTS.length,
    };
  },
  computed: {
    sensors() {
      return [...new Set(CHARTS.flatMap(chart => chart.series.map(series => series.sensor)))];
    },
    chartsHeight() {
      return this.visibleCount * CHART_HEIGHT + SLIDER_HEIGHT;
    },
  },
  mounted() {
    window.addEventListener('resize', this.resize);
    loadECharts().then(echarts => {
      if (this.unmounted) return;
      this.chart = echarts.init(this.$refs.charts);
      this.load();
    });
  },
  unmounted() {
    this.unmounted = true;
    window.removeEventListener('resize', this.resize);
    this.chart?.dispose();
  },
  methods: {
    setRange(id) {
      this.rangeId = id;
      this.load();
    },
    resize() {
      this.chart?.resize();
    },
    // ERDDAP query for some columns of a sensor in the current range
    queryURL(sensor, columns, format, aggregate = 'orderByMean') {
      const range = RANGES.find(r => r.id === this.rangeId);
      let url = `${ERDDAP}BUOY_SOMO_${sensor}.${format}?time,${columns.join(',')}`;
      if (range.since) url += `&time>=${range.since}`;
      if (range.every) url += `&${aggregate}("${range.every}")`;
      return url;
    },
    downloadURL(sensor) {
      const columns = CHARTS.flatMap(chart => chart.series).filter(s => s.sensor === sensor).map(s => s.column);
      return this.queryURL(sensor, columns, 'csv');
    },
    // { column: [[time, value], ...] } of a sensor. Directions aren't averaged (the mean of
    // 350º and 10º isn't 180º): they take the reading closest to each interval instead
    async fetchSensor(sensor, columns, aggregate) {
      const url = window.BoiaConfig.proxied(this.queryURL(sensor, columns, 'csv', aggregate));
      const text = await window.FetchManager.fetch(url, CACHE_MINUTES).then(res => res.ok ? res.text() : '').catch(() => '');
      const result = Object.fromEntries(columns.map(column => [column, []]));
      text.trim().split('\n').slice(2).forEach(line => {
        const cells = line.split(',');
        const time = Date.parse(cells[0]);
        columns.forEach((column, index) => {
          const value = parseFloat(cells[index + 1]);
          if (!isNaN(value)) result[column].push([time, value]);
        });
      });
      return result;
    },
    async load() {
      const rangeId = this.rangeId;
      this.loading = true;
      const requests = this.sensors.map(sensor => {
        const series = CHARTS.flatMap(chart => chart.series).filter(s => s.sensor === sensor);
        const values = series.filter(s => !s.direction).map(s => s.column);
        const directions = series.filter(s => s.direction).map(s => s.column);
        return Promise.all([
          this.fetchSensor(sensor, values, 'orderByMean'),
          directions.length ? this.fetchSensor(sensor, directions, 'orderByClosest') : {},
        ]).then(([a, b]) => [sensor, { ...a, ...b }]);
      });
      const data = Object.fromEntries(await Promise.all(requests));
      if (rangeId !== this.rangeId || this.unmounted) return; // Another range was picked meanwhile
      this.loading = false;
      this.draw(data);
    },
    // Inserts a null where two points are further apart than the range's gap, to break the line
    withGaps(points, gap) {
      const result = [];
      points.forEach((point, index) => {
        if (index > 0 && point[0] - points[index - 1][0] > gap) result.push([points[index - 1][0] + 1, null]);
        result.push(point);
      });
      return result;
    },
    // One date, then each variable with its unit
    tooltip(params) {
      const date = new Date(params[0].axisValue).toLocaleString(this.$i18n.locale,
        { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const seen = new Set();
      const rows = params.filter(p => p.value[1] != null && !seen.has(p.seriesId) && seen.add(p.seriesId)).map(p => {
        const { unit, decimals } = this.seriesFormat[p.seriesId];
        return `<div class="history-tooltip-row">${p.marker}${p.seriesName}<b>${p.value[1].toFixed(decimals)}${unit}</b></div>`;
      });
      return `<div class="history-tooltip-date">${date}</div>${rows.join('')}`;
    },
    draw(data) {
      const t = (key) => this.$t('history.' + key);
      const range = RANGES.find(r => r.id === this.rangeId);
      this.seriesFormat = {};
      const charts = CHARTS.filter(chart => chart.series.some(s => data[s.sensor][s.column].length));
      this.emptyCharts = CHARTS.filter(chart => !charts.includes(chart)).map(chart => t(chart.id));
      this.visibleCount = charts.length;
      const times = charts.flatMap(chart => chart.series.flatMap(s => data[s.sensor][s.column].map(([time]) => time)));
      if (times.length) {
        const format = (time) => new Date(time).toLocaleDateString(this.$i18n.locale, { day: 'numeric', month: 'short', year: 'numeric' });
        this.rangeLabel = `${format(Math.min(...times))} – ${format(Math.max(...times))}` + (range.every ? ` · ${t('means')}` : '');
      }

      const grids = [], xAxes = [], yAxes = [], series = [];
      charts.forEach((chart, index) => {
        const top = index * CHART_HEIGHT + 24;
        grids.push({ left: 52, right: 44, top, height: CHART_HEIGHT - 34 });
        xAxes.push({ type: 'time', gridIndex: index, axisLabel: { show: index === charts.length - 1, fontSize: 10 },
          axisTick: { show: false }, splitLine: { show: false } });
        yAxes.push({ type: 'value', gridIndex: index, scale: true, splitNumber: 3, name: `${t(chart.id)}${chart.unit ? ` (${chart.unit})` : ''}`,
          nameLocation: 'end', nameGap: 6, nameTextStyle: { align: 'left', fontSize: 11, fontWeight: 600, color: 'var(--darkBlue)' },
          axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(var(--darkBlueRGB), 0.08)' } } });
        chart.series.forEach(s => {
          const id = `${s.sensor}_${s.column}`;
          this.seriesFormat[id] = s.direction ? { unit: 'º', decimals: 0 }
            : { unit: chart.unit ? ` ${chart.unit}` : '', decimals: ['hPa', '%'].includes(chart.unit) ? 0 : chart.unit ? 1 : 2 };
          if (s.direction) {
            // Direction on its own axis on the right, as dots
            yAxes.push({ type: 'value', gridIndex: index, min: 0, max: 360, interval: 90, position: 'right',
              axisLabel: { fontSize: 9, formatter: (v) => ['N', 'E', 'S', 'W', 'N'][v / 90] }, splitLine: { show: false } });
            series.push({ id, name: t(s.label), type: 'scatter', symbolSize: 3, xAxisIndex: index, yAxisIndex: yAxes.length - 1,
              data: data[s.sensor][s.column], itemStyle: { color: s.color, opacity: 0.5 } });
          } else {
            series.push({ id, name: t(s.label), type: 'line', showSymbol: false, xAxisIndex: index,
              yAxisIndex: yAxes.findIndex(axis => axis.gridIndex === index),
              data: this.withGaps(data[s.sensor][s.column], range.gap), lineStyle: { width: 1.5, color: s.color }, itemStyle: { color: s.color } });
          }
        });
      });
      const allAxes = charts.map((_, index) => index);
      this.chart.setOption({
        animation: false,
        textStyle: { fontFamily: '"TT Commons", sans-serif' },
        grid: grids, xAxis: xAxes, yAxis: yAxes, series,
        tooltip: { trigger: 'axis', axisPointer: { type: 'line' }, confine: true, formatter: this.tooltip,
          textStyle: { fontSize: 11, color: 'var(--darkBlue)' }, extraCssText: 'border-radius: 10px; box-shadow: 0 4px 16px rgba(var(--darkBlueRGB), 0.25);' },
        axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: 'var(--darkBlue)' } },
        dataZoom: [
          { type: 'inside', xAxisIndex: allAxes },
          { type: 'slider', xAxisIndex: allAxes, bottom: 8, height: 22, borderColor: 'transparent',
            fillerColor: 'rgba(47,127,181,0.2)', handleStyle: { color: 'var(--lightBlue)' }, labelFormatter: '' },
        ],
      }, true);
      this.$nextTick(() => this.chart.resize());
    },
  },
};
</script>


<style scoped>
#history-section {
  display: flex;
  flex-direction: column;
  height: clamp(260px, 45vh, 420px);
  overflow-y: auto;
  padding: 6px 12px 0;
  color: var(--darkBlue);
}
#history-section.fullscreen {
  height: 100%;
}
.history-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding-left: 70px; /* clear of the panel's close/fullscreen buttons */
}
.history-toolbar button {
  padding: 3px 12px 1px;
  background: white;
  color: var(--darkBlue);
  border: 1px solid rgba(var(--darkBlueRGB), 0.25);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 500;
}
.history-toolbar button.selectedOption {
  background: var(--darkBlue);
  color: white;
  box-shadow: none;
}
.history-info {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 0.72rem;
}
.history-info span {
  color: var(--darkBlue);
}
.history-downloads a {
  margin-left: 6px;
}
.history-empty {
  font-size: 0.7rem;
  opacity: 0.7;
  margin-top: 4px;
}
.history-charts {
  flex-shrink: 0;
  width: 100%;
}
</style>

<!-- Not scoped: the tooltip is created by ECharts -->
<style>
.history-tooltip-date {
  font-weight: 600;
  margin-bottom: 4px;
}
.history-tooltip-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.history-tooltip-row b {
  margin-left: auto;
  padding-left: 14px;
}
</style>
