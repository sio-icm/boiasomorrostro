import * as THREE from 'three';
import { GLTFLoader } from '/boiasomorrostro/lib/three.js/examples/jsm/loaders/GLTFLoader.js';

// Tutorial 3D Tiles Google to Blender
// https://www.youtube.com/watch?v=OzfNCZG-u7I&t=499s&ab_channel=Xuacucreativo
// Google Earth Decoder update: https://flightsim.to/file/39900/gogole-earth-decoder-update
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

      scene.add(root);
      resolve();
    }));
  }
}

export { CoastLineEntity }