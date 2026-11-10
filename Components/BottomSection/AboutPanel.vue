<template>
  <div id="about-panel" class="content" :class="{ fullscreen: $gui.panelState === 'fullscreen' }">

    <h5>{{ $t('aboutPanel.sourcesTitle') }}</h5>
    <dl class="sources">
      <dt>{{ $t('aboutPanel.buoy') }}</dt>
      <dd><a href="https://icatmar.cat" target="_blank">ICATMAR</a> (ICM-CSIC)</dd>
      <dt>{{ $t('aboutPanel.forecast') }}</dt>
      <dd><a href="https://open-meteo.com" target="_blank">Open-Meteo</a> (Météo-France) · <a href="https://marine.copernicus.eu" target="_blank">Copernicus Marine</a></dd>
      <dt>{{ $t('aboutPanel.ships') }}</dt>
      <dd>AIS · <a href="https://aisstream.io" target="_blank">aisstream.io</a></dd>
      <dt>{{ $t('aboutPanel.map') }}</dt>
      <dd><a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · <a href="https://www.openseamap.org" target="_blank">OpenSeaMap</a> · <a href="https://emodnet.ec.europa.eu/en/bathymetry" target="_blank">EMODnet</a> · <a href="https://www.icgc.cat" target="_blank">ICGC</a> (CC BY 4.0)</dd>
    </dl>

    <h5>{{ $t('Contact') }}</h5>
    <p>
      {{ $t('aboutPanel.contact') }} <a href="https://github.com/sio-icm/boiasomorrostro/issues" target="_blank">GitHub</a>.
      {{ $t('aboutPanel.buoyData') }} {{ emailObs }}@{{ emailProviderIcatmar }}.
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
    <p>{{ $t('howtocite') }}</p>

    <p class="citation">Llorach Tó, G., Martí Comas, A., Pitarch Claramunt, X., Ribera Altimir, J., Molina, D., Casals Baixas, C., ... & Ballabrera Poy, J. (2025). Data flow, infrastructure, harmonization and 3d visualization: the use case of somorrostro’s moored buoy’s deployment. Instrumentation viewpoint, (24), 32-33.</p>

    <p class="citation">Llorach-Tó, G., Martínez, E., Fernández, J. D. R., & García-Ladona, E. (2023, June). Experience OBSEA: a web-based 3D virtual environment of a seafloor observatory. In OCEANS 2023-Limerick (pp. 1-6). IEEE.</p>

    <p class="citation">Llorach-Tó, G., Martínez, E., Del-Río, J., Simarro, G., Pani, M., Bucchi, A., ... & García-Ladona, E. (2024). 3D Digital Twins of the Ocean: towards an intuitive and realistic visualization of wave parameters (No. EGU24-19105). Copernicus Meetings.</p>

    <!-- The original project's institutions and funders -->
    <div class="logos-container">
      <img src="img/logos/ICATMAR512.png" alt="ICATMAR">
      <img src="img/logos/AjuntamentBarcelona.png" alt="Ajuntament de Barcelona">
      <img src="img/logos/Generalitat.png" alt="Generalitat de Catalunya">
    </div>

    <p class="notice"><b>{{ $t('aboutPanel.noticeTitle') }}.</b> {{ $t('aboutPanel.notice') }}</p>

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
  color: var(--darkBlue);
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
  padding: 0;
  line-height: 1.5;
}
h5 {
  margin: 1.2rem 0 0.4rem;
  color: var(--blue); /* Titles in the ICM's ultramarine */
  font-weight: 700;
}
h5:first-child {
  margin-top: 0;
}
.sources {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0;
}
.sources dt {
  font-weight: 600;
}
.sources dd {
  margin: 0;
}
.logos-container {
  margin: 0.8rem 0;
}
.notice {
  margin-top: 1.2rem;
  font-size: 0.72rem;
  opacity: 0.75;
}

.citation {
  font-style: italic;
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