// THE WATER SHELTERED BY THE PORTS' BREAKWATERS, where the 3D sea is calm: the waves fade out there
// (see OceanProjectedGridShader) and so do the boats' rolling on them (see OceanEntity). Each
// harbour, an outline (latitude, longitude) along its breakwaters and entrances; landwards it may
// reach over the land, where the sea is hidden anyway. The fading is gradual over some metres (blur:
// a ring of samples around each point), so the entrances don't show a line; less in the Port
// Olímpic, small and its outline close around its basin. Outlines from the ICGC orthophoto.

const HARBOURS = {
  // The port of Barcelona with the Port Vell, inside the Dic de l'Est
  barcelona: { blur: 60, outline: [
    [41.38285, 2.17155], [41.38285, 2.18900], [41.36992, 2.19045], [41.35835, 2.18536], [41.35808, 2.18318],
    [41.35485, 2.18100], [41.34462, 2.17591], [41.33654, 2.17336], [41.32846, 2.17155], [41.31769, 2.17264],
    [41.31500, 2.16573], [41.31500, 2.15264], [41.33115, 2.14900], [41.34731, 2.14318], [41.36077, 2.15773],
  ] },
  // The Port Olímpic, as its ground (see PortGroundEntity)
  olimpic: { blur: 20, outline: [
    [41.387242, 2.198359], [41.388385, 2.200234], [41.387330, 2.202578], [41.387740, 2.202969],
    [41.388180, 2.203516], [41.387418, 2.203672], [41.385719, 2.202891], [41.384313, 2.201562],
    [41.383844, 2.200781], [41.383375, 2.200625], [41.383375, 2.198906], [41.383727, 2.198828],
    [41.384078, 2.199375], [41.385133, 2.200000], [41.385719, 2.199375], [41.386539, 2.198281],
  ] },
};
// blur: m, radius of the ring of samples around each point
const SAMPLES = 8; // On the ring, plus the point itself

// Scene metres (x east, z south, from the buoy), as the ships (see MovingVessel)
function toScene([latitude, longitude]) {
  const R = 6371000;
  return {
    x: (longitude - window.LONGITUDE) * Math.PI / 180 * R * Math.cos(window.LATITUDE * Math.PI / 180),
    z: -(latitude - window.LATITUDE) * Math.PI / 180 * R,
  };
}

// The outlines in scene metres, with their boxes. When first needed: the buoy's position
// (window.LATITUDE...) is set by main.js after the modules load
let outlines;
function sceneOutlines() {
  outlines ??= Object.entries(HARBOURS).map(([name, { blur, outline }]) => {
    const points = outline.map(toScene);
    return {
      name, points, blur,
      west: Math.min(...points.map(p => p.x)) - blur, east: Math.max(...points.map(p => p.x)) + blur,
      north: Math.min(...points.map(p => p.z)) - blur, south: Math.max(...points.map(p => p.z)) + blur,
    };
  });
  return outlines;
}

// Whether a point is inside an outline (crossing its sides from the point, an odd number of times)
function inside(points, x, z) {
  let result = false;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    if ((a.z > z) !== (b.z > z) && x < a.x + (z - a.z) * (b.x - a.x) / (b.z - a.z)) result = !result;
  });
  return result;
}

// How sheltered a point (scene x, z) is: 0 at open sea to 1 well inside a harbour
function shelter(x, z) {
  const harbour = sceneOutlines().find(h => x > h.west && x < h.east && z > h.north && z < h.south);
  if (!harbour) return 0;
  let count = inside(harbour.points, x, z) ? 1 : 0;
  for (let i = 0; i < SAMPLES; i++) {
    const angle = i / SAMPLES * Math.PI * 2;
    if (inside(harbour.points, x + harbour.blur * Math.cos(angle), z + harbour.blur * Math.sin(angle))) count++;
  }
  return count / (SAMPLES + 1);
}

// The same in GLSL: float shelter(vec2 p), p the scene x, z
function shelterGLSL() {
  const f = n => n.toFixed(1);
  const harbours = sceneOutlines().map(h => `
  bool inHarbour_${h.name}(vec2 p) {
    bool result = false;
    ${h.points.map((a, i) => {
      const b = h.points[(i + 1) % h.points.length];
      if (a.z === b.z) return '';
      return `if ((${f(a.z)} > p.y) != (${f(b.z)} > p.y) && p.x < ${f(a.x)} + (p.y - ${f(a.z)}) * ${(b.x - a.x) / (b.z - a.z)}) result = !result;`;
    }).filter(Boolean).join('\n    ')}
    return result;
  }`).join('\n');
  const sample = (h, p) => `(inHarbour_${h.name}(${p}) ? 1.0 : 0.0)`;
  return `${harbours}
  float shelter(vec2 p) {
    ${sceneOutlines().map(h => `if (p.x > ${f(h.west)} && p.x < ${f(h.east)} && p.y > ${f(h.north)} && p.y < ${f(h.south)}) {
      float count = ${sample(h, 'p')};
      for (int i = 0; i < ${SAMPLES}; i++) {
        float angle = float(i) / ${SAMPLES.toFixed(1)} * 6.2831853;
        count += ${sample(h, `p + ${f(h.blur)} * vec2(cos(angle), sin(angle))`)};
      }
      return count / ${(SAMPLES + 1).toFixed(1)};
    }`).join('\n    ')}
    return 0.0;
  }`;
}

export { shelter, shelterGLSL };
