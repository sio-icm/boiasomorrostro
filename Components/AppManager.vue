<template>
  <!-- Container -->
  <div id="app-manager" ref="appManager">

    <div class="full-screen-container">
      <!-- Canvas 3D -->
      <canvas3D></canvas3D>
      <!-- Bottom section -->
      <bottom-section></bottom-section>

      <!-- Central Panel -->
      <central-panel></central-panel>
    </div>


    <!-- Top right icons -->
    <top-right-menu></top-right-menu>

    <!-- Top left icons that show how to control the ocean -->
    <!-- <top-left-menu></top-left-menu> -->


    <!-- Central Panel -->
    <central-panel></central-panel>



    <!-- LEFT ICONS -->
    <div class="logos-container">
      <!-- Original project's credits are in the About section (see AboutPanel.vue) -->
      <a href="https://www.icm.csic.es/" target="_blank" title="SIO · ICM-CSIC">
      <img class="logo clickable" src="img/logos/SIO.png" alt="SIO · ICM-CSIC">
      </a>
    </div>
    

    <!-- RIGHT ICONS -->
    <div class="top-right-icons-container">
      <!-- FPS button -->
      <div class="clickable icon-str" @click="fpsClicked">fps</div>
      <!-- github button -->
      <a href="https://github.com/sio-icm/boiasomorrostro" :title="$i18n.t('githubButton')" target="_blank">
        <svg height="32" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="32" data-view-component="true" class="clickable github-logo">
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
        </svg>
      </a>
      <!-- information button -->
      <div class="clickable icon-str" @click="infoIconClicked" :title="$i18n.t('information')">i</div>
      <!-- language selector -->
      <language-selector></language-selector>

    </div>
    
  </div>
</template>



<script>


// Import components
import Canvas3D from "./Canvas3D.vue"
import BottomSection from "./BottomSection.vue"
import InstrumentsMenu from "./Instruments/InstrumentsMenu.vue"
import TopRightMenu from "./TopRight/TopRightMenu.vue"
import TopLeftMenu from "./TopLeft/TopLeftMenu.vue"
import CentralPanel from "./CentralPanel.vue"
import LanguageSelector from "/boiasomorrostro/Components/TopRight/LanguageSelector.vue"

export default {
  name: "AppManager",
  created() {
    
  },
  mounted() {
    // Mobile bottom bar full height fix
    // https://dev.to/admitkard/mobile-issue-with-100vh-height-100-100vh-3-solutions-3nae
    this.$refs.appManager.style.height = window.innerHeight + 'px';
    window.onresize =  () => {
      this.$refs.appManager.style.height = window.innerHeight + 'px';
    }; 
  },
  data (){
    return {

    }
  },
  methods: {
    //onclick: function(e){},
    // Opens the About section (the old info panel is OBSEA's)
    infoIconClicked: function(){
      this.$gui.selectedSection = 'about';
      if (this.$gui.panelState === 'hidden') this.$gui.panelState = 'compact';
    },
    fpsClicked: function() {
      window.eventBus.emit('AppManager_fpsButtonClicked');
    }
  },
  components: {
    "canvas3D": Canvas3D,
    "bottom-section": BottomSection,
    "instruments-menu": InstrumentsMenu,
    "top-right-menu": TopRightMenu,
    "top-left-menu": TopLeftMenu,
    "central-panel": CentralPanel,
    "language-selector": LanguageSelector,
  }
}
</script>


<style scoped>
#app-manager {
    width: 100vw;

    height: 100vh;
    position: fixed;
    /*height: 100%;
    position: absolute;*/

  }

.full-screen-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

  .logo {
  width: clamp(35px, 7vw, 60px);
  height: clamp(35px, 7vw, 60px);
  z-index: 10;
}

.logos-container {
  left: clamp(10px, 7vw, 70px);
  display: flex;
  position: fixed;
  top: 10px;
  padding: 0px;
  margin: 0px;
}

.top-right-icons-container{
  position: absolute;
  top: 6px;
  right: 10px;

  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
}

.top-right-icons-container > * {
  width: 28px;
  height: 28px;

  padding: 0px;
  margin: 5px;
  z-index: 10;
}

.github-logo {
  background: white;
  border-radius: 50%;
  border-color: black !important;
  border-width: thick;
  border: double;
  width: 28px;
  height: 28px;
}

</style>