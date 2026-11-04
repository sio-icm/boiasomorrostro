<template>
  <!-- Data panel, docked at the bottom: tabs on top, and its height changes between collapsed
       (tabs only), compact and fullscreen by dragging or tapping the handle, or with the buttons -->
  <div id="bottom-section" :class="'panel-' + $gui.panelState">
    <div class="panel-header">
      <div class="panel-handle" @pointerdown="dragStart" :title="$t(isSectionOpen ? 'Collapse' : 'Expand')"><span></span></div>
      <div class="panel-bar">
        <div class="panel-tabs button-group">
          <button v-for="el in menu" :key="el.id" class="clickable"
            :class="{ 'selectedOption': $gui.selectedSection === el.id && isSectionOpen }"
            @click="sectionClicked(el.id)"><span>{{ $t(el.title) }}</span></button>
        </div>
        <div class="panel-size-buttons">
          <i v-if="isSectionOpen" class="clickable fa-solid" :class="isMenuFullscreen ? 'fa-compress' : 'fa-expand'"
            :title="$t(isMenuFullscreen ? 'Reduce' : 'Enlarge')" @click="setPanelState(isMenuFullscreen ? 'compact' : 'fullscreen')"></i>
          <i class="clickable fa-solid" :class="isSectionOpen ? 'fa-chevron-down' : 'fa-chevron-up'"
            :title="$t(isSectionOpen ? 'Collapse' : 'Expand')" @click="setPanelState(isSectionOpen ? 'hidden' : 'compact')"></i>
        </div>
      </div>
    </div>

    <!-- Selected section -->
    <div class="section-content" v-show="isSectionOpen">
      <component :is="selectedSection.component" />
    </div>
  </div>
</template>


<script>

// import DiscreteWaves from './BottomSection/DiscreteWavesPanel.vue';
// import SeaStateAnalysisPanel from './BottomSection/SeaStateAnalysisPanel.vue';
// import RenderStereoPanel from './BottomSection/RenderStereoPanel.vue';
// import RenderHeightPanel from './BottomSection/RenderHeightPanel.vue';

import RawData from './BottomSection/RawData.vue';
import ForecastSection from './BottomSection/ForecastSection.vue';
import ObservationsSection from './BottomSection/ObservationsSection.vue';
import WindSection from './BottomSection/WindSection.vue';
import MapBuoyLocation from './BottomSection/MapBuoyLocation.vue';
import AboutPanel from './BottomSection/AboutPanel.vue';
import HistorySection from './BottomSection/HistorySection.vue';


export default {
  name: "BottomSection",
  created() {},
  mounted() {
    // The section's height is now driven by its content, so Canvas3D needs a
    // resize signal once that content has actually settled after mount.
    this.$nextTick(() => window.dispatchEvent(new Event('resize')));
  },
  data () {
    return {
      // Menu structure. id is what the URL hash holds (see GUIManager)
      menu: [
        {
          title: 'Observations',
          id: 'observations',
          component: 'observationsSection',
        },
        {
          title: 'Forecast',
          id: 'forecast',
          component: 'forecastSection',
        },
        {
          title: 'History',
          id: 'history',
          component: 'historySection',
        },
        {
          title: 'Wind',
          id: 'wind',
          component: 'windSection',
        },
        {
          title: 'Map',
          id: 'map',
          component: 'mapBuoyLocation'
        },
        {
          title: 'About',
          id: 'about',
          component: 'about',
        } // End of about
        // {
        //   title: 'Waves',
        //   icon: '&#xf773',
        //   children: [
        //     {
        //       title: 'Discrete waves',
        //       component: 'discrete-waves'
        //     },
        //     {
        //       title: 'Sea state analysis',
        //       icon: '&#xf201',
        //       component: 'sea-state-analysis'
        //     },
        //     {
        //       title: 'Generate sea state',
        //       icon: '&#xf1fe',
        //       component: 'generate-sea-state'
        //     }
        //   ]
        // }, // End of waves
        // {
        //   title: 'Export',
        //   icon: '&#xf56e',
        //   children: [
        //     {
        //       title: 'Export discrete waves (.json)',
        //       isClickEvent: true,
        //       event: () => {
        //         window.eventBus.emit('BottomSection_ExportWavesClicked');
        //       }
        //     },
        //     {
        //       title: 'Render heights (.png)',
        //       icon: '&#xf302',
        //       component: 'render-heights',
        //     },
        //     {
        //       title: 'Render stereo cameras (.png)',
        //       icon: '&#xf302',
        //       component: 'render-stereo',
        //     }
        //   ]
        // }, // End of export
        // {
        //   title: 'Scene',
        //   icon: '&#xf61f',
        //   children: [
        //     {
        //       title: 'Add/Remove objects',
        //       component: 'SceneObjects'
        //     },
        //     {
        //       title: 'Colors',
        //       component: 'SceneColors',
        //     },
        //     {
        //       title: 'Environment',
        //       component: 'SceneEnvironment'
        //     }
        //   ]
        // }, // End of scene
        // {
        //   title: 'About',
        //   icon: '&#xf05a',
        //   component: 'about'
        // } // End of about
      ] // End of menu
    }
  },
  methods: {
    // A tab opens its section, and the panel if it was collapsed
    sectionClicked: function (id){
      this.$gui.selectedSection = id;
      if (!this.isSectionOpen) this.setPanelState('compact');
      this.$nextTick(() => window.dispatchEvent(new Event('resize')));
    },
    setPanelState: function (state){
      this.$gui.panelState = state;
      // The 3D canvas and the map resize once the panel has its new height
      this.$nextTick(() => window.dispatchEvent(new Event('resize')));
      setTimeout(() => window.dispatchEvent(new Event('resize')), 400);
    },
    // Handle: a tap opens or collapses it; dragging up or down steps through
    // collapsed, compact and fullscreen
    dragStart: function (e){
      const startY = e.clientY;
      const states = ['hidden', 'compact', 'fullscreen'];
      const up = (end) => {
        window.removeEventListener('pointerup', up);
        const dy = end.clientY - startY;
        const index = states.indexOf(this.$gui.panelState);
        if (Math.abs(dy) < 8) this.setPanelState(this.isSectionOpen ? 'hidden' : 'compact');
        else this.setPanelState(states[Math.max(0, Math.min(2, index + (dy < 0 ? 1 : -1) * (Math.abs(dy) > 250 ? 2 : 1)))]);
      };
      window.addEventListener('pointerup', up);
    },
  },
  computed: {
    // Menu entry of the section selected in the URL hash
    selectedSection: function(){
      return this.menu.find(el => el.id == this.$gui.selectedSection);
    },
    isSectionOpen: function(){
      return this.$gui.panelState != 'hidden';
    },
    isMenuFullscreen: function(){
      return this.$gui.panelState == 'fullscreen';
    },
  },
  components: {
    // "discrete-waves": DiscreteWaves,
    // "sea-state-analysis": SeaStateAnalysisPanel,
    // "render-heights": RenderHeightPanel,
    // "render-stereo": RenderStereoPanel,
    "rawData": RawData,
    "forecastSection": ForecastSection,
    "observationsSection": ObservationsSection,
    "windSection": WindSection,
    "mapBuoyLocation": MapBuoyLocation,
    "about": AboutPanel,
    "historySection": HistorySection,
    
  }
}


</script>






<style scoped>
#bottom-section {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: rgb(200 240 255);
  border-radius: 14px 14px 0 0;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.25);
  margin-top: -14px; /* Over the 3D view's bottom edge, under the rounded corners */
  z-index: 5;
}
/* Fullscreen: tall, leaving a strip of the 3D view (Canvas3D absorbs the rest) */
.panel-fullscreen {
  height: 87vh;
}

/* HEADER: handle and tabs */
.panel-header {
  background: var(--blue);
  border-radius: 14px 14px 0 0;
}
.panel-handle {
  display: flex;
  justify-content: center;
  padding: 6px 0 2px;
  cursor: ns-resize;
  touch-action: none;
}
.panel-handle span {
  width: 44px;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.7);
}
.panel-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 4px;
}
.panel-tabs {
  flex: 1;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px;
}
.panel-tabs > button {
  flex-shrink: 0;
  font-size: small;
  padding: 2px 12px;
}
.panel-size-buttons {
  display: flex;
  gap: 4px;
}
.panel-size-buttons i {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  border-radius: 50%;
}
.panel-size-buttons i:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* CONTENT */
.section-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow: auto;
  width: 100%;
  min-height: 100px;
  max-height: 55vh;
}
.panel-fullscreen .section-content {
  flex: 1;
  max-height: none;
}
</style>