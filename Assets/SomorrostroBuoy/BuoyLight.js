import * as THREE from 'three';

// THE BUOY'S LANTERN, AT NIGHT
// A yellow light that flashes in groups, as the real one: Fl(5)Y 20s, the usual characteristic of
// an oceanographic buoy (an IALA special mark). Five 0.5 s flashes 1 s apart, then dark until the
// 20 s are up. Not confirmed for this buoy: it is not in OpenSeaMap, nor in the news of its
// deployment (see issue #38). The real one is in the Aviso a los Navegantes of the deployment
// (Instituto Hidrográfico de la Marina) and in the Libro de Faros; if it differs, change FLASHES,
// FLASH, GAP and PERIOD.
const FLASHES = 5, FLASH = 0.5, GAP = 1.0, PERIOD = 20; // s
const COLOR = new THREE.Color(1.0, 0.78, 0.25); // Yellow
// The lantern on top of the buoy, in the buoy's own space (see SomorrostroBuoy.glb)
const LANTERN = new THREE.Vector3(0.22, 1.86, -0.12);
// The glow: its size near the buoy (m), and its least size on screen from afar, so it still shows
// as a point of light across the bay (a fraction of the distance)
const GLOW_SIZE = 1.6, GLOW_FAR = 0.035;

// How lit the lantern is (0 to 1) at a time in seconds: soft edges, as a LED behind a lens
function flashAt(seconds) {
  const t = seconds % PERIOD;
  for (let i = 0; i < FLASHES; i++) {
    const start = i * (FLASH + GAP);
    if (t >= start && t < start + FLASH) {
      const into = t - start, edge = 0.08;
      return Math.min(1, into / edge, (FLASH - into) / edge);
    }
  }
  return 0;
}

// A round, soft glow, drawn once
function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.12, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

class BuoyLight {

  night = 0; // 0 by day to 1 at night (see SceneManager.updateSky)

  // buoyRoot: the buoy's model, which the light follows on the waves
  constructor(buoyRoot) {
    // The lit lens
    this.lens = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 16, 8),
      new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, fog: false }),
    );
    this.lens.position.copy(LANTERN);
    // The glow around it
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: COLOR, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.glow.position.copy(LANTERN);
    this.glow.renderOrder = 10; // Over the sea
    this.lens.visible = this.glow.visible = false;
    buoyRoot.add(this.lens, this.glow);
  }

  // Every frame. camera: to keep the glow visible from afar
  update(camera) {
    const level = this.night * flashAt(performance.now() / 1000);
    const on = level > 0.001;
    this.lens.visible = this.glow.visible = on;
    if (!on) return;
    this.lens.material.opacity = level;
    this.glow.material.opacity = level;
    const distance = camera.position.distanceTo(this.glow.getWorldPosition(this.glow.userData.world ||= new THREE.Vector3()));
    const size = Math.max(GLOW_SIZE, distance * GLOW_FAR);
    this.glow.scale.set(size, size, 1);
  }
}

export { BuoyLight };
