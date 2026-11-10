import * as THREE from 'three';
import { GLTFLoader } from '/boiasomorrostro/lib/three.js/examples/jsm/loaders/GLTFLoader.js';

class SkyboxEntity {

  constructor(scene){
    const gltfLoader = new GLTFLoader();
    // Resolves once the skybox is in the scene (see SceneManager.updateOceanReflection)
    this.loaded = new Promise(resolve => gltfLoader.load('/boiasomorrostro/Assets/Skybox/skybox.glb', (gltf) => { // '../Assets/Skybox/skybox.glb'
      // GLTF scene
      const root = gltf.scene;
      this.root = root;
      // Scale: a dome of 95 km, inside the camera's 100 km range (see SceneManager), and kept
      // around the camera (see follow), so no part of it is ever cut off by that range
      root.scale.multiplyScalar(950);
      // Scene direction fix
      const angleFix = 90;
      root.rotation.y = angleFix * Math.PI / 180;
      root.position.y = -1;

      scene.add(root);
      resolve();
    }));

    scene.background = new THREE.Color(0x47A0B9);

  }

  // Centres the dome on a point (the camera): the sky is infinitely far, it never comes closer.
  // Else, far from the buoy, the side of the dome ahead goes beyond the camera's range and is cut
  // off, and the background shows through as a dark triangle on the horizon
  follow(position) {
    if (!this.root) return;
    this.root.position.x = position.x;
    this.root.position.z = position.z;
  }
  
}

export {SkyboxEntity}