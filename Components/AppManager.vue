<template>
  <!-- Container -->
  <div id="app-manager" ref="appManager">

    <div class="full-screen-container">
      <!-- Canvas 3D -->
      <canvas3D></canvas3D>
      <!-- Bottom section -->
      <bottom-section></bottom-section>
    </div>


    <!-- Top right icons -->
    <top-right-menu></top-right-menu>



    <!-- LEFT ICONS -->
    <div class="logos-container">
      <!-- Original project's credits are in the About section (see AboutPanel.vue) -->
      <a href="https://www.icm.csic.es/" target="_blank" title="SIO · ICM-CSIC">
      <img class="logo clickable" src="img/logos/SIO.png" alt="SIO · ICM-CSIC">
      </a>
    </div>
    

    <!-- Conditions now (see NowCard.vue) -->
    <now-card></now-card>

    <!-- RIGHT ICONS: a menu with the less used options, and the language -->
    <div class="top-right-icons-container">
      <div class="more-menu">
        <div class="clickable icon-str" @click.stop="moreOpen = !moreOpen" :title="$t('More options')">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </div>
        <div class="more-menu-items" v-if="moreOpen" @click="moreOpen = false">
          <div class="clickable" @click="infoIconClicked"><i class="fa-solid fa-circle-info"></i> {{ $t('About') }}</div>
          <a class="clickable" href="https://github.com/sio-icm/boiasomorrostro" target="_blank"><i class="fa-brands fa-github"></i> {{ $t('githubButton') }}</a>
          <div class="clickable" @click="fpsClicked"><i class="fa-solid fa-gauge"></i> {{ $t('Show FPS') }}</div>
        </div>
      </div>
      <!-- language selector -->
      <language-selector></language-selector>

    </div>
    
  </div>
</template>



<script>


// Import components
import Canvas3D from "./Canvas3D.vue"
import BottomSection from "./BottomSection.vue"
import TopRightMenu from "./TopRight/TopRightMenu.vue"
import LanguageSelector from "/boiasomorrostro/Components/TopRight/LanguageSelector.vue"
import NowCard from "./NowCard.vue"

export default {
  name: "AppManager",
  created() {
    
  },
  mounted() {
    // The options menu closes when clicking anywhere else
    document.addEventListener('click', () => this.moreOpen = false);
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
  data() {
    return { moreOpen: false };
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
    "top-right-menu": TopRightMenu,
    "language-selector": LanguageSelector,
    "now-card": NowCard,
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

.more-menu {
  position: relative;
}
.more-menu > .icon-str {
  display: flex;
  align-items: center;
  justify-content: center;
}
.more-menu-items {
  position: absolute;
  top: 36px;
  right: 0;
  min-width: 230px;
  padding: 6px;
  border-radius: 12px;
  background: white;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 30;
}
.more-menu-items > * {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--darkBlue);
  text-decoration: none;
  font-size: 0.85rem;
}
.more-menu-items > *:hover {
  background: rgba(47, 127, 181, 0.12);
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