import * as THREE from 'three';
import { GLTFLoader } from '/boiasomorrostro/lib/three.js/examples/jsm/loaders/GLTFLoader.js';
import { portAreaGLSL } from '/boiasomorrostro/Assets/Terrain/PortGround/PortGroundEntity.js';

// Tutorial 3D Tiles Google to Blender
// https://www.youtube.com/watch?v=OzfNCZG-u7I&t=499s&ab_channel=Xuacucreativo
// Google Earth Decoder update: https://flightsim.to/file/39900/gogole-earth-decoder-update

// THE PHOTOGRAPHED SEA, SEEN UP CLOSE
// The far, coarse tiles (kilometres wide, like the port's) carry the sea as photographed: flat,
// and metres above the real sea level (in the port, +7 m). From afar it reads fine as the coast,
// but up close (following a ship into the port) it covers the 3D sea and the hulls, and the land
// floats over the water like a plate. So, only near the camera:
// - the photo's water (dark blue or teal, low down) is cut out, and the 3D sea shows;
// - each coarse tile goes down until its photographed water lies just above the sea.
// Between NEAR and FAR both fade in, the cut-out dithered so it doesn't pop
const NEAR = 1500, FAR = 3000; // m from the camera
const WATER_MAX_HEIGHT = 12; // m: the photographed water is only looked for under it
const COARSE_RADIUS = 2000; // m: tiles this big are the coarse ones
const COARSE_MAX_DISTANCE = 15000; // m from the buoy: further, the Earth's curvature already sinks them
const WATER_LEVEL = 1; // m: where the photographed water of a coarse tile is left

function photographedSeaShader(drop) {
  return shader => {
    shader.uniforms.u_coastDrop = { value: drop };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float u_coastDrop;
        varying float vCoastHeight;
        varying float vCoastNear;
        varying vec2 vCoastXZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 coastWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vCoastHeight = coastWorld.y;
        vCoastNear = 1.0 - smoothstep(${NEAR.toFixed(1)}, ${FAR.toFixed(1)}, distance(cameraPosition.xz, coastWorld.xz));
        vCoastXZ = coastWorld.xz;
        // Down in world metres (the tiles hang from scaled nodes)
        transformed.y -= u_coastDrop * vCoastNear / length(modelMatrix[1].xyz);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vCoastHeight;
        varying float vCoastNear;
        varying vec2 vCoastXZ;
        ${portAreaGLSL()}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // The port is the orthophoto's (see PortGroundEntity)
        if (inPortArea(vCoastXZ)) discard;
        if (vCoastHeight < ${WATER_MAX_HEIGHT.toFixed(1)}) {
          vec3 c = diffuseColor.rgb; // Linear colour of the photo
          // Water: dark, bluer than red, and blue at least close to green (teal); not grey, not vegetation
          bool water = c.b > c.r + 0.03 && c.b > c.g * 0.75 && max(c.g, c.b) < 0.45;
          float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (water && dither < vCoastNear) discard;
        }`);
  };
}

// How much a coarse tile goes down near the camera: from its photographed water, the height most
// repeated among its vertices (the flat water and quays), to WATER_LEVEL. 0 for the detailed
// tiles: their most repeated height is the real ground of the city
function coarseTileDrop(mesh) {
  const geometry = mesh.geometry;
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
  if (sphere.radius < COARSE_RADIUS || Math.hypot(sphere.center.x, sphere.center.z) > COARSE_MAX_DISTANCE) return 0;
  const bins = {};
  const vertex = new THREE.Vector3();
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const bin = Math.round(vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).y * 2) / 2;
    if (Math.abs(bin) < 20) bins[bin] = (bins[bin] || 0) + 1;
  }
  let level, best = 0;
  Object.keys(bins).forEach(bin => {
    const count = bins[bin] + (bins[+bin - 0.5] || 0) + (bins[+bin + 0.5] || 0);
    if (count > best) [level, best] = [+bin, count];
  });
  return level > WATER_LEVEL ? level - WATER_LEVEL : 0;
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

      // The photographed sea, seen up close (see above)
      root.updateMatrixWorld(true);
      root.traverse(object => {
        if (!object.isMesh) return;
        const drop = coarseTileDrop(object);
        object.material.onBeforeCompile = photographedSeaShader(drop);
        object.material.customProgramCacheKey = () => 'coast' + drop;
        // Lowered near the camera: the box must reach down that far, or it would be culled
        if (drop > 0) object.frustumCulled = false;
      });

      scene.add(root);
      resolve();
    }));
  }
}

export { CoastLineEntity }
