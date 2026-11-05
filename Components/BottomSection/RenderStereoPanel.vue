<template>
  
  <div id="render-stereo-panel" class="content">

    <p>
      In this section you can export a series of images of the sea state. The exported images are renders of two cameras
      with a stereo setup. This setup is designed to produce data for the method WASS 
      <a href="https://doi.org/10.1016/j.cageo.2017.07.001" target="_blank">(Bergamasco, F. et al. 2017)</a>.
    </p>
    
    <p>
      In the following menu you can configure the export settings and the positions of the cameras. Scene objects are not rendered.
    </p>


    <!-- TABLE -->
    <div class="container-vertical options">
      <!-- DURATION -->
      <div class="container-horizontal">
        <span>Duration</span>
        <div><input type="range" min="1" max="500" :value="duration" @input="e => duration = e.target.value"><span>{{ duration }} seconds</span></div>
      </div>
      <!-- FPS -->
      <div class="container-horizontal">
        <span>Frames per second</span>
        <div><input type="range" min="1" max="60" :value="fps"  @input="e => fps = e.target.value"><span>{{ fps }} fps</span></div>
      </div>
      <!-- Grayscale -->
      <div class="container-horizontal">
        <span>Grayscale</span>
        <div><input type="checkbox" v-model="grayscale"><span>(50% reduction)</span></div>
      </div>
      <!-- LEFT CAMERA -->
      <div class="container-horizontal section">
        <span>Left camera</span>
      </div>
      <!-- Left Camera position -->
      <div class="container-horizontal">
        <span>Left camera position (Y=height)</span>
        <div class="container-horizontal">
          <input  type="number" min="-500" max="500" step="0.01" :value="camLPos[0]" v-model="camLPos[0]" name="camLPos" @change="onChange($event)"/>
          <input  type="number" min="0" max="500" step="0.01" :value="camLPos[1]" v-model="camLPos[1]" name="camLPos" @change="onChange($event)"/>
          <input  type="number" min="-500" max="500" step="0.01" :value="camLPos[2]" v-model="camLPos[2]" name="camLPos" @change="onChange($event)"/>
          <span> m</span>   
        </div>
      </div>
      <!-- Left Camera rotation -->
      <div class="container-horizontal">
        <span>Left camera rotation (Pitch and Yaw)</span>
        <div class="container-horizontal">
          <input  type="number" min="-90" max="90" step="0.01" :value="camLPitchYaw[0]" v-model="camLPitchYaw[0]" name="camLPos" @change="onChange($event)"/>
          <input  type="number" min="-180" max="180" step="0.01" :value="camLPitchYaw[1]" v-model="camLPitchYaw[1]" name="camLPos" @change="onChange($event)"/>
          <span> º</span>     
        </div>
      </div>

      <!-- RIGHT CAMERA -->
      <div class="container-horizontal section">
        <span>Right camera</span>
      </div>
      <!-- Right Camera position -->
      <div class="container-horizontal">
        <span>Right camera position (Y=height)</span>
        <div class="container-horizontal">
          <input  type="number" min="-500" max="500" step="0.01" :value="camRPos[0]" v-model="camRPos[0]" name="camRPos" @change="onChange($event)"/>
          <input  type="number" min="0" max="500" step="0.01" :value="camRPos[1]" v-model="camRPos[1]" name="camRPos" @change="onChange($event)"/>
          <input  type="number" min="-500" max="500" step="0.01" :value="camRPos[2]" v-model="camRPos[2]" name="camRPos" @change="onChange($event)"/>
          <span> m</span>   
        </div>
      </div>
      <!-- Right Camera rotation -->
      <div class="container-horizontal">
        <span>Right camera rotation (Pitch and Yaw)</span>
        <div class="container-horizontal">
          <input  type="number" min="-90" max="90" step="0.01" :value="camRPitchYaw[0]" v-model="camRPitchYaw[0]" name="camRPos" @change="onChange($event)"/>
          <input  type="number" min="-180" max="180" step="0.01" :value="camRPitchYaw[1]" v-model="camRPitchYaw[1]" name="camRPos" @change="onChange($event)"/>
          <span> º</span>     
        </div>
      </div>


    </div>

    <!-- Export button -->
    <div class="container-vertical">
      <button class="renderButton clickable" @click="renderFramesClicked">Render frames <span class="fa">&#xf019;</span></button>
      <!-- Progress bar -->
      <div class="progress-container" v-show="progress!=100">
        <div :style="'width:' + progress + '%' "></div>
      </div>
      <p>This process can take several minutes. Estimated time: <strong>{{ (duration * fps * 0.6 * 2)/60 }} minutes</strong> (if your app runs at 60 fps now). 
      Estimated required space: <strong>{{ grayscale ? duration * fps * 2 * 2 : duration * fps * 2 * 4 }} MB.</strong></p>

      <p>If you need the camera parameters (intrinsics), you can render several frames containing a checkerboard (black/white squares of 0.1 x 0.1 meters).
        The checkerboard is placed in front of the cameras according to their default position and orientation.
      </p>

      <!-- Calibration button -->
      <div class="container-horizontal">
        <button class="calibButton clickable" @click="renderCalibrationClicked">Render calibration frames <span class="fa">&#xf43c;</span></button>
      </div>
    </div>
  </div>
</template>






<script>




export default {
  name: "RenderStereoPanel",
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
      grayscale: false,
      progress: 100,
      // Data hardcoded from Rcorder.js constructor
      camLPos: [- 5.04 / 2, 33, 0],
      camLPitchYaw: [-25, 0], 
      camRPos: [5.04 / 2, 33, 0],
      camRPitchYaw: [-25, 0],
    }
  },
  methods: {
    // USER INPUT
    onChange: function(e, camLorR, variable){
      window.eventBus.emit('RenderStereoPanel_camConfigChanged', {
        camLPos: this.camLPos,
        camLPitchYaw: this.camLPitchYaw, 
        camRPos: this.camRPos,
        camRPitchYaw: this.camRPitchYaw
      });
    },
    renderCalibrationClicked: function(){
      window.eventBus.emit('RenderStereoPanel_calibrateClicked');
    },
    renderFramesClicked: function(){
      window.eventBus.emit('RenderStereoPanel_renderFramesClicked', {
        duration: this.duration,
        fps: this.fps,
        grayscale: this.grayscale,
      });
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
  padding: 2px;
}

.container-horizontal > * {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  max-height: 25px;
}

.section {
  background: linear-gradient(90deg, transparent 0%, #77cfef 10%, #77cfef 90%, transparent 100%);
}

input {
  border-radius: 5px;
  text-align: center;
  font-size: small;
}

.renderButton{
  margin: 20px 20px 20px 20px;
}

.calibButton{
  width: auto;
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