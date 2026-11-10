import * as THREE from 'three';

// THE PORT'S GROUND, FROM THE ICGC ORTHOPHOTO
// Google's photogrammetry of the port (CoastLine.glb) is blurry up close, and its cranes, container
// stacks and ships come out as loose shards. So in the port it is hidden (see CoastLineEntity) and
// replaced by this flat ground at quay height, textured with the ICGC orthophoto, its water made
// transparent so the 3D sea and the ships show. Made by tools/orto_port.py, with half-size
// copies (_small) for phones.
// Orthophoto: Institut Cartogràfic i Geològic de Catalunya (ICGC), CC BY 4.0

// The orthophoto's box (keep in sync with tools/orto_port.py)
const SOUTH = 41.315, NORTH = 41.3676, WEST = 2.125, EAST = 2.1886;
const QUAY_HEIGHT = 2; // m above the sea
// Where the port ends to the north-west: the railway and the Ronda Litoral at the foot of Montjuïc,
// in pixels of a 928 x 1024 view of the orthophoto, west to east. Montjuïc and the city beyond it
// keep Google's 3D model
const EDGE_PIXELS = [[0, 440], [300, 345], [470, 290], [560, 200], [700, 0]];

// Scene metres (x east, z south, from the buoy) of a latitude and longitude, as the ships (see MovingVessel)
function toScene(latitude, longitude) {
  const R = 6371000;
  return {
    x: (longitude - window.LONGITUDE) * Math.PI / 180 * R * Math.cos(window.LATITUDE * Math.PI / 180),
    z: -(latitude - window.LATITUDE) * Math.PI / 180 * R,
  };
}

// The box in scene metres. Computed when first needed: the buoy's position (window.LATITUDE...)
// is set by main.js after the modules load
function portBox() {
  const corner = toScene(NORTH, WEST), opposite = toScene(SOUTH, EAST);
  return { west: corner.x, north: corner.z, east: opposite.x, south: opposite.z };
}

// GLSL: whether a point (scene x, z) is in the port. In the box, and south of the edge
function portAreaGLSL() {
  const box = portBox();
  const edge = EDGE_PIXELS.map(([px, py]) => toScene(NORTH - py / 1024 * (NORTH - SOUTH), WEST + px / 928 * (EAST - WEST)));
  const f = n => n.toFixed(1);
  return `
  bool inPortArea(vec2 p) {
    if (p.x < ${f(box.west)} || p.x > ${f(box.east)} || p.y < ${f(box.north)} || p.y > ${f(box.south)}) return false;
    float edge = ${f(box.north)}; // East of the edge's last point, the whole width is port
    ${edge.slice(1).map((b, i) => {
      const a = edge[i];
      return `if (p.x <= ${f(b.x)}) edge = mix(${f(a.z)}, ${f(b.z)}, clamp((p.x - ${f(a.x)}) / ${f(b.x - a.x)}, 0.0, 1.0)); else`;
    }).join('\n    ')} {}
    return p.y > edge;
  }`;
}

// A phone or a small tablet: a touch screen as the main pointer, and not a big screen
function isPhone() {
  return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
}

class PortGroundEntity {
  constructor(scene) {
    // On phones, the half-size images: the full ones take some 80 MB of graphics memory
    const suffix = isPhone() ? '_small' : '';
    const loader = new THREE.TextureLoader();
    const map = loader.load(`/boiasomorrostro/Assets/Terrain/PortGround/port${suffix}.jpg`);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const alphaMap = loader.load(`/boiasomorrostro/Assets/Terrain/PortGround/port_mask${suffix}.png`);

    const material = new THREE.MeshStandardMaterial({ map, alphaMap, alphaTest: 0.5, roughness: 1, metalness: 0 });
    // Only the port: north-west of the edge it is Montjuïc and the city, from Google's model
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPortXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPortXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vPortXZ;\n${portAreaGLSL()}`)
        .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\nif (!inPortArea(vPortXZ)) discard;');
    };

    const box = portBox();
    const geometry = new THREE.PlaneGeometry(box.east - box.west, box.south - box.north);
    geometry.rotateX(-Math.PI / 2); // The image's top to the north (-z)
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set((box.west + box.east) / 2, QUAY_HEIGHT, (box.north + box.south) / 2);
    this.mesh.name = 'PortGround';
    scene.add(this.mesh);
  }
}

export { PortGroundEntity, portAreaGLSL };
