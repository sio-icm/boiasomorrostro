import * as THREE from 'three';

// A WAKE OF COLOUR behind one of our vessels in the history mode (see HistoryManager): where it went
// in the last while (TRAIL), as a ribbon on the sea in its colour, a soft glow around a brighter
// core, transparent at its oldest end and brighter towards the vessel, with pulses running along it.
// The ribbon is drawn over the waves (see the vertex shader) and kept wide enough to be seen from
// far away, as the vessels' rings (see OwnMarker)

const SMOOTH = 3; // Points drawn per position (a curve through them)
const MAX_POINTS = 1200;
const HEIGHT = 0.4; // m over the sea
const SCREEN_FRACTION = 0.009; // Core width, as a fraction of the distance to the camera
const MIN_WIDTH = 0.8, MAX_WIDTH = 80; // m
const GLOW = 3;
const HUE_SHIFT = 0.12; // Its oldest end, of a colour this far around the wheel from its own // Glow width / core width

const vertexShader = `
  attribute float side;     // -1, 1: either edge
  attribute float along;    // 0 (oldest) .. 1 (now)
  attribute float toHead;   // m to the vessel along the wake
  attribute vec2 across;    // Unit vector across the wake (x, z)
  uniform float width;
  varying float vSide;
  varying float vAlong;
  varying float vToHead;
  void main() {
    vSide = side;
    vAlong = along;
    vToHead = toHead;
    vec3 p = position + vec3(across.x, 0.0, across.y) * side * width * 0.5;
    // Drawn as if a little nearer the camera, along its own line of sight (so where it is on the
    // screen does not change): over the waves around it, still behind what is in front of it
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    float distance = length(view.xyz);
    view.xyz *= 1.0 - min(0.5, clamp(distance * 0.03, 2.0, 40.0) / distance);
    gl_Position = projectionMatrix * view;
  }`;

const fragmentShader = `
  uniform vec3 color;
  uniform vec3 tailColor;
  uniform float opacity;
  uniform float glow;       // 0: core (sharp edges, whiter towards the vessel), 1: glow (soft)
  uniform float headGap;    // m clear around the vessel itself
  uniform float time;
  varying float vSide;
  varying float vAlong;
  varying float vToHead;
  void main() {
    float edge = abs(vSide);
    float across = mix(1.0 - smoothstep(0.35, 1.0, edge), pow(1.0 - edge, 2.0), glow);
    float age = pow(vAlong, 1.2);
    float head = smoothstep(headGap * 0.5, headGap * 1.5, vToHead);
    float pulse = 0.8 + 0.2 * sin(vToHead * 0.08 - time * 2.5);
    float a = opacity * across * age * head * pulse;
    if (a < 0.003) discard;
    vec3 c = mix(tailColor, color, smoothstep(0.0, 0.8, vAlong));
    c = mix(c, vec3(1.0), (1.0 - glow) * 0.5 * pow(vAlong, 3.0));
    gl_FragColor = vec4(c, a);
  }`;

class Trail {

  constructor(scene, color) {
    this.scene = scene;
    this.geometry = new THREE.BufferGeometry();
    const material = (glow, opacity) => new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthTest: true, depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(color) }, tailColor: { value: new THREE.Color(color).offsetHSL(HUE_SHIFT, 0, 0.05) }, opacity: { value: opacity }, glow: { value: glow },
        width: { value: 1 }, headGap: { value: 2 }, time: { value: 0 } },
    });
    this.glow = new THREE.Mesh(this.geometry, material(1, 0.5));
    this.core = new THREE.Mesh(this.geometry, material(0, 1));
    [this.glow, this.core].forEach((mesh, i) => {
      mesh.frustumCulled = false;
      mesh.renderOrder = 10 + i; // Under the rings (see OwnMarker)
      scene.add(mesh);
    });
  }

  // Where it went: points {t, x, z} up to where it is now, oldest first, and the time they span (ms)
  set(points, from, to) {
    this.key = undefined;
    const n = points.length;
    if (n < 2) return this.geometry.setDrawRange(0, 0);
    // A smooth curve through them, and the time of each point drawn
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p.x, HEIGHT, p.z)), false, 'centripetal');
    const count = Math.min(MAX_POINTS, (n - 1) * SMOOTH + 1);
    const centre = [], times = [];
    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      centre.push(curve.getPoint(u));
      const k = u * (n - 1), j = Math.min(n - 2, Math.floor(k));
      times.push(points[j].t + (points[j + 1].t - points[j].t) * (k - j));
    }
    // Two vertices across each point
    const position = new Float32Array(count * 6), across = new Float32Array(count * 4);
    const side = new Float32Array(count * 2), along = new Float32Array(count * 2), toHead = new Float32Array(count * 2);
    let dx = 1, dz = 0, distance = 0;
    for (let i = count - 1; i >= 0; i--) {
      const a = centre[Math.max(0, i - 1)], b = centre[Math.min(count - 1, i + 1)];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length > 1e-3) { dx = (b.x - a.x) / length; dz = (b.z - a.z) / length; }
      if (i < count - 1) distance += Math.hypot(centre[i + 1].x - centre[i].x, centre[i + 1].z - centre[i].z);
      for (let s = 0; s < 2; s++) {
        const v = i * 2 + s;
        position.set([centre[i].x, centre[i].y, centre[i].z], v * 3);
        across.set([-dz, dx], v * 2);
        side[v] = s ? 1 : -1;
        along[v] = THREE.MathUtils.clamp((times[i] - from) / (to - from), 0, 1);
        toHead[v] = distance;
      }
    }
    const index = [];
    for (let i = 0; i < count - 1; i++) {
      const v = i * 2;
      index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('across', new THREE.BufferAttribute(across, 2));
    g.setAttribute('side', new THREE.BufferAttribute(side, 1));
    g.setAttribute('along', new THREE.BufferAttribute(along, 1));
    g.setAttribute('toHead', new THREE.BufferAttribute(toHead, 1));
    g.setIndex(index);
    g.setDrawRange(0, Infinity);
  }

  // Every frame: as wide as it is seen from the camera, clear of the vessel itself (its length, m)
  update(position, camera, length = 3) {
    const distance = camera ? camera.position.distanceTo(position) : 100;
    const width = THREE.MathUtils.clamp(distance * SCREEN_FRACTION, MIN_WIDTH, MAX_WIDTH);
    const time = performance.now() / 1000;
    [[this.core, width], [this.glow, width * GLOW]].forEach(([mesh, w]) => {
      mesh.material.uniforms.width.value = w;
      mesh.material.uniforms.headGap.value = length * 1.5;
      mesh.material.uniforms.time.value = time;
    });
  }

  remove() {
    [this.glow, this.core].forEach(mesh => {
      this.scene.remove(mesh);
      mesh.material.dispose();
    });
    this.geometry.dispose();
  }
}

export { Trail };
