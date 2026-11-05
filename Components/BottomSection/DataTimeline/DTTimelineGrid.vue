<template>
<table class="dt-table">
  <tbody>
    <!-- Days of week -->
    <tr>
      <td v-for="day in days" :key="day.date" :colspan="day.span" class="weekDayCell">
        <span>{{ day.textLong }}</span>
      </td>
    </tr>
    <!-- Hours: single label per cell -->
    <tr>
      <td v-for="(cell, index) in cells" :key="index" class="hourCell">
        <span :style="{ opacity: ($gui.timelineHours(cell) < 6 || $gui.timelineHours(cell) >= 21) ? '0.4' : '1' }">{{ $gui.timelineHours(cell) }}</span>
      </td>
    </tr>
    <!-- Data rows provided by the caller -->
    <slot></slot>
  </tbody>
</table>
</template>


<script>

export default {
  name: "DTTimelineGrid",
  props: {
    cells: Array, // [Date], one per column - owned by DTLayout
  },
  computed: {
    days() {
      let days = [];
      for (const cell of this.cells) {
        const last = days[days.length - 1];
        if (last && this.$gui.timelineDate(last.date) === this.$gui.timelineDate(cell))
          last.span++;
        else
          days.push({
            date: cell,
            span: 1,
            textLong: this.$gui.timelineFormatDay(cell, this.$i18n.locale),
          });
      }
      return days;
    },
  }
}

</script>


<!-- Non-scoped: applies to slot content rendered by the DataTimeline -->
<style>
.dt-table {
  border-collapse: collapse;
  border-spacing: 0;
  align-self: flex-start;
}

.dt-table td {
  width: 40px;
  height: 22px;
  text-align: center;
}

/* Overrides the global span style (white, shadowed and larger) inside the grid */
.dt-table td > * {
  color: black;
  text-shadow: none;
  text-wrap: nowrap;
  font-size: 0.7rem;
  padding: 0;
}

.weekDayCell {
  text-align: left;
  padding-left: 15px;
  border-left: 1px solid gray;
  border-bottom: 1px solid gray;
}

.hourCell {
  border-bottom: 1px solid #0000002e;
  position: relative;
  overflow: visible;
}

.hourCell > span {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translate(-50%, -50%);
  white-space: nowrap;
}

/* Row naming a data product, slotted in by the sections. Prefixed with td to
   outweigh the ".dt-table td > *" reset above. The td spans every column
   (colspan) so its background covers the full row; .group-cell-label inside
   it sticks to the left edge of the scrolling viewport (see
   .table-and-info-container in DTLayout.vue) so the label stays visible
   while the row's data cells scroll underneath it. */
td.group-cell {
  text-align: left;
  padding: 0;
  background: rgb(226, 225, 243); /* The ICM's pale ultramarine */
}
/* td.group-cell prefix (not just .group-cell-label) to outweigh the
   ".dt-table td > *" reset's own padding:0 - same specificity trick as above */
td.group-cell > .group-cell-label {
  position: sticky;
  left: 0;
  display: inline-block;
  padding-left: 10px;
  white-space: nowrap;
}
.group-cell-label > span,
.group-cell-label > a {
  font-size: 0.7rem;
  color: var(--blue);
  text-shadow: none;
}
.group-cell-label > a {
  text-decoration: underline;
}

/* Sub-row naming a buoy sensor within a product group, used by the extended
   observations view (see ObservationsSection.vue's sensorGroups). Same
   sticky-label trick as .group-cell, darker and indented to read as nested
   under the product row above it. */
td.sensor-cell {
  text-align: left;
  padding: 0;
  background: rgb(241, 240, 249); /* Paler than the product row above */
}
td.sensor-cell > .sensor-cell-label {
  position: sticky;
  left: 0;
  display: inline-block;
  padding-left: 20px;
  white-space: nowrap;
  color: var(--darkBlue);
  text-shadow: none;
}
.sensor-cell-label {
  font-size: 0.7rem;
  font-style: italic;
  color: var(--darkBlue);
}
</style>
