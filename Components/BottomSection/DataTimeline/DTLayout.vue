<template>
  <!-- Data and timeline section -->
  <div class="horizontal data-timeline-container">
    <!-- Variables -->
    <div class="vertical variable-names-container">
      <!-- Interval zoom buttons -->
      <div class="horizontal interval-picker">
        <button class="zoom-btn clickable" :disabled="!canZoomOut" @click="zoomOut" :title="$t('Time step')">
          <i class="fa-solid fa-magnifying-glass-minus"></i>
        </button>
        <span class="scale-label">{{ $gui.timelineScaleId }}</span>
        <button class="zoom-btn clickable" :disabled="!canZoomIn" @click="zoomIn" :title="$t('Time step')">
          <i class="fa-solid fa-magnifying-glass-plus"></i>
        </button>
      </div>
      <!-- Timezone toggle -->
      <div class="horizontal interval-picker">
        <span class="clickable" style="text-decoration: underline;" @click="$gui.timelineUseLocalTime = !$gui.timelineUseLocalTime">{{ $gui.timelineTimezoneLabel }}</span>
      </div>
      <!-- Variable names and units, grouped per data product -->
      <div class="vertical variable-names-list">
        <template v-for="group in groups" :key="group.name">
          <!-- Spacer matching the product row on the right (see the sections) -->
          <div class="group-spacer"></div>
          <div class="horizontal name-row" v-for="v in group.variables" :key="v.code">
            <span class="var-name">{{ $t(v.name) }}{{ v.suffix ? ' ' + v.suffix : '' }}</span>
            <span class="var-unit" :class="{ clickable: v.unitGroup }" @click="v.unitGroup && $gui.cycleUnit(v.unitGroup)">{{ unitLabel(v) }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- Data timeline -->
    <div class="horizontal table-and-info-container" ref="tableSlidingContainer"
      @mousedown="startDragging"
      @touchstart="startDragging">

      <!-- Timeline container -->
      <div class="horizontal table-container" ref="tableContainer">
        <div class="vertical timeline-inner" ref="timelineInner">
          <slot name="grid" :cells="cells"></slot>
          <!-- The app's moment (see GUIManager.selectedTime), when another than now: its column -->
          <div v-if="selectedCellIndex >= 0" class="selected-cell" :style="{ left: selectedCellIndex * cellWidth + 'px', width: cellWidth + 'px' }"></div>
          <!-- Current time marker, non-interactive. Hidden when now falls
               outside the range (the buoy can lag days behind). -->
          <div v-if="isNowInRange" class="now-line" :style="{ left: nowLineLeft + 'px' }"></div>
        </div>
      </div>
    </div>
  </div>
</template>


<script>

const CELL_WIDTH_PX = 40; // must match .dt-table td width in DTTimelineGrid.vue

export default {
  name: "DTLayout",
  props: {
    groups: Array,      // [{ name, product, variables }] - variables already filtered for the panel state
    startDate: Date,    // timeline range, so each section can span its own dates
    endDate: Date,
    scrollTo: String,   // 'center' (default) or 'end', where to park the horizontal scroll
  },
  mounted() {
    this.resetScroll();
    // Move the current time marker forward as time passes
    this.nowTimer = setInterval(() => { this.now = Date.now(); }, 60000);
  },
  // Clean up global listeners if component is destroyed
  beforeUnmount() {
    this.stopDragging();
    clearInterval(this.nowTimer);
  },
  data() {
    return {
      // Dragging variables
      isDragging: false,
      startX: 0,
      scrollLeft: 0,
      now: Date.now(),
    }
  },
  methods: {
    // Unit currently shown for a variable: its group's selection, or its own fixed unit
    unitLabel(v) {
      return v.unitGroup ? this.$gui.unitOption(v.unitGroup).unit : v.unit;
    },
    // Index of the selected time scale, ordered coarse -> fine (zoom out -> zoom in)
    currentScaleIdx() {
      return this.$gui.timescales.findIndex(t => t.id === this.$gui.timelineScaleId);
    },
    zoomIn() {
      this.$gui.timelineScaleId = this.$gui.timescales[this.currentScaleIdx() + 1].id;
      this.resetScroll();
    },
    zoomOut() {
      this.$gui.timelineScaleId = this.$gui.timescales[this.currentScaleIdx() - 1].id;
      this.resetScroll();
    },
    // Park the scroll on the newest data ('end') or on the middle of the range
    resetScroll() {
      this.$nextTick(() => {
        const slidingContainer = this.$refs.tableSlidingContainer;
        const tableContainer = this.$refs.tableContainer;
        if (!slidingContainer || !tableContainer) return;
        const hidden = Math.max(0, tableContainer.offsetWidth - slidingContainer.offsetWidth);
        slidingContainer.scrollLeft = this.scrollTo === 'end' ? hidden : hidden / 2;
      });
    },

    // DRAGGING THE TIMELINE
    startDragging(e) {
      this.isDragging = true;

      // Get the initial X position (support both Mouse and Touch)
      const pageX = e.type === 'touchstart' ? e.touches[0].pageX : e.pageX;

      const container = this.$refs.tableSlidingContainer;
      this.startX = pageX - container.offsetLeft;
      this.scrollLeft = container.scrollLeft;
      // A tap (not a drag) on a column picks its moment
      this.tapStart = { pageX, clientX: e.type === 'touchstart' ? e.touches[0].clientX : e.clientX };
      this.moved = false;

      // Add global listeners so dragging continues even if mouse leaves the div
      window.addEventListener('mousemove', this.onDragging);
      window.addEventListener('touchmove', this.onDragging);
      window.addEventListener('mouseup', this.stopDragging);
      window.addEventListener('touchend', this.stopDragging);
    },
    onDragging(e) {
      if (!this.isDragging) return;

      // Prevent default behavior to stop text selection or page bounce
      if (e.cancelable) e.preventDefault();

      const pageX = e.type === 'touchmove' ? e.touches[0].pageX : e.pageX;
      const container = this.$refs.tableSlidingContainer;

      const x = pageX - container.offsetLeft;
      if (Math.abs(pageX - this.tapStart.pageX) > 5) this.moved = true;
      // Multiplier makes the scroll speed feel more responsive
      const walk = (x - this.startX) * 1.5;
      container.scrollLeft = this.scrollLeft - walk;
    },
    stopDragging() {
      if (this.isDragging && !this.moved && this.tapStart) this.pickCell(this.tapStart.clientX);
      this.isDragging = false;
      window.removeEventListener('mousemove', this.onDragging);
      window.removeEventListener('touchmove', this.onDragging);
      window.removeEventListener('mouseup', this.stopDragging);
      window.removeEventListener('touchend', this.stopDragging);
    },
    // The column under a point of the screen sets the app's moment (see GUIManager.selectedTime)
    pickCell(clientX) {
      const inner = this.$refs.timelineInner;
      if (!inner) return;
      const index = Math.floor((clientX - inner.getBoundingClientRect().left) / CELL_WIDTH_PX);
      if (this.cells[index]) this.$gui.selectedTime = this.cells[index];
    },
  },
  computed: {
    cellWidth() {
      return CELL_WIDTH_PX;
    },
    // Column of the app's moment, -1 when it is now or outside the range
    selectedCellIndex() {
      const selected = this.$gui.selectedTime;
      if (!selected) return -1;
      const cellMs = this.$gui.timelineIntervalMinutes * 60 * 1000;
      const index = Math.floor((selected - this.startDate.getTime()) / cellMs);
      return index >= 0 && index < this.cells.length ? index : -1;
    },
    // One column per time step. Owned here so the names column, the grid and
    // the now-line all measure the same range.
    cells() {
      const startTime = this.startDate.getTime();
      const endTime = this.endDate.getTime();
      const stepMs = this.$gui.timelineIntervalMinutes * 60 * 1000;
      let cells = [];
      for (let t = startTime; t < endTime; t += stepMs)
        cells.push(new Date(t));
      return cells;
    },
    canZoomIn() {
      return this.currentScaleIdx() < this.$gui.timescales.length - 1;
    },
    canZoomOut() {
      return this.currentScaleIdx() > 0;
    },
    isNowInRange() {
      return this.now >= this.startDate.getTime() && this.now <= this.endDate.getTime();
    },
    // Horizontal offset of the current-time marker, in pixels along the grid
    nowLineLeft() {
      const elapsedMs = this.now - this.startDate.getTime();
      const cellMs = this.$gui.timelineIntervalMinutes * 60 * 1000;
      return (elapsedMs / cellMs) * CELL_WIDTH_PX;
    },
  },
  watch: {
    // A new range (scale change, or the buoy's latest datum arriving) needs the
    // scroll parked again
    cells() {
      this.resetScroll();
    },
  }
}

</script>


<style scoped>
.data-timeline-container {
  min-width: 100%;
  background: var(--lightBlue);
  align-items: flex-start;
}

.table-and-info-container {
  height: 100%;
  overflow: hidden;
  cursor: grab;
  user-select: none;
  scroll-behavior: auto;
  width: calc(100% - 145px);
  -ms-overflow-style: none;  /* IE and Edge */
  scrollbar-width: none;  /* Firefox */
}
.table-and-info-container:active {
  cursor: grabbing;
}

.table-container {
  height: 100%;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.85);
}

.timeline-inner {
  align-self: flex-start;
  position: relative;
}

.selected-cell {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.25);
  box-shadow: inset 0 0 0 2px var(--darkBlue);
  pointer-events: none;
  z-index: 2;
}
.now-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--red);
  pointer-events: none;
  z-index: 2;
}

.variable-names-container {
  width: 145px;
  min-width: 145px;
  font-size: 0.7rem;
  height: 100%;
  background: var(--lightBlue);
  align-items: flex-end;
}

.interval-picker {
  height: 22px;
  width: 100%;
  justify-content: flex-end;
  align-items: center;
  padding-right: 10px;
}

.scale-label {
  font-size: 0.7rem;
  padding: 0px 2px;
}

.zoom-btn {
  background: none;
  padding: 2px 3px;
  font-size: small;
  color: white;
  text-shadow: 0 0 4px black;
  border-radius: 4px;
  line-height: 1;
}

.zoom-btn:disabled {
  color: rgba(255, 255, 255, 0.8);
  text-shadow: none;
  cursor: default;
  transform: none;
}

.zoom-btn:hover {
  background: rgba(0, 0, 0, 0.1);
}

.variable-names-list {
  width: 100%;
  padding-right: 10px;
  align-self: flex-start;
}

/* Matches the height of the product row on the right (a plain .dt-table td) */
.group-spacer {
  height: 22px;
}

.name-row {
  height: 22px;
  justify-content: flex-end;
  gap: 6px;
}

.name-row > span {
  color: black;
  text-shadow: none;
  font-size: 0.7rem;
  padding: 0;
  text-align: right;
  line-height: 0.8;
}

.var-unit.clickable {
  text-decoration: underline;
}

</style>
