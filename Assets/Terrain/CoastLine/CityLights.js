import * as THREE from 'three';

// Lights of the city at night: thousands of small glowing points on the coastline model, on its
// vertices above the ground (streets, buildings), mostly warm. They hang from the coastline, so
// they also show in the sea's reflection (see SceneManager.updateOceanReflection). Their
// brightness follows the sky (see setNight).

const COUNT = 12000;
const MIN_HEIGHT = 1.5; // m above the sea: not on the beach or the water
// [share, colour]: street lamps and homes, white lights, a few cold ones
const COLORS = [[0.7, [1.0, 0.6, 0.22]], [0.22, [1.0, 0.85, 0.6]], [0.08, [0.75, 0.85, 1.0]]];

// A soft round dot, drawn once
function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

class CityLights {

  // coastRoot: the loaded coastline (see CoastLineEntity)
  constructor(coastRoot) {
    coastRoot.updateMatrixWorld(true);
    // Candidate spots: every vertex above the ground, in the coastline's own space
    const toCoast = new THREE.Matrix4().copy(coastRoot.matrixWorld).invert();
    const candidates = [];
    const vertex = new THREE.Vector3();
    coastRoot.traverse(object => {
      const positions = object.isMesh && object.geometry.attributes.position;
      if (!positions) return;
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        if (vertex.y > MIN_HEIGHT) candidates.push(vertex.clone().applyMatrix4(toCoast));
      }
    });

    const count = Math.min(COUNT, candidates.length);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const spot = candidates[Math.floor(Math.random() * candidates.length)];
      positions.set([spot.x, spot.y + 0.5, spot.z], i * 3);
      let pick = Math.random(), color = COLORS[0][1];
      for (const [share, rgb] of COLORS) {
        if ((pick -= share) <= 0) { color = rgb; break; }
      }
      const brightness = 0.6 + 0.4 * Math.random(); // Not all equally bright
      colors.set(color.map(c => c * brightness), i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.PointsMaterial({
      size: 3.5, sizeAttenuation: false, // In pixels: they stay visible from afar
      map: dotTexture(), vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.visible = false;
    coastRoot.add(this.points);
  }

  // 0 by day, 1 at night
  setNight(night) {
    this.material.opacity = night;
    this.points.visible = night > 0.01;
  }
}

export { CityLights };
