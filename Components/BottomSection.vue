<template>
  <!-- Container -->
  <div id="bottom-section" :class="[isSectionOpen ? isMenuFullscreen ? 'bottom-section-fullscreen' : 'bottom-section-open' : 'bottom-section-closed']">
    <!-- Button to open and close section -->
    <div class="section-opener-container">
      <button class="section-opener-button clickable" @click="bottomSectionClicked">
        <span>Menu</span>
        <span class="fa" :class="[isSectionOpen ? 'rotate180' : 'rotate0']">&#xf106;</span>
      </button>
    </div>


    <div class="menu-section-container" v-show="isSectionOpen">

      <!-- Cross and top-left icons -->
      <div class="horizontal top-left-icons">
        <i class="clickable close-x fa-solid fa-xmark" @click="closeClicked"></i>
        <i class="clickable close-x" :class="isMenuFullscreen ? 'fa-solid fa-compress' : 'fa-solid fa-expand'" @click="fullscreenClicked"></i>
      </div>

      <!-- Selected section -->
      <div class="section-content">
        <component :is="selectedSection.component" />
      </div>

      <!-- Bottom options -->
      <div class="horizontal wrap button-group bottom-bar">
        <button v-for="el in menu" :key="el.id" class="clickable"
          :class="{ 'selectedOption': $gui.selectedSection === el.id }"
          @click="sectionClicked(el.id)"><span>{{ $t(el.title) }}</span></button>
      </div>
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
    // USER ACTIONS
    // Switches the visible tab - each one has a different natural height, so
    // Canvas3D needs to resize to whatever space that leaves it once the new
    // tab has rendered.
    sectionClicked: function (id){
      this.$gui.selectedSection = id;
      this.$nextTick(() => window.dispatchEvent(new Event('resize')));
    },
    // Shows / Hides bottom section
    bottomSectionClicked: function (e){
      this.$gui.panelState = this.$gui.panelState == 'hidden' ? 'compact' : 'hidden';
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 750);
    },
    // Top-left-icons
    closeClicked: function(){
      this.bottomSectionClicked();
    },
    fullscreenClicked: function(){
      this.$gui.panelState = this.$gui.panelState == 'fullscreen' ? 'compact' : 'fullscreen';
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 750);
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
  background: rgb(200 240 255);;
}

/* max-height (not height) so the section shrink-wraps its content - Data,
   Map and About each end up only as tall as they need (see their own
   max-height/clamp() for Map/About). The generous cap only exists so the
   open/close transition below has two numeric endpoints to animate between.
   No overflow:hidden here - .top-left-icons intentionally pokes out above
   this box (see its negative top), and clipping would cut it off. */
.bottom-section-open {
  max-height: 500px;
  transition: all 0.7s ease-in-out;
  /* Never squeezed below its content's need - Canvas3D (the other flex item
     in .full-screen-container) absorbs the size change instead. Fullscreen
     keeps the default flex-shrink: it relies on being squeezed to make its
     disproportionate height:900% dominate while still leaving Canvas3D some
     space (see .bottom-section-fullscreen). */
  flex-shrink: 0;
}
.bottom-section-fullscreen{
  max-height: 87vh;
  transition: all 0.7s ease-in-out;
}

.bottom-section-closed {
  max-height: 0;
  transition: all 0.7s ease-in-out;
}

.section-opener-container {
  display: flex;
  justify-content: center;
  translate: 0px -60px;
  height: 0px;
}
.section-opener-container > button {
  height: 40px;
  padding-left: 20px;
  padding-right: 20px;
  border: solid;
}
.rotate0 {
  rotate: 0deg;
  transition: all 0.7s ease-in-out;
}
.rotate180 {
  rotate: 180deg;
  transition: all 0.7s ease-in-out;
}


.menu-section-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  /* In normal flow (not absolute) so #bottom-section's height is driven by
     this container's actual content instead of a fixed percentage. */
}
/* Fullscreen: #bottom-section is genuinely tall (see .bottom-section-fullscreen),
   so fill it - this stretches .section-content (flex:1 below) to match, which in
   turn lets Map/About grow to cover it (their own "fullscreen" class) and pushes
   .bottom-bar down to the actual bottom of the page instead of floating right
   under a capped-height panel. */
.bottom-section-fullscreen .menu-section-container {
  height: 100%;
}

/* Above the section content, like the cross of the VISOC data timeline */
.top-left-icons {
  position: absolute;
  top: -26px;
  left: 8px;
  gap: 6px;
  z-index: 20;
}
.top-left-icons .close-x {
  width: 30px;
  height: 30px;
  font-size: 0.9rem;
}

.section-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow: auto;
  width: 100%;
  min-height: 100px;
  max-height: 87vh;
}

.bottom-bar {
  border-top: 1px white solid;
  background: var(--blue);
}
.bottom-bar > * {
  padding-left: 10px;
  font-size: small;
}
</style>