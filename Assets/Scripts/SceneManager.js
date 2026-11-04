import * as THREE from 'three';
import Stats from '/boiasomorrostro/lib/three.js/examples/jsm/libs/stats.module.js';
import { OrbitControls } from '/boiasomorrostro/lib/three.js/examples/jsm/controls/OrbitControls.js';
import { RosaVentsEntity } from '/boiasomorrostro/Assets/Orientation/RosaVentsEntity.js';
// import { SandEntity } from '/boiasomorrostro/Assets/Terrain/SandEntity.js';
import { SkyboxEntity } from '/boiasomorrostro/Assets/Skybox/SkyboxEntity.js';
// CoastLine
import { CoastLineEntity } from '/boiasomorrostro/Assets/Terrain/CoastLine/CoastLineEntity.js';


import * as FogShader from '/boiasomorrostro/Assets/Terrain/FogShader.js'
import { OceanEntity } from '/boiasomorrostro/Assets/Ocean/OceanEntity.js';

import { SomorrostroBuoyEntity } from '/boiasomorrostro/Assets/SomorrostroBuoy/SomorrostroBuoyEntity.js';
// import { HeavyChainsEntity } from '/boiasomorrostro/Assets/Mooring/HeavyChainsEntity.js';


//import { WindsockEntity } from '/boiasomorrostro/Assets/Windsock/WindsockEntity.js';
import { FlagEntity } from '/boiasomorrostro/Assets/Flag/FlagEntity.js';
import { CurrentEntity } from '/boiasomorrostro/Assets/Current/CurrentEntity.js';
import { TextMeshEntity } from '/boiasomorrostro/Assets/TextMesh/TextMeshEntity.js';

// AIS Vessels
import { AISVesselsManager } from '/boiasomorrostro/Assets/AISVessels/AISVesselsManager.js';
import { sunPosition } from '/boiasomorrostro/Assets/Scripts/SunPosition.js';
import { CityLights } from '/boiasomorrostro/Assets/Terrain/CoastLine/CityLights.js';

// Light by the height of the sun (degrees), interpolated between these states:
//  tint      multiplies the sky panorama, the air and the sky the sea reflects
//  sun       colour of the sunlight (and of its glint on the water)
//  daylight  how lit the water is
//  hemi, dir intensities of the sky light and the sunlight on the models
const SKY_STATES = [
  { elevation: -18, tint: [0.10, 0.12, 0.24], sun: [0.30, 0.35, 0.50], daylight: 0.12, hemi: 0.15, dir: 0.05 }, // Night
  { elevation: -6,  tint: [0.32, 0.30, 0.48], sun: [0.70, 0.45, 0.45], daylight: 0.35, hemi: 0.30, dir: 0.15 }, // Dusk
  { elevation: 0,   tint: [0.85, 0.62, 0.55], sun: [1.00, 0.55, 0.30], daylight: 0.65, hemi: 0.45, dir: 0.45 }, // Sunset
  { elevation: 8,   tint: [1.00, 0.86, 0.72], sun: [1.00, 0.78, 0.55], daylight: 0.85, hemi: 0.55, dir: 0.70 }, // Golden hour
  { elevation: 20,  tint: [1.00, 1.00, 1.00], sun: [1.00, 0.95, 0.85], daylight: 1.00, hemi: 0.60, dir: 0.80 }, // Day
];
const SKY_UPDATE_MINUTES = 5;


class SceneManager{

  stats;
  prevTime = 0;
  LONGITUDE = window.LONGITUDE; // Somorrostro longitude
  LATITUDE = window.LATITUDE; // Somorrostro latitude
  

  constructor(canvas){
    // Add loading screen
    this.addLoadingScreen();
    
    // Cache
    THREE.Cache.enabled = false;

    //const canvas = document.querySelector('#c');
    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer = renderer;

    const fov = 45;
    const aspect = 2;  // the canvas default
    const near = 0.5;
    const far = 100000;
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.camera = camera;

    // CAMERA CONTROLS
    const controls = new OrbitControls(camera, canvas);
    this.controls = controls;
    // TODO: limit orbit controls
    // Surface
    camera.position.set(5, 3, 5);
    controls.target.set(0, 1, 0);

    controls.update();
    controls.enableDamping = true;
  // controls.autoRotate = true;
  // controls.autoRotateSpeed = 1;

    // STATS
    let stats = new Stats();
    this.stats = stats;
    document.body.appendChild(stats.dom);
    stats.dom.style.right = null;
    stats.dom.style.left = '0px';
    stats.isVisible = false;
    stats.showPanel(false);
    
    






    // SCENE
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color(0x47A0B9);
    this.scene.camera = this.camera;

    // Fog
    scene.fog = new THREE.FogExp2(new THREE.Color(0x47A0B9), 0.02);
    // Fog only below water
    THREE.ShaderChunk.fog_fragment = FogShader.fogFrag;
    THREE.ShaderChunk.fog_pars_fragment = FogShader.fogFragParams;
    THREE.ShaderChunk.fog_vertex = FogShader.fogVertex;
    THREE.ShaderChunk.fog_pars_vertex = FogShader.fogVertexParams;
    // AO shader fix
    THREE.ShaderChunk.aomap_fragment = `
    #ifdef USE_AOMAP
      float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r ) * aoMapIntensity ;
      reflectedLight.directDiffuse *= ambientOcclusion;
      reflectedLight.indirectDiffuse *= ambientOcclusion;
      reflectedLight.directSpecular *= ambientOcclusion;
      reflectedLight.indirectSpecular *= ambientOcclusion;
      #if defined( USE_ENVMAP ) && defined( STANDARD )
        float dotNV = saturate( dot( geometry.normal, geometry.viewDir ) );
        reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
      #endif
    #endif`

    // Skybox
    this.skybox = new SkyboxEntity(scene);
    
    // Coastline
    this.coastLine = new CoastLineEntity(scene);
  

    // Ocean
    this.ocean = new OceanEntity(scene);
    // Ocean reflection of the sky and the coastline, once both are loaded
    // Light of the time of day, then the ocean reflection of the sky and the coastline (tinted by it),
    // once both are loaded; again every few minutes
    Promise.all([this.skybox.loaded, this.coastLine.loaded]).then(() => {
      this.cityLights = new CityLights(this.coastLine.root);
      this.updateSky();
      this.skyInterval = setInterval(() => this.updateSky(), SKY_UPDATE_MINUTES * 60 * 1000);
    });
    // Buoy
    this.somorrostroBuoy = new SomorrostroBuoyEntity(scene);

    // Flag
    // this.flag = new FlagEntity(scene, () => {
    //   this.flag.root.position.y = -1;
    //   this.loadFlagWind();
    // });


    // Mooring
    // this.mooring = new HeavyChainsEntity(scene, () => {
    //   this.mooring.root.position.y = -42.8;
    // });
    
    // Sand
    // this.sand = new SandEntity(scene);
    // this.sand.mesh.position.y = -43;

    // Rosa dels vents
    //his.rosaVents = new RosaVentsEntity(scene);
    //this.rosaVents.root.position.y = 3.5;
    
    // Sea velocity, currents
    this.currents = new CurrentEntity(scene);


    // AIS Vessels
    this.aisVesselsManager = new AISVesselsManager(scene, this.LONGITUDE, this.LATITUDE);



    // SCENE TEXT
    // SURFACE
    // Wind text mesh
    // this.windText = new TextMeshEntity(scene, "", 0.25, 0x000000, () => {
    //   this.windText.textObj.position.y = 3;
    // });
    // Orientation text meshes
    this.Ntext = new TextMeshEntity(scene, "N", 0.5, 0xff0000, () => {
      this.Ntext.textObj.rotation.x = -Math.PI / 2;
      this.Ntext.textObj.position.y = 1;
      this.Ntext.textObj.position.z = -4;
    });
    this.Stext = new TextMeshEntity(scene, "S", 0.5, 0xffffff, () => {
      this.Stext.textObj.rotation.x = -Math.PI / 2;
      this.Stext.textObj.position.y = 1;
      this.Stext.textObj.position.z = 4;
    });



    { // LIGHT
      const skyColor = 0xB1E1FF;  // light blue
      const groundColor = 0x2090b9;  // blue
      const intensity = 0.6;
      const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
      scene.add(light);
      this.skyLight = light;
    }

    { // LIGHT
      const color = 0xFFFFFF;
      const intensity = 0.8;
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(0, 10, 0);
      light.target.position.set(-5, 0, 0);
      scene.add(light);
      scene.add(light.target);
      this.sunLight = light; // Placed where the sun is (see updateSky)
    }


  }



  // ADD LOADING SCREEN
  addLoadingScreen = function(){
    // Create
    let loadDiv = document.createElement("div");
    loadDiv.style.width = '100vw';//document.body.clientWidth + 'px';
    loadDiv.style.height = '100vh';//document.body.clientHeight + 'px';
    // Style
    loadDiv.style.background = 'radial-gradient(rgba(160, 215, 242, 0.95) 0%, rgba(0, 90, 134, 0.95) 100%';
    loadDiv.style.position = 'absolute';
    loadDiv.style.display = 'flex';
    loadDiv.style["flex-direction"] = 'column';
    loadDiv.style["justify-content"] = 'center';
    loadDiv.style['align-items'] = 'center';
    loadDiv.style['transition'] = 'all 1.5s ease-in-out';

    // Create image logo
    let loadingImg = document.createElement("img");
    // The SIO's logo in the browser's language, as the language selector picks it
    const lang = ['es', 'ca', 'en'].find(code => navigator.language.startsWith(code)) || 'en';
    loadingImg.src = `/boiasomorrostro/img/logos/SIO-${lang}-white.png`;
    loadingImg.style['max-width'] = '70vw';
    loadingImg.style['max-height'] = '130px';//'18%';

    // Create progress bar
    let progress = document.createElement('div');
    let progressBar = document.createElement('div');
    progressBar.className = 'progressBarLoadScreen';
    progress.appendChild(progressBar);
    progress.style = `
      margin-top: 20px;
      width: 70vw;
      height: 20px;
      background: rgba(40, 122, 163, 1);
      border: none;
      border-radius: 10px`;
    progressBar.style = `width: 70vw;
      height: 20px;
      background: rgba(11, 85, 122, 1);
      border: none;
      border-radius: 10px`;

    // Who makes it, and the project it builds on (credited in full in the About section)
    let sponsorsImg = document.createElement("div");
    sponsorsImg.innerHTML = `<div style="font-size: 1.1rem; font-weight: 600">ICM-CSIC</div>
      <div style="font-size: 0.8rem; opacity: 0.8">Boia Somorrostro · ICATMAR</div>`;
    sponsorsImg.style.color = 'white';
    sponsorsImg.style['text-align'] = 'center';
    sponsorsImg.style['font-family'] = '"Poppins", sans-serif';
    sponsorsImg.style.bottom = '30px';
    sponsorsImg.style.position = 'absolute';

    // Add to div
    loadDiv.appendChild(loadingImg);
    loadDiv.appendChild(progress);
    loadDiv.appendChild(sponsorsImg);
    // Add to body
    document.body.appendChild(loadDiv);
    // Remove after 5 seconds - guarded in case onLoad's own removal (below)
    // already ran first
    setTimeout(() => {
      if (loadDiv.parentNode === document.body) document.body.removeChild(loadDiv);
    }, 5000);

    // Load manager
    THREE.DefaultLoadingManager.onStart = function (url, itemsLoaded, itemsTotal) {
      console.log('Started loading file: ' + url + '.\nLoaded ' + itemsLoaded + ' of ' + itemsTotal + ' files.');
    };

    THREE.DefaultLoadingManager.onLoad = function () {
      console.log('Loading Complete!');
      if (loadDiv.parentElement != null){
        loadDiv.style.opacity = 0;
        // Guarded in case the 5-second fallback removal (above) already ran first
        setTimeout(() => {
          if (loadDiv.parentNode === document.body) document.body.removeChild(loadDiv);
        }, 1300);
      }
      // Emit event
      window.eventBus.emit('SceneManager_LoadingComplete');
      // TODO: For some reason the files appear to be loaded twice?
    };
    THREE.DefaultLoadingManager.onProgress = function (url, itemsLoaded, itemsTotal) {
      console.log('Loading file: ' + url + '.\nLoaded ' + itemsLoaded + ' of ' + itemsTotal + ' files.');
      progressBar.style.width = (itemsLoaded / itemsTotal * 100) + '%';
    };

    THREE.DefaultLoadingManager.onError = function (url) {
      console.log('There was an error loading ' + url);
    };
  }




  // FLAG WIND
  // Sets the flag from the buoy's latest observation (see DataService.buoy,
  // Assets/Scripts/data/products/DPBuoys.js). Same units/convention as the
  // (currently unused) wind updates in Canvas3D.vue: km/h, and setWindParameters
  // itself flips the "from" bearing WDIR reports into the "blowing toward" one
  // the flag needs.
  loadFlagWind = async function(){
    const buoy = window.DataService.buoy;
    await buoy.ready();
    const row = buoy.latestRow('WSPD');
    if (row == undefined || row.values.WDIR == undefined) {
      return;
    }
    this.flag.showFlag();
    this.flag.setWindParameters('windSpeed', row.values.WSPD * 3.6); // m/s -> km/h
    this.flag.setWindParameters('windDirection', row.values.WDIR);
  }




  // USER INTERACTIONS
  // Reposition camera
  focusOnBuoy = function(){
    this.stopFollowing();
    // Tween camera position
    new TWEEN.Tween(this.camera.position)
      .to({ x: 15, y: 10, z: 15 }, 4000)
      .easing(TWEEN.Easing.Cubic.InOut)
      .start();
    // Tween camera target
    new TWEEN.Tween(this.controls.target)
      .to({ x: 0, y: 1, z: 0 }, 4000)
      .easing(TWEEN.Easing.Cubic.InOut)
      .onUpdate(() => this.controls.update())
      .start();
  }
  focusOnBase = function(){
    // Tween camera position
    new TWEEN.Tween(this.camera.position)
      .to({ x: 6, y: -16, z: 6 }, 4000)
      .start();
    // Tween camera target
    new TWEEN.Tween(this.controls.target)
      .to({ x: 0, y: -19, z: 0 }, 4000)
      .easing(TWEEN.Easing.Cubic.InOut)
      .onUpdate(() => this.controls.update())
      .start();
  }
  faceNorthward = function(){
    this.stopFollowing();
    // Tween camera position to face northward
    let dist = this.camera.position.distanceTo(this.controls.target);
    let newZ = Math.sqrt(dist * dist - Math.pow(this.camera.position.y-this.controls.target.y, 2));

    new TWEEN.Tween(this.camera.position)
      .to({ x: this.controls.target.x, z: newZ }, 4000)
      .easing(TWEEN.Easing.Cubic.InOut)
      .onUpdate(()=>this.controls.update())
      .start();
  }



  // Compass bearing the camera looks at, in degrees (0 north, 90 east). In the scene, north is -z and east +x
  getCameraBearing = function(){
    const target = this.controls.target, position = this.camera.position;
    return (Math.atan2(target.x - position.x, position.z - target.z) * 180 / Math.PI + 360) % 360;
  }

  // Horizontal field of view of the camera, in degrees
  getCameraHorizontalFOV = function(){
    const verticalFOV = this.camera.fov * Math.PI / 180;
    return 2 * Math.atan(Math.tan(verticalFOV / 2) * this.camera.aspect) * 180 / Math.PI;
  }

  // Turns the camera around its target to look at a compass bearing, keeping its distance and height
  faceBearing = function(bearing){
    this.stopFollowing();
    const target = this.controls.target, position = this.camera.position;
    const horizontalDistance = Math.hypot(position.x - target.x, position.z - target.z);
    const start = this.getCameraBearing();
    const turn = ((bearing - start + 540) % 360) - 180; // Shortest way round
    const state = { bearing: start };
    new TWEEN.Tween(state)
      .to({ bearing: start + turn }, 1500)
      .easing(TWEEN.Easing.Cubic.InOut)
      .onUpdate(() => {
        const angle = state.bearing * Math.PI / 180;
        position.x = target.x - horizontalDistance * Math.sin(angle);
        position.z = target.z + horizontalDistance * Math.cos(angle);
        this.controls.update();
      })
      .start();
  }



  // Show/Hide FPS
  showHideFPS = function(){
    let stats = this.stats;
    if (stats.isVisible){
      stats.showPanel(false);
      stats.isVisible = false;
    } else{
      stats.showPanel(0);
      stats.isVisible = true;
    }
  }



  // WINDOW RESIZE (called from Canvas3D.vue)
  windowWasResized = function(){
    if (this.resizeRendererToDisplaySize(this.renderer)) {
      const canvas = this.renderer.domElement;
      this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
      this.camera.updateProjectionMatrix();
    }
  }









  // UPDATE
  update = function(time){
    
    if (this.prevTime == 0) this.prevTime = time; // Initial timestamp
    let dt = (time - this.prevTime) / 1000;
    this.prevTime = time;
    this.stats.update();


    // Ocean updates
    if (this.ocean && this.camera.position.y > -4) { // Limiting the updates by camera position does not improve performance in my PC 
      if (this.ocean.isLoaded) {
        this.ocean.update(dt);

        // Change buoy position
        if (this.somorrostroBuoy !== undefined) {
          if (this.somorrostroBuoy.isLoaded) {
            // Get y position and normal of the wave on that point
            let position = new THREE.Vector3();
            let normal = new THREE.Vector3();
            this.ocean.getNormalAndPositionAt(position, normal);

            if (!isNaN(position.x)){

              // Exponential Moving Average (EMA) for position
              let coef = 0.8; // TODO: SHOULD NOT DEPEND ON FRAMERATE!!
              // dt from 16 to 40
              coef = 0.95 - 0.4 * (1 - dt / 16); // Dependent on frame rate
              
              let somorrostroBuoy = this.somorrostroBuoy;
              somorrostroBuoy.root.position.x = somorrostroBuoy.root.position.x * coef + (1 - coef) * position.x;
              somorrostroBuoy.root.position.y = somorrostroBuoy.root.position.y * coef + (1 - coef) * position.y;
              somorrostroBuoy.root.position.z = somorrostroBuoy.root.position.z * coef + (1 - coef) * position.z;

              // EMA for rotation
              normal.applyAxisAngle(new THREE.Vector3(1, 0, 0), 90 * Math.PI / 180)
              let tempQuat = new THREE.Quaternion();
              tempQuat.setFromUnitVectors(new THREE.Vector3(1, 0, 0), normal.normalize());
              tempQuat.normalize();
              somorrostroBuoy.root.quaternion.slerp(tempQuat, 0.002);

            }
          }
        }
      }
    }



    // Vessels (the patí sails between reports and rides the waves)
    if (this.aisVesselsManager) {
      this.aisVesselsManager.update(dt, this.ocean, this.windDirection);
    }
    // Follow mode (see follow)
    if (this.followed) this.updateFollow();

    // Flag updates
    if (this.flag && this.camera.position.y > 0) {
      if (this.flag.isLoaded && this.flag.root.visible) {
        this.flag.update(time);
      }
    }



    // Current
    if (this.currents) {
      if (this.currents.isLoaded) {
        this.currents.update(dt);
      }
    }




  }





  // FOLLOW A VESSEL
  // Flies the camera behind and above the vessel (by MMSI), then keeps following it
  follow = function(mmsi){
    const vessel = mmsi == undefined ? undefined : this.aisVesselsManager.ships[mmsi];
    if (!vessel?.root) return false;
    this.followed = vessel;
    this.followedMMSI = mmsi;
    this.flight = { camera: this.camera.position.clone(), target: this.controls.target.clone(), start: performance.now() };
    return true;
  }
  stopFollowing = function(){
    this.followed = undefined;
    this.flight = undefined;
  }
  // Where the camera goes for the followed vessel: behind it, further for bigger ships
  followView = function(){
    const root = this.followed.root;
    const distance = Math.max(16, (window.AISManager?.ships[this.followedMMSI]?.length || 0) * 2.5);
    const behind = new THREE.Vector3(-Math.cos(root.rotation.y), 0, Math.sin(root.rotation.y)).multiplyScalar(distance);
    return {
      target: root.position.clone().add(new THREE.Vector3(0, 2, 0)),
      camera: root.position.clone().add(behind).add(new THREE.Vector3(0, distance * 0.4, 0)),
    };
  }
  // Called every frame while following: first the flight there (2 s), then keeping the
  // camera's offset to the vessel, so the user can still orbit around it
  updateFollow = function(){
    // Looked up every frame: the vessel is rebuilt when it gets its proper model (see AISVesselsManager)
    const vessel = this.aisVesselsManager.ships[this.followedMMSI];
    if (!vessel?.root) return this.stopFollowing();
    this.followed = vessel;
    const position = vessel.root.position;
    if (this.flight) {
      const k = Math.min(1, (performance.now() - this.flight.start) / 2000);
      const ease = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const view = this.followView();
      this.camera.position.lerpVectors(this.flight.camera, view.camera, ease);
      this.controls.target.lerpVectors(this.flight.target, view.target, ease);
      if (k == 1) {
        this.flight = undefined;
        this.followedPosition = position.clone();
      }
    } else {
      const delta = position.clone().sub(this.followedPosition);
      this.followedPosition.copy(position);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }
    this.controls.update();
  }

  // PICKING
  // What is under a point of the canvas (pixels from its top left): 'buoy', a vessel's MMSI,
  // or undefined. By screen distance (24 px) rather than by ray, so far, tiny ships can be picked
  pickAt = function(x, y){
    const canvas = this.renderer.domElement;
    const candidates = [['buoy', this.somorrostroBuoy?.root]];
    Object.entries(this.aisVesselsManager.ships).forEach(([mmsi, ship]) => candidates.push([mmsi, ship.root]));
    let best, bestDistance = 24;
    candidates.forEach(([id, root]) => {
      if (!root?.visible) return;
      const screen = root.position.clone().add(new THREE.Vector3(0, 1.5, 0)).project(this.camera);
      if (screen.z > 1) return; // Behind the camera
      const distance = Math.hypot((screen.x + 1) / 2 * canvas.clientWidth - x, (1 - screen.y) / 2 * canvas.clientHeight - y);
      if (distance < bestDistance) [best, bestDistance] = [id, distance];
    });
    return best;
  }



  // SKY BY THE TIME OF DAY
  // Light of the sky, the sun and the sea for the sun's real position at the buoy (now, or the
  // date given; see setSkyTime). The sky panorama is a midday picture, so it is tinted
  updateSky = function(date = this.skyDate || new Date()){
    const { elevation, azimuth } = sunPosition(date, this.LATITUDE, this.LONGITUDE);
    // Interpolate the states around this elevation
    const index = SKY_STATES.findIndex(state => state.elevation >= elevation);
    const upper = SKY_STATES[index === -1 ? SKY_STATES.length - 1 : index];
    const lower = SKY_STATES[Math.max(0, (index === -1 ? SKY_STATES.length : index) - 1)];
    const f = upper === lower ? 0 : Math.min(1, Math.max(0, (elevation - lower.elevation) / (upper.elevation - lower.elevation)));
    const mix = (key) => Array.isArray(lower[key]) ? lower[key].map((v, i) => v + (upper[key][i] - v) * f) : lower[key] + (upper[key] - lower[key]) * f;
    const sky = { tint: mix('tint'), sun: mix('sun'), daylight: mix('daylight'), hemi: mix('hemi'), dir: mix('dir') };

    // Direction towards the sun (x east, y up, z south); below the horizon, kept just above it
    // so its last light still glints on the water
    const rad = Math.PI / 180;
    const height = Math.max(elevation, 3) * rad;
    const sunDirection = new THREE.Vector3(Math.sin(azimuth * rad) * Math.cos(height), Math.sin(height), -Math.cos(azimuth * rad) * Math.cos(height));

    // Sky panorama: its own colours times the tint
    this.skybox.root?.traverse(object => {
      if (!object.material?.color) return;
      object.userData.skyColor ??= object.material.color.clone();
      object.material.color.copy(object.userData.skyColor).multiply(new THREE.Color(...sky.tint));
    });
    this.scene.background = new THREE.Color(0x47A0B9).multiply(new THREE.Color(...sky.tint));
    // Lights on the buoy, the coast and the vessels
    this.skyLight.intensity = sky.hemi;
    this.skyLight.color.setRGB(0.69, 0.88, 1.0).multiply(new THREE.Color(...sky.tint));
    this.sunLight.intensity = sky.dir;
    this.sunLight.color.setRGB(...sky.sun);
    this.sunLight.position.copy(sunDirection).multiplyScalar(100);
    this.sunLight.target.position.set(0, 0, 0);
    // City lights: on from a little after sunset (sun 1º below the horizon) to full at 8º below
    this.cityLights?.setNight(Math.min(1, Math.max(0, (-elevation - 1) / 7)));
    // Sea
    this.ocean.setSky({ sunDirection, sunColor: sky.sun, daylight: sky.daylight, skyTint: sky.tint });
    this.updateOceanReflection();
    this.sky = { date, elevation, azimuth };
  }
  // Shows the sky at another moment (a Date), or back to now with undefined
  setSkyTime = function(date){
    this.skyDate = date;
    if (this.skyInterval) this.updateSky(); // Else the first updateSky, once loaded, uses it
  }



  // OCEAN REFLECTION
  // Renders the sky and the coastline once into a cubemap, which the ocean shader reflects.
  // Everything else (ocean, buoy, vessels...) is hidden during the capture; lights stay on.
  updateOceanReflection = function(){
    const children = this.scene.children;
    const visibility = children.map(child => child.visible);
    children.forEach(child => child.visible = child.isLight || child == this.skybox.root || child == this.coastLine.root);

    const renderTarget = new THREE.WebGLCubeRenderTarget(512);
    const cubeCamera = new THREE.CubeCamera(1, 100000, renderTarget);
    cubeCamera.position.set(0, 1, 0);
    cubeCamera.update(this.renderer, this.scene);

    children.forEach((child, index) => child.visible = visibility[index]);
    this.ocean.setReflectionMap(renderTarget.texture);
    // Captured again with every change of light (see updateSky): free the previous one
    this.reflectionTarget?.dispose();
    this.reflectionTarget = renderTarget;
  }



  // Resize renderer
  resizeRendererToDisplaySize = function (renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }
    return needResize;
  }




  // RENDER
  render = function (time) {

    // Tween update
    if (TWEEN)
      TWEEN.update();

    // if (this.resizeRendererToDisplaySize(this.renderer)) {
    //   const canvas = this.renderer.domElement;
    //   this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    //   this.camera.updateProjectionMatrix();
    // }

    this.update(time);

    this.renderer.render(this.scene, this.camera);

    this.controls.update();

    requestAnimationFrame(this.render.bind(this));
  }


  startRender = function(){
    requestAnimationFrame(this.render.bind(this));
  }









  

}

export default SceneManager;