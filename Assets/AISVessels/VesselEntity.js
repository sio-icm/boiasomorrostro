import * as THREE from 'three';
import { GLTFLoader } from '/boiasomorrostro/lib/three.js/examples/jsm/loaders/GLTFLoader.js';
import { MovingVessel } from './MovingVessel.js';

// An AIS vessel with a model, which moves as every vessel (see MovingVessel). The default model
// is a small motor boat; the subclasses are the bigger ships. LONGITUDE and LATITUDE (the buoy's)
// are set by AISVesselsManager
class VesselEntity extends MovingVessel {

  isLoaded = false;
  gltfURL = '/boiasomorrostro/Assets/AISVessels/Objects/Cruiser.glb'; // Default gltf URL

  // shipType: https://api.vtexplorer.com/docs/ref-aistypes.html
  constructor(scene, shipInfo, onload, gltfURL) {
    super();
    // gltfURL    
    this.gltfURL = gltfURL || this.gltfURL; // Use provided URL or default
    // Load
    this.load(scene, shipInfo, onload);
  }

  // Each model is downloaded and parsed once (a promise per URL), then cloned for every ship
  // that uses it: there can be dozens of ships, mostly with the same model
  static models = {};

  // Default load function
  load = (scene, shipInfo, onload) => {
    // TODO: use shipType to load different models
    if (VesselEntity.models[this.gltfURL] == undefined) {
      VesselEntity.models[this.gltfURL] = new Promise(resolve => new GLTFLoader(new THREE.LoadingManager()).load(this.gltfURL, resolve));
    }
    VesselEntity.models[this.gltfURL].then(gltf => {
      if (this.removed) return; // Taken out of the scene while loading (see AISVesselsManager.remove)
      this.isLoaded = true;
      this.addToScene({ ...gltf, scene: gltf.scene.clone(true) }, scene, shipInfo, onload);
    });
  }


  // Add object to scene
  addToScene = (obj, scene, shipInfo, onload) => {
    console.log("⛵ AIS Vessel (Default) added to scene");
    // Scene
    this.root = obj.scene;
    this.setShipDimensions(shipInfo.length, shipInfo.beam);

    scene.add(this.root);
    if (onload)
      onload();
  }




  // The default model is 11 m long: scaled to the ship's length when known, within reason
  setShipDimensions = (length, beam) => {
    if (!this.isLoaded || !(length > 0)) return;
    this.root.scale.setScalar(Math.min(4, Math.max(0.5, length / 11)));
  }

  update = (dt, ocean) => {
    this.updateMotion(dt, ocean);
  }




  getRandomColor = () => {
    // Generate random HSL values with controlled saturation and lightness
    const hue = Math.random();
    const saturation = Math.random() * 0.5 + 0.5; // Saturation between 0.5 and 1
    const lightness = Math.random() * 0.5 + 0.3; // Lightness between 0.3 and 0.8

    const color = new THREE.Color();
    color.setHSL(hue, saturation, lightness);

    return color;
  }
}



// TANKER
class TankerVesselEntity extends VesselEntity {

  constructor(scene, shipInfo, onload) {
    // gltf URL
    let gltfURL = '/boiasomorrostro/Assets/AISVessels/Objects/TankerNormXY.glb';
    super(scene, shipInfo, onload, gltfURL);
  }

  // Load function
  addToScene = (obj, scene, shipInfo, onload) => {
    console.log("🚢 AIS Tanker added to scene");
    // Scene
    this.root = obj.scene;

    // Default tanker dimensions
    let length = shipInfo.length;
    let beam = shipInfo.beam;
    if (length < 0 || beam < 0) {
      length = 160;
      beam = 25;
    }

    // Set ship dimensions
    this.setShipDimensions(length, beam);


    scene.add(this.root);
    if (onload)
      onload();
  }



  setShipDimensions = (length, beam) => {
    if (!this.isLoaded)
      return;
    // Set ship dimensions
    this.root.scale.set(length, 1, beam);
  }
}





// CARGO
class CargoVesselEntity extends VesselEntity {

  constructor(scene, shipInfo, onload) {
    // gltf URL
    let gltfURL = '/boiasomorrostro/Assets/AISVessels/Objects/CargoNormXY_BridgeNormY.glb';
    super(scene, shipInfo, onload, gltfURL);
  }

  // Load function
  addToScene = (obj, scene, shipInfo, onload) => {
    console.log("🚢 AIS Cargo added to scene");
    // Scene
    this.root = obj.scene;

    // Apply scale
    // Default Vessel dimensions
    let length = shipInfo.length;
    let beam = shipInfo.beam;
    if (length < 0 || beam < 0) {
      length = 250;
      beam = 50;
    }

    // Set ship dimensions
    this.setShipDimensions(length, beam);

    // // Create containers
    // ONLY WHEN USER IS VERY CLOSE? GENERATE AUTOMATICALLY CONTAINERS
    // const offsetX = 13; // Offset for X position
    // const offsetY = 15.58; // Offset for Y position
    // const offsetZ = 0; // Offset for Z position
    // // Calculate number of available containers and build matrix
    // const containerLength = 6; // Length of each container
    // const containerWidth = 2.5; // Width of each container
    // const containerHeight = 2.6; // Height of each container

    // const numInBeam = Math.floor(beam / containerWidth); // Number of containers in beam
    // const numInLength = Math.floor(length * 0.7 / containerLength); // Number of containers in length

    // // Build matrix of containers
    // let maxPile = Math.round(Math.max(length / 35, 3));
    // const containerMatrix = [];
    // for (let i = 0; i < numInLength; i++) {
    //   const row = [];
    //   for (let j = 0; j < numInBeam; j++) {
    //     let numContainersPiled = Math.round(maxPile * Math.random()); // Number of containers piled in this position
    //     row.push(numContainersPiled);
    //     for (let k = 0; k < numContainersPiled; k++) {
    //       // Create containers...
    //       const containerGeometry = new THREE.BoxGeometry(containerLength, containerHeight, containerWidth);
    //       const containerMaterial = new THREE.MeshStandardMaterial({ color: this.getRandomColor() });
    //       const container = new THREE.Mesh(containerGeometry, containerMaterial);
    //       container.position.set((i - numInLength / 2) * containerLength + this.offsetX + length / 2, k * containerHeight + this.offsetY + containerHeight / 2, (j - numInBeam / 2) * containerWidth + containerWidth / 2 + this.offsetZ);
    //       //row.push(container);
    //       this.root.add(container); // Add to root object
    //     }
    //   }
    //   containerMatrix.push(row);
    // }



    scene.add(this.root);
    if (onload)
      onload();

  }


  // Set ship dimensions
  setShipDimensions = (length, beam) => {
    if (!this.isLoaded)
      return;
    // Apply XY scale to Cargo
    this.root.getObjectByName('Cargo').scale.set(length, 1, beam);
    // Apply Y scale to Bridge
    this.root.getObjectByName('Bridge').scale.set(1, 1, beam / 2);
  }


}




// CRUISE BIG
class CruiseBigEntity extends VesselEntity {
  constructor(scene, shipInfo, onload) {
    // gltf URL
    let gltfURL = '/boiasomorrostro/Assets/AISVessels/Objects/CruiseBigNormXY_Norm2Z.glb';
    super(scene, shipInfo, onload, gltfURL);
  }

  // Load function
  addToScene = (obj, scene, shipInfo, onload) => {
    console.log("⛴️ AIS Ferry/Cruise added to scene");
    // Scene
    this.root = obj.scene;

    // Apply scale
    // Default Vessel dimensions
    let length = shipInfo.length;
    let beam = shipInfo.beam;
    if (length < 0 || beam < 0) {
      length = 254;
      beam = 50;
    }

    // Set ship dimensions
    this.setShipDimensions(length, beam);

    scene.add(this.root);
    if (onload)
      onload();
  }

  // Set ship dimensions
  setShipDimensions = (length, beam) => {
    if (!this.isLoaded)
      return;

    // Calculate height (air draught/draft)
    // Biggest cruise: 315m length, 70 air draft
    // Mid-size cruise: 228m length, 40 air draft
    let factorLength = (length - 228) / (315 - 228);
    let airDraft = (70 - 40) * factorLength + 40; // 40m to 70m
    // Must multiply the air draft (height) by 2 because of the 3D model
    this.root.scale.set(length, airDraft * 2, beam);
  }
}

export { VesselEntity, TankerVesselEntity, CargoVesselEntity, CruiseBigEntity }