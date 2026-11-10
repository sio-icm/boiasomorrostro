import * as THREE from 'three';
import { GLTFLoader } from '/boiasomorrostro/lib/three.js/examples/jsm/loaders/GLTFLoader.js';
import { BuoyLight } from '/boiasomorrostro/Assets/SomorrostroBuoy/BuoyLight.js';

class SomorrostroBuoyEntity {

  isLoaded = false;

  constructor(scene){
    // https://www.youtube.com/watch?v=6LA8vEB47Nk&ab_channel=DirkTeucher
    const gltfLoader = new GLTFLoader();
    gltfLoader.load('/boiasomorrostro/Assets/SomorrostroBuoy/SomorrostroBuoy.glb', (gltf) => {
      // GLTF scene
      const root = gltf.scene;

      // Mesh
      let buoyMesh = root.children[0];

      // Fix material
      // AO
      buoyMesh.geometry.attributes.uv2 = buoyMesh.geometry.attributes.uv;
      const aoTexture = new THREE.TextureLoader().load('/boiasomorrostro/Assets/SomorrostroBuoy/aoMap.jpg');
      aoTexture.flipY = false;
      buoyMesh.material.aoMap = aoTexture;
      buoyMesh.material.aoMapIntensity = 1;
      // Normal map
      buoyMesh.material.normalScale.x = -1; // Normal map fix
      // Metalness
      buoyMesh.material.metalness = 0; // No metallic (needs environment map)
      

      // Fix frustrum culling
      buoyMesh.frustumCulled = false;
      // Scene direction fix
      const angleFix = 90;

      root.rotation.y = angleFix * Math.PI / 180;

      this.root = root;
      
      buoyMesh.geometry.attributes.uv2 = buoyMesh.geometry.attributes.uv;
      buoyMesh.translateY(-0.5);


      

      // Its lantern, flashing at night
      this.light = new BuoyLight(root);

      scene.add(root);
      this.isLoaded = true;

    });
  }
}

export { SomorrostroBuoyEntity }