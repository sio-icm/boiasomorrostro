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
      // Scale
      root.scale.multiplyScalar(1000);
      // Scene direction fix
      const angleFix = 90;
      root.rotation.y = angleFix * Math.PI / 180;
      root.position.y = -1;

      scene.add(root);
      resolve();
    }));

    scene.background = new THREE.Color(0x47A0B9);

  }
  
}

export {SkyboxEntity}