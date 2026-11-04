<template>
  
  <div id="about-panel" class="content" :class="{ fullscreen: $gui.panelState === 'fullscreen' }">

    <p>{{$t('intro')}}</p>

    <!-- Disclaimer -->
    <p> {{ $t('disclaimer') }}</p>

    <!-- Concept -->
    <p> {{ $t('concept') }}</p>

    <!-- <p>You can check out some of the 3D digital twins 
      developed related to this web application:</p>
    <div class="container-vertical">
      <button onclick="window.open('https://cgi-dto.github.io/OBSEA/', '_blank')">Digital Twin of a cabled underwater observatory (OBSEA) <span class="fa">&#xf08e;</span></button>
      <button onclick="window.open('https://cgi-dto.github.io/Barcelona/', '_blank')">Digital Twin of Barcelona's sea state <span class="fa">&#xf08e;</span></button>
    </div> -->
    
    <!-- Contact -->
    <h5>{{ $t('Contact') }}</h5>
    <p>
      {{ $t('contact-sio') }} <a href="https://github.com/sio-icm/boiasomorrostro/issues" target="_blank">GitHub</a>.
      {{ $t('contact-buoy-data') }} {{ emailObs }}@{{ emailProviderIcatmar }}.
    </p>
    <div class="logos-container">
      <img class="sio-logo" :src="'img/logos/SIO-' + logoLang + '.png'" alt="SIO">
      <img src="img/logos/icm.png" alt="ICM-CSIC">
      <img src="img/logos/CSIC.png" alt="CSIC">
    </div>

    <!-- Original project: this version is built on ICATMAR's -->
    <h5>{{ $t('Original project') }}</h5>
    <p>
      {{ $t('original-1') }} <a href="https://icatmar.github.io/boiasomorrostro/" target="_blank">Boia Somorrostro</a>{{ $t('original-2') }}
      <a href="https://icatmar.cat" target="_blank">ICATMAR</a> {{ $t('original-3') }}
      <a href="https://github.com/ICATMAR/boiasomorrostro" target="_blank">{{ $t('original-repository') }}</a>.
      {{ $t('author-info-gerard') }} {{ email }}@{{ emailProvider }}.
    </p>
    <p>{{$t('howtocite')}}</p>

    <p class="citation">Llorach Tó, G., Martí Comas, A., Pitarch Claramunt, X., Ribera Altimir, J., Molina, D., Casals Baixas, C., ... & Ballabrera Poy, J. (2025). Data flow, infrastructure, harmonization and 3d visualization: the use case of somorrostro’s moored buoy’s deployment. Instrumentation viewpoint, (24), 32-33.</p>

    <p class="citation">Llorach-Tó, G., Martínez, E., Fernández, J. D. R., & García-Ladona, E. (2023, June). Experience OBSEA: a web-based 3D virtual environment of a seafloor observatory. In OCEANS 2023-Limerick (pp. 1-6). IEEE.</p>

    <p class="citation">Llorach-Tó, G., Martínez, E., Del-Río, J., Simarro, G., Pani, M., Bucchi, A., ... & García-Ladona, E. (2024). 3D Digital Twins of the Ocean: towards an intuitive and realistic visualization of wave parameters (No. EGU24-19105). Copernicus Meetings.</p>

    <!-- The original project's institutions and funders -->
    <div class="attributions-container">
      <div class="logos-container">
        <img src="img/logos/ICATMAR512.png" alt="ICATMAR">
        <img src="img/logos/AjuntamentBarcelona.png" alt="Ajuntament de Barcelona">
        <img src="img/logos/Generalitat.png" alt="Generalitat de Catalunya">
      </div>
    </div>
    

  </div>
  

</template>






<script>




export default {
  name: "AboutPanel",
  created() {

  },
  mounted() {

  },
  data() {
    return {
      email: 'gerard.llorach',
      emailProvider: 'csic.es',
      emailObs: 'observacions',
      emailProviderIcatmar: 'icatmar.cat'
    }
  },
  computed: {
    // The SIO's logo exists in Spanish, Catalan and English
    logoLang() {
      return ['es', 'ca', 'en'].find(code => this.$i18n.locale.startsWith(code)) || 'en';
    },
  },
  methods: {

  },
  components: {

  }
}
</script>



<style scoped>

.content {
  padding: 20px;
  overflow: auto;
  font-size: small;
  max-width: 800px;
  /* Fixed-ish size in "visible" mode, matching MapBuoyLocation - the text can
     vary in length, so this keeps the panel a reasonable, consistent size. */
  height: clamp(250px, 45vh, 400px);
  box-sizing: border-box;
}

.content.fullscreen {
  flex: auto;
}

p {
  text-align: justify;
}

.container-vertical {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 1rem;
}
.container-vertical > button {
  margin: 5px;
}

.citation {
  font-style: italic;
}



.attributions-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.logos-container {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  
}
.logos-container > img {
  width: 20%;
  object-fit: contain;
  padding-left: 2%;
  padding-right: 2%;
  max-width: 150px;
  max-height: 60px;
}
.logos-container > img.sio-logo {
  width: 35%;
  max-width: 240px;
  max-height: 80px;
}
</style>