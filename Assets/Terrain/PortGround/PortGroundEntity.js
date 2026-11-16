import * as THREE from 'three';

// THE PORTS' GROUND, FROM THE ICGC ORTHOPHOTO
// Google's photogrammetry of the ports (CoastLine.glb) is blurry up close: in the port of Barcelona
// its cranes, container stacks and ships come out as loose shards, and in the Port Olímpic its
// pontoons and breakwater as broken bits under the 3D sea. So in each port it is hidden (see
// CoastLineEntity) and replaced by this flat ground at quay height, textured with the ICGC
// orthophoto, its water made transparent so the 3D sea and the ships show. Made by
// tools/orto_port.py, with half-size copies (_small) for phones.
// Orthophoto: Institut Cartogràfic i Geològic de Catalunya (ICGC), CC BY 4.0

// Each port: its orthophoto's box and files (keep in sync with tools/orto_port.py), its quays'
// height above the sea, and where in the box it is port, the rest keeping Google's 3D model:
// - the port of Barcelona: south of an edge (the railway and the Ronda Litoral at the foot of
//   Montjuïc), in pixels of a 928 x 1024 view of the orthophoto, west to east;
// - the Port Olímpic: inside an outline (latitude, longitude) around its basin, pontoons, quays,
//   the low buildings on its north quay and its breakwater, leaving out its towers. Google's
//   model of its quays and promenade lies at sea level and under it: the 3D sea covered them.
const AREAS = [
  {
    name: 'port', south: 41.315, north: 41.3676, west: 2.125, east: 2.1886, quayHeight: 2,
    edgePixels: [[0, 440], [300, 345], [470, 290], [560, 200], [700, 0]],
  },
  {
    name: 'olimpic', south: 41.3830, north: 41.3897, west: 2.1975, east: 2.2045, quayHeight: 1.5,
    outline: [
      [41.387236, 2.198354], [41.388856, 2.199231], [41.389168, 2.200000], [41.389432, 2.200769],
      [41.388136, 2.202262], [41.388160, 2.203000], [41.388184, 2.203523], [41.387416, 2.203677],
      [41.385724, 2.202892], [41.384308, 2.201569], [41.383840, 2.200785], [41.383372, 2.200631],
      [41.383372, 2.198908], [41.383732, 2.198831], [41.384080, 2.199369], [41.385136, 2.200000],
      [41.385724, 2.199369], [41.386540, 2.198277],
    ],
  },
];

// Scene metres (x east, z south, from the buoy) of a latitude and longitude, as the ships (see MovingVessel)
function toScene(latitude, longitude) {
  const R = 6371000;
  return {
    x: (longitude - window.LONGITUDE) * Math.PI / 180 * R * Math.cos(window.LATITUDE * Math.PI / 180),
    z: -(latitude - window.LATITUDE) * Math.PI / 180 * R,
  };
}

// A port's box in scene metres. Computed when first needed: the buoy's position (window.LATITUDE...)
// is set by main.js after the modules load
function areaBox(area) {
  const corner = toScene(area.north, area.west), opposite = toScene(area.south, area.east);
  return { west: corner.x, north: corner.z, east: opposite.x, south: opposite.z };
}

const f = n => n.toFixed(1);

// GLSL: whether a point (scene x, z) is in a port (inPort_<name>), or in any (inPortArea)
function areaGLSL(area) {
  const box = areaBox(area);
  const inBox = `if (p.x < ${f(box.west)} || p.x > ${f(box.east)} || p.y < ${f(box.north)} || p.y > ${f(box.south)}) return false;`;
  if (area.edgePixels) {
    // In the box, and south of the edge
    const { north, south, west, east } = area;
    const edge = area.edgePixels.map(([px, py]) => toScene(north - py / 1024 * (north - south), west + px / 928 * (east - west)));
    return `
  bool inPort_${area.name}(vec2 p) {
    ${inBox}
    float edge = ${f(box.north)}; // East of the edge's last point, the whole width is port
    ${edge.slice(1).map((b, i) => {
      const a = edge[i];
      return `if (p.x <= ${f(b.x)}) edge = mix(${f(a.z)}, ${f(b.z)}, clamp((p.x - ${f(a.x)}) / ${f(b.x - a.x)}, 0.0, 1.0)); else`;
    }).join('\n    ')} {}
    return p.y > edge;
  }`;
  }
  // In the box, and inside the outline (crossing its sides from the point, an odd number of times)
  const points = area.outline.map(([latitude, longitude]) => toScene(latitude, longitude));
  return `
  bool inPort_${area.name}(vec2 p) {
    ${inBox}
    bool inside = false;
    ${points.map((a, i) => {
      const b = points[(i + 1) % points.length];
      if (a.z === b.z) return '';
      return `if ((${f(a.z)} > p.y) != (${f(b.z)} > p.y) && p.x < ${f(a.x)} + (p.y - ${f(a.z)}) * ${(b.x - a.x) / (b.z - a.z)}) inside = !inside;`;
    }).filter(Boolean).join('\n    ')}
    return inside;
  }`;
}

function portAreaGLSL() {
  return AREAS.map(areaGLSL).join('\n') + `
  bool inPortArea(vec2 p) {
    return ${AREAS.map(area => `inPort_${area.name}(p)`).join(' || ')};
  }`;
}

// A phone or a small tablet: a touch screen as the main pointer, and not a big screen
function isPhone() {
  return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
}

class PortGroundEntity {
  constructor(scene) {
    // On phones, the half-size images: the full ones of the port of Barcelona take some 80 MB of
    // graphics memory
    const suffix = isPhone() ? '_small' : '';
    const loader = new THREE.TextureLoader();
    this.meshes = AREAS.map(area => {
      const map = loader.load(`/boiasomorrostro/Assets/Terrain/PortGround/${area.name}${suffix}.jpg`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      const alphaMap = loader.load(`/boiasomorrostro/Assets/Terrain/PortGround/${area.name}_mask${suffix}.png`);

      const material = new THREE.MeshStandardMaterial({ map, alphaMap, alphaTest: 0.5, roughness: 1, metalness: 0 });
      // Only the port: the rest of the box is Google's model
      material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vPortXZ;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPortXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec2 vPortXZ;\n${areaGLSL(area)}`)
          .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>\nif (!inPort_${area.name}(vPortXZ)) discard;`);
      };
      material.customProgramCacheKey = () => 'port-' + area.name;

      const box = areaBox(area);
      const geometry = new THREE.PlaneGeometry(box.east - box.west, box.south - box.north);
      geometry.rotateX(-Math.PI / 2); // The image's top to the north (-z)
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set((box.west + box.east) / 2, area.quayHeight, (box.north + box.south) / 2);
      mesh.name = 'PortGround-' + area.name;
      scene.add(mesh);
      return mesh;
    });
  }
}

export { PortGroundEntity, portAreaGLSL };
