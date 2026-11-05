<template>
  
  <div id="render-height-panel" class="content">

    <p>
      In this section you can export a series of images of the sea state. The exported images are in grayscale and
      they encode the height of the wave.
    </p>
    
    <p>
      In the following menu you can configure the export settings,
      such as the image size, the coverage area, the frames per second, the total duration and the maximum encoded height.
    </p>

    <p>
      Scene objects and reflections are not rendered, only the sea surface height in grayscale.
    </p>

    <!-- TABLE -->
    <div class="container-vertical options">
      <!-- DURATION -->
      <div class="container-horizontal">
        <span>Duration <span class="fa"> &#xf017;</span></span>
        <div><input type="range" min="1" max="500" :value="duration" @input="e => duration = e.target.value"><span>{{ duration }} seconds</span></div>
      </div>
      <!-- FPS -->
      <div class="container-horizontal odd">
        <span>Frames per second <span class="fa"> &#xf008;</span></span>
        <div><input type="range" min="1" max="60" :value="fps"  @input="e => fps = e.target.value"><span>{{ fps }} fps</span></div>
      </div>
      <!-- Image size -->
      <div class="container-horizontal">
        <span>Image size <span class="fa" >&#xf03e;</span></span>
        <div><input type="range" min="1" max="12" :value="imgSizePw"  @input="e => imgSizePw = e.target.value"><span>{{ Math.pow(2, imgSizePw)}} x {{ Math.pow(2, imgSizePw) }} pixels</span></div>
      </div>
      <!-- Coverage -->
      <div class="container-horizontal odd">
        <span>Coverage area <span class="fa"> &#xf065;</span></span>
        <div><input type="range" min="1" max="200" :value="coverage"  @input="coverageChanged"><span>{{coverage}} x {{ coverage }} meters</span></div>
      </div>
      <!-- Max height -->
      <div class="container-horizontal">
        <span>Maximum encoded wave height</span>
        <div><input type="range" min="1" max="11" step="0.5" :value="maxWaveHeight"  @input="e => maxWaveHeight = e.target.value"><span>{{ maxWaveHeight }} meters limit</span></div>
      </div>
      
      

    </div>

    <!-- Export button -->
    <div class="container-vertical">
      <button class="renderButton clickable" @click="renderFramesClicked">Render frames <span class="fa">&#xf019;</span></button>
      <!-- Progress bar -->
      <div class="progress-container" v-show="progress!=100">
        <div :style="'width:' + progress + '%' "></div>
      </div>
      <p>This process can take several minutes. Estimated time: <strong>{{ ((duration * fps * 0.3)/60).toFixed(1) }} minutes</strong> (if your app runs at 60 fps now). 
      Estimated required space: <strong>{{ (duration * fps * 0.004 * Math.pow(3, imgSizePw) * 0.001).toFixed(1) }} MB.</strong> Number of files: 
      <strong>{{ duration * fps }} images </strong> and <strong>1 config file</strong>.
      </p>
      
      <p>
        You should configure your browser to store the files in a certain folder automatically. This will avoid you having to click "Save" for each frame.
      </p>

      <p>
        The wave heights are encoded in grayscale. The resolution is 255, as the heights are quantized in the color channel. Current wave height step: 
        <strong>{{ (maxWaveHeight/255).toFixed(3) }} meters</strong>. 
      </p>
    </div>
  </div>
</template>






<script>




export default {
  name: "RenderHeightPanel",
  created() {

  },
  mounted() {
    window.eventBus.on('SceneManager_recordProgress', (progress) => {
      this.progress = progress;
    });
    window.eventBus.on('SceneManager_recordFinished', () => {
      this.progress = 100;
    });
  },
  data() {
    return {
      duration: 1,
      fps: 10,
      imgSizePw: 10,
      coverage: 30,
      maxWaveHeight: 3,
      progress: 100,
    }
  },
  methods: {
    // USER INPUT
    renderFramesClicked: function(){
      window.eventBus.emit('RenderHeightPanel_renderFramesClicked', {
        duration: this.duration,
        fps: this.fps,
        imgSize: Math.pow(2, this.imgSizePw),
        maxWaveHeight: this.maxWaveHeight,
      });
    },
    coverageChanged: function(e) {
      this.coverage = e.target.value;
      window.eventBus.emit('RenderHeightPanel_coverageChange', this.coverage);
    }
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
  max-width: 700px;

}

.container-vertical{
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;

  
}

.options {
  padding: 20px;
  background: var(--lightBlue);
  border-radius: 20px;
}

.container-horizontal {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  justify-content: space-evenly;
  padding: 6px;
}

.container-horizontal > * {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}

.container-horizontal > span > span {
  padding-left: 10px;
}

.odd {
  background: linear-gradient(90deg, transparent 0%, #77cfef 10%, #77cfef 90%, transparent 100%);;
}

.renderButton{
  margin: 20px 20px 20px 20px;
}

.progress-container {
  width: 100%;
  background: #77cfef;
  margin-top: 10px;
  margin-bottom: 10px;
  border-radius: 25px;
  border-color: var(--darkBlue);
  border-width: thin;
  border-style: solid;
}

.progress-container > * {
  background: linear-gradient(180deg, #52b5d9, #459dbd);
  border-radius: 15px;
  margin: 1px;
  height: 24px;
}


</style>