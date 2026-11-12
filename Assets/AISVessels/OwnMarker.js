import * as THREE from 'three';

// OUR EQUIPMENT IN THE 3D SCENE (see ownAssets.js): a blue ring around our vehicles, pulsing gently,
// so they are found among the other ships. It always faces the camera (a sprite): flat on the
// water it would be a thin line seen from the buoy. A BlueBoat (1.2 m) is barely a dot from afar,
// so the ring keeps a least size on screen: a fraction of the distance to the camera.
// Drawn over the waves (no depth test), as a map mark rather than a thing on the sea.

const COLOR = 0x4f7bff; // The SIO's blue, lighter to show on the dark sea
const AROUND = 1.1; // Least radius, of the vehicle's length
const SCREEN_FRACTION = 0.04; // Of the distance to the camera
const PULSE = 2; // s
// Close up the ring is not needed (and would hide the vehicle): it fades in from NEAR to FAR m
const NEAR = 12, FAR = 40;

// A ring, drawn once
let ringTexture;
function texture() {
  if (ringTexture) return ringTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  context.strokeStyle = 'white';
  context.lineWidth = 12;
  context.beginPath();
  context.arc(64, 64, 56, 0, Math.PI * 2);
  context.stroke();
  ringTexture = new THREE.CanvasTexture(canvas);
  ringTexture.colorSpace = THREE.SRGBColorSpace;
  return ringTexture;
}

class OwnMarker {

  constructor(scene) {
    this.scene = scene;
    this.ring = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture(), color: COLOR, transparent: true, depthTest: false, depthWrite: false, fog: false,
    }));
    this.ring.renderOrder = 20;
    scene.add(this.ring);
  }

  // Every frame: around the vehicle (its root, length in m), sized for the camera
  update(root, camera, length = 3) {
    if (!root) return;
    this.ring.position.set(root.position.x, root.position.y + 0.3, root.position.z);
    const distance = camera ? camera.position.distanceTo(root.position) : 0;
    const radius = Math.max(length * AROUND, distance * SCREEN_FRACTION);
    const pulse = Math.sin((performance.now() / 1000 % PULSE) / PULSE * Math.PI); // 0, 1, 0
    this.ring.scale.setScalar(2 * radius * (1 + 0.12 * pulse));
    const fade = THREE.MathUtils.clamp((distance - NEAR) / (FAR - NEAR), 0, 1);
    this.ring.visible = fade > 0;
    this.ring.material.opacity = (0.95 - 0.35 * pulse) * fade;
  }

  remove() {
    this.scene.remove(this.ring);
    this.ring.material.dispose();
  }
}

export { OwnMarker };
