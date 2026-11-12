<template>
  <!-- "Our equipment": the ICM's own (see Assets/Scripts/ownAssets.js), with whether each one is
       transmitting. Tapping one that is takes the 3D camera there and opens its card on the map -->
  <div class="own-assets">
    <button class="roundButton icon-big icon-str clickable own-assets-button" :class="{ open }" @click="toggle"
      :title="$t('Our equipment')" :aria-expanded="open">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="#1a1a1a" stroke-width="1.8"/>
        <circle cx="12" cy="12" r="4.5" fill="none" stroke="#1a1a1a" stroke-width="1.8"/>
        <circle cx="12" cy="12" r="1.6" fill="#1a1a1a"/>
      </svg>
      <span v-if="liveCount" class="own-assets-badge">{{ liveCount }}</span>
    </button>

    <div v-if="open" class="own-assets-panel">
      <div class="own-assets-title">{{ $t('Our equipment') }}</div>
      <div v-for="group in groups" :key="group.id" class="own-assets-group">
        <div class="own-assets-group-name" v-if="group.kind === 'vehicles'">
          {{ $t(group.name) }} <span v-if="group.owner" class="own-assets-owner">· {{ group.owner }}</span>
        </div>
        <button v-for="item in group.items" :key="item.id" class="own-assets-item"
          :class="{ live: item.live, disabled: !item.clickable }" :disabled="!item.clickable" @click="go(item)">
          <span class="own-assets-dot"></span>
          <span class="own-assets-text">
            <span class="own-assets-name">{{ item.name }}</span>
            <span class="own-assets-status">{{ item.status }}</span>
          </span>
        </button>
        <div v-if="group.note" class="own-assets-note">{{ group.note }}</div>
      </div>
    </div>
  </div>
</template>


<script>
// The .vue loader cannot import modules: ownAssets.js comes through main.js
const { OWN_ASSETS, BUOY_LIVE_HOURS, isLive } = window.OwnAssets;

export default {
  name: "OwnAssetsMenu",
  data() {
    return { open: false, groups: [], liveCount: 0 };
  },
  mounted() {
    this.refresh();
    // Every 20 s (their "x min ago"), and when a vehicle reports or the fleet tracker changes
    this.interval = setInterval(this.refresh, 20000);
    window.eventBus.on('AISManager_fleet', this.refresh);
    window.eventBus.on('AISManager_receivedAISMessage', this.onAISMessage);
    document.addEventListener('pointerdown', this.onOutside);
  },
  unmounted() {
    clearInterval(this.interval);
    window.eventBus.off('AISManager_fleet', this.refresh);
    window.eventBus.off('AISManager_receivedAISMessage', this.onAISMessage);
    document.removeEventListener('pointerdown', this.onOutside);
  },
  methods: {
    toggle() {
      this.open = !this.open;
      if (this.open) this.refresh();
    },
    // Closes the list when tapping elsewhere
    onOutside(e) {
      if (this.open && !this.$el.contains(e.target)) this.open = false;
    },
    // Only our vehicles' reports, and at most once a second
    onAISMessage(ship) {
      if (!OWN_ASSETS.some(asset => asset.prefix && String(ship.MMSI).startsWith(asset.prefix))) return;
      if (this.pending) return;
      this.pending = setTimeout(() => { this.pending = undefined; this.refresh(); }, 1000);
    },
    async refresh() {
      const groups = [];
      for (const asset of OWN_ASSETS) {
        if (asset.kind === 'buoy') groups.push(await this.buoyGroup(asset));
        else groups.push(this.vehiclesGroup(asset));
      }
      this.groups = groups;
      this.liveCount = groups.flatMap(group => group.items).filter(item => item.live).length;
    },
    // The buoy: always in the scene, so always there to go to; live with recent data
    async buoyGroup(asset) {
      const buoy = this.$dataService?.buoy;
      await buoy?.ready?.();
      const latest = buoy?.latestDate;
      const hours = latest ? (Date.now() - latest) / 3600e3 : Infinity;
      const live = hours < BUOY_LIVE_HOURS;
      const status = live ? this.timeAgo(hours * 60)
        : latest ? `${this.$t('No data since')} ${latest.toLocaleDateString(this.$i18n.locale, { day: 'numeric', month: 'short' })}`
        : this.$t('No data');
      return { ...asset, items: [{ id: 'buoy', name: this.$t(asset.name), status: `${asset.owner} · ${status}`, live, clickable: true }] };
    },
    // Vehicles: those reporting now, and (BlueBoats) those the fleet tracker knows, with their last data
    vehiclesGroup(asset) {
      const ships = Object.values(window.AISManager?.ships || {}).filter(ship => String(ship.MMSI).startsWith(asset.prefix));
      const items = {};
      ships.forEach(ship => {
        const live = isLive(ship);
        items[ship.MMSI] = { id: ship.MMSI, name: ship.shipName, live, clickable: live, last: new Date(ship.lastTmst) };
      });
      const fleet = window.AISManager?.fleet;
      if (asset.prefix === 'BLUEBOAT-') {
        (fleet?.devices || []).forEach(device => {
          if (!items[device.id]) items[device.id] = { id: device.id, name: device.name, live: false, clickable: false, last: new Date(device.last_seen) };
        });
      }
      const list = Object.values(items).sort((a, b) => b.live - a.live || b.last - a.last);
      list.forEach(item => item.status = item.live ? this.$t('Transmitting') + ' · ' + this.timeAgo((Date.now() - item.last) / 60000)
        : isNaN(item.last) ? this.$t('Not transmitting') : `${this.$t('Not transmitting')} · ${this.$t('last data')} ${this.timeAgo((Date.now() - item.last) / 60000).toLowerCase()}`);
      let note;
      if (asset.prefix === 'BLUEBOAT-' && fleet?.up === false) note = this.$t('The fleet tracker is not available now');
      else if (list.length === 0) note = this.$t('None out now');
      return { ...asset, items: list, note };
    },
    // To it: the camera there, and its card on the map
    go(item) {
      if (!item.clickable) return;
      if (item.id === 'buoy') window.sceneManager?.focusOnBuoy();
      else window.sceneManager?.follow(item.id);
      this.$gui.selectedSection = 'map';
      if (this.$gui.panelState === 'hidden') this.$gui.panelState = 'compact';
      // Once the map is there (it may have just opened)
      setTimeout(() => window.eventBus.emit('Canvas3D_objectPicked', item.id), 400);
      this.open = false;
    },
    // As MapBuoyLocation.formatTimeAgo, in minutes
    timeAgo(minutes) {
      if (isNaN(minutes)) return '';
      const hours = minutes / 60;
      if (minutes < 1) return this.$t('timeAgo.now');
      if (hours < 1) return this.$t('timeAgo.minutes', { n: Math.floor(minutes) });
      if (hours < 2) return this.$t('timeAgo.hour');
      if (hours < 24) return this.$t('timeAgo.hours', { n: Math.floor(hours) });
      const days = Math.floor(hours / 24);
      if (days === 1) return this.$t('timeAgo.day');
      if (days <= 7) return this.$t('timeAgo.days', { n: days });
      return this.$t('timeAgo.moreThanWeek');
    },
  },
};
</script>


<style scoped>
.own-assets {
  position: relative;
  margin-right: 10px;
}
.own-assets-button {
  position: relative;
  border-style: none;
  padding: 0;
  border-radius: 50%;
}
.own-assets-button svg {
  width: 35px;
  height: 35px;
}
.own-assets-button.open {
  background-color: var(--blue);
}
/* How many are transmitting */
.own-assets-badge {
  color: white !important;
  text-shadow: none;
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  box-sizing: border-box;
  border-radius: 8px;
  background: #2fb35a;
  color: white;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px white;
}
.own-assets-panel {
  position: absolute;
  top: 54px;
  right: 0;
  width: min(280px, calc(100vw - 30px));
  max-height: 60vh;
  overflow: auto;
  background: rgba(255, 255, 255, 0.96);
  color: var(--darkBlue);
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  padding: 10px;
  z-index: 40; /* Over the now card (10) and the data panel (30) */
  text-align: left;
}
.own-assets-title {
  font-weight: 700;
  color: var(--blue);
  font-size: 0.85rem;
  margin-bottom: 6px;
}
.own-assets-group + .own-assets-group {
  margin-top: 8px;
}
.own-assets-group-name {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 2px 0 2px;
  opacity: 0.8;
}
.own-assets-owner {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
}
/* Over the global button and text styles (white text over a shadow) */
.own-assets-item, .own-assets-panel span, .own-assets-panel div {
  color: var(--darkBlue);
  text-shadow: none;
}
.own-assets-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  padding: 6px 6px;
  border: none;
  border-radius: 6px;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.own-assets-item:hover:not(.disabled) {
  background: rgba(var(--lightBlueRGB), 0.15);
  transition: none;
}
.own-assets-item.disabled {
  cursor: default;
  opacity: 0.55;
}
.own-assets-dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #9aa3ad;
}
.own-assets-item.live .own-assets-dot {
  background: #2fb35a;
  box-shadow: 0 0 0 3px rgba(47, 179, 90, 0.25);
}
.own-assets-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.own-assets-name {
  font-size: 0.8rem;
  font-weight: 600;
}
.own-assets-status {
  font-size: 0.68rem;
  opacity: 0.8;
}
.own-assets-note {
  font-size: 0.68rem;
  opacity: 0.7;
  padding: 2px 6px;
}
</style>
