import * as THREE from 'three';
import { GLTFLoader } from '/boiasomorrostro/lib/three.js/examples/jsm/loaders/GLTFLoader.js';

// Tutorial 3D Tiles Google to Blender
// https://www.youtube.com/watch?v=OzfNCZG-u7I&t=499s&ab_channel=Xuacucreativo
// Google Earth Decoder update: https://flightsim.to/file/39900/gogole-earth-decoder-update

// Height (m) under which the photographed water is cut out
const WATER_MAX_HEIGHT = 12;

function cutOutPhotographedSea(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vCoastHeight;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoastHeight = (modelMatrix * vec4(transformed, 1.0)).y;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vCoastHeight;')
    .replace('#include <map_fragment>', `#include <map_fragment>
      if (vCoastHeight < ${WATER_MAX_HEIGHT.toFixed(1)}) {
        vec3 c = diffuseColor.rgb; // Linear colour of the photo
        // Water: dark, bluer than red, and blue at least close to green (teal); not grey, not vegetation
        if (c.b > c.r + 0.03 && c.b > c.g * 0.75 && max(c.g, c.b) < 0.45) discard;
      }`);
}

class CoastLineEntity {

  constructor(scene) {
    const manager = new THREE.LoadingManager(); // Empty manager
    const gltfLoader = new GLTFLoader(manager);
    // Resolves once the coastline is in the scene (see SceneManager.updateOceanReflection)
    this.loaded = new Promise(resolve => gltfLoader.load('/boiasomorrostro/Assets/Terrain/CoastLine/CoastLine.glb', (gltf) => { // '../Assets/Skybox/skybox.glb'
      // GLTF scene
      const root = gltf.scene;
      this.root = root;
      // Position correction
      this.root.position.set(160, 0, -210);
      // Scale
      //root.scale.multiplyScalar(0.1);
      // Scene direction fix
      const angleFix = 90;
      root.rotation.y = angleFix * Math.PI / 180;
      //root.position.y = -1;

      // The far, coarse tiles carry the sea as photographed, flat, a few metres above the
      // real sea level (in the port, +5 m): it would cover the 3D sea and the hulls of the
      // ships. Low down, the photo's water (dark blue or teal) is cut out, so the 3D sea shows
      root.traverse(object => {
        if (object.isMesh) object.material.onBeforeCompile = cutOutPhotographedSea;
      });

      scene.add(root);
      resolve();
    }));
  }
}

export { CoastLineEntity }