import * as THREE from 'three';
import { LineSegments2 } from '/boiasomorrostro/lib/three.js/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from '/boiasomorrostro/lib/three.js/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from '/boiasomorrostro/lib/three.js/examples/jsm/lines/LineMaterial.js';

// The wind made visible over the sea, like the particles of the map (see Assets/Map/ParticlesLayer.js)
// but in 3D: thin streaks a few metres above the water, flying downwind at the wind's real speed,
// longer the stronger it blows and coloured with the map's wind scale. They live in an area around
// where the camera looks, so they follow it (also when following a boat), and fade in and out.
// Fat lines (LineSegments2): WebGL draws plain lines 1 px wide, lost over the glint of the water

const COUNT = 2200;
const AREA = 300;               // m, side of the square around the camera's target
const HEIGHT = [0.4, 5];        // m above the sea: low, so they read over the water, not the sky
const LIFE = [2.5, 6];          // s
const CALM = 0.5;               // m/s: below, no streaks
const WIDTH = 0.07;             // m

function speedColor(speed) {
  const scale = window.PARTICLES_COLOR_SCALES?.wind;
  if (!scale) return [1, 1, 1];
  let rgb = scale[scale.length - 1][1];
  for (let k = 1; k < scale.length; k++) {
    if (speed <= scale[k][0]) {
      const [s0, c0] = scale[k - 1], [s1, c1] = scale[k];
      rgb = c0.map((c, n) => c + (c1[n] - c) * (speed - s0) / (s1 - s0));
      break;
    }
  }
  // Lighter than on the map: it's air over the water
  return rgb.map(c => (c / 255) * 0.6 + 0.4);
}

class WindStreaks {

  constructor(scene) {
    this.streaks = Array.from({ length: COUNT }, () => ({ position: new THREE.Vector3(), age: 0, life: 1 }));
    this.positions = new Float32Array(COUNT * 2 * 3);
    this.colors = new Float32Array(COUNT * 2 * 3);
    // Set once; then each frame writes into the same buffers (see update)
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(this.positions);
    geometry.setColors(this.colors);
    this.material = new LineMaterial({
      vertexColors: true, worldUnits: true, linewidth: WIDTH,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.lines = new LineSegments2(geometry, this.material);
    this.lines.frustumCulled = false; // Always around the camera
    this.lines.renderOrder = 10; // After the sea, which is transparent too and would paint over them
    this.lines.name = 'WindStreaks';
    scene.add(this.lines);
    this.center = new THREE.Vector3();
    this.streaks.forEach(streak => this.spawn(streak, true));
  }

  // Anywhere in the area at the start; later, a random point, so they don't all come from one edge
  spawn(streak, anyAge) {
    streak.position.set(
      this.center.x + (Math.random() - 0.5) * AREA,
      HEIGHT[0] + Math.random() ** 2 * (HEIGHT[1] - HEIGHT[0]), // More near the water
      this.center.z + (Math.random() - 0.5) * AREA,
    );
    streak.life = LIFE[0] + Math.random() * (LIFE[1] - LIFE[0]);
    streak.age = anyAge ? Math.random() * streak.life : 0;
  }

  // center: where the camera looks; windFrom: degrees; speed: m/s; daylight: 0 night to 1 day;
  // renderer: for the size of the canvas, which fat lines need
  update(dt, center, windFrom, speed, daylight = 1, renderer) {
    if (renderer) renderer.getDrawingBufferSize(this.material.resolution);
    dt = Math.min(dt, 0.1);
    this.center.set(center.x, 0, center.z);
    const visible = windFrom != undefined && speed > CALM;
    this.lines.visible = visible;
    if (!visible) return;

    const toward = (windFrom + 180) * Math.PI / 180;
    const velocity = new THREE.Vector3(Math.sin(toward), 0, -Math.cos(toward)).multiplyScalar(speed); // x east, z south
    const tail = velocity.clone().normalize().multiplyScalar(-Math.min(14, Math.max(1.5, speed * 0.9)));
    const [r, g, b] = speedColor(speed);
    const strength = Math.min(0.75, 0.3 + speed / 12) * (0.35 + 0.65 * daylight);

    this.streaks.forEach((streak, i) => {
      streak.age += dt;
      streak.position.addScaledVector(velocity, dt);
      const dx = streak.position.x - this.center.x, dz = streak.position.z - this.center.z;
      if (streak.age > streak.life || Math.abs(dx) > AREA / 2 || Math.abs(dz) > AREA / 2) this.spawn(streak, false);
      // Fades in and out over its life; the head bright, the tail dark
      const fade = Math.sin(Math.PI * streak.age / streak.life) * strength;
      const p = streak.position, o = i * 6;
      this.positions.set([p.x, p.y, p.z, p.x + tail.x, p.y, p.z + tail.z], o);
      this.colors.set([r * fade, g * fade, b * fade, 0, 0, 0], o);
    });
    const attributes = this.lines.geometry.attributes;
    attributes.instanceStart.data.array.set(this.positions);
    attributes.instanceStart.data.needsUpdate = true;
    attributes.instanceColorStart.data.array.set(this.colors);
    attributes.instanceColorStart.data.needsUpdate = true;
  }
}

export { WindStreaks };
