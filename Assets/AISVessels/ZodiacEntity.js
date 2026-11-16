import * as THREE from 'three';
import { MovingVessel } from './MovingVessel.js';

// A rigid inflatable boat (a Zodiac), as the ICM's Pelagia Primer, built here instead of loaded:
// some 6 m long, a red inflatable tube all around but the stern, a grey hull and deck inside it,
// a console with its windscreen in the middle, a seat behind it and an outboard motor at the
// stern. It has a real AIS: its positions come with the other ships' (see ownAssets.js).
// Forward is +X, as the other vessels. It moves as every vessel (see MovingVessel), and pitches
// and rolls with the waves.

const LENGTH = 6;
const BEAM = 2.4;
const TUBE_RADIUS = 0.26;
const TUBE_HEIGHT = 0.24; // m, of the tube's centre above the water
const COLORS = { tube: 0xc8202a, hull: 0x9aa3ab, deck: 0x4a5258, console: 0xf2f2ee, motor: 0x1d2329 };

class ZodiacEntity extends MovingVessel {

  isLoaded = true;
  length = LENGTH;

  constructor(scene, shipInfo, LONGITUDE, LATITUDE) {
    super();
    this.LONGITUDE = LONGITUDE;
    this.LATITUDE = LATITUDE;
    this.root = new THREE.Group();
    this.root.name = 'Zodiac';
    this.hull = new THREE.Group(); // Pitches and rolls; root only moves and turns
    this.root.add(this.hull);

    const material = (color, options) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...options });
    const tubeMaterial = material(COLORS.tube, { roughness: 0.45 });

    // The tube's centre line, seen from above: along both sides, round at the bow, open at the stern
    const half = LENGTH / 2, side = BEAM / 2 - TUBE_RADIUS, stern = -half + 0.15, bow = half - TUBE_RADIUS;
    const outline = [
      [stern, -side], [0.6, -side], [1.7, -side * 0.8], [2.4, -side * 0.42], [bow, 0],
      [2.4, side * 0.42], [1.7, side * 0.8], [0.6, side], [stern, side],
    ];
    const curve = new THREE.CatmullRomCurve3(outline.map(([x, z]) => new THREE.Vector3(x, TUBE_HEIGHT, z)), false, 'centripetal');
    this.hull.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, TUBE_RADIUS, 16), tubeMaterial));
    // The tube's ends at the stern, rounded and a little longer
    [-side, side].forEach(z => {
      const end = new THREE.Mesh(new THREE.CapsuleGeometry(TUBE_RADIUS * 0.92, 0.3, 4, 16), tubeMaterial);
      end.rotation.z = Math.PI / 2;
      end.position.set(stern - 0.1, TUBE_HEIGHT, z);
      this.hull.add(end);
    });

    // The rigid hull under the tube and the deck inside it: the same outline, filled
    const shape = new THREE.Shape(curve.getPoints(40).map(p => new THREE.Vector2(p.x, p.z)));
    const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false }), material(COLORS.hull));
    hull.rotation.x = Math.PI / 2; // The shape's y becomes z (symmetric: no matter which way), extruded down
    hull.position.y = 0.12;
    hull.scale.set(0.97, 0.94, 1);
    const deck = new THREE.Mesh(new THREE.ShapeGeometry(shape), material(COLORS.deck));
    deck.rotation.x = Math.PI / 2;
    deck.position.y = 0.13;
    deck.material.side = THREE.DoubleSide;
    this.hull.add(hull, deck);

    // The console, with its windscreen, and a seat behind it
    const desk = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, 0.75), material(COLORS.console));
    desk.position.set(0.2, 0.13 + 0.425, 0);
    const windscreen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.75),
      material(0x9ec7e0, { transparent: true, opacity: 0.45, side: THREE.DoubleSide, roughness: 0.1 }));
    windscreen.rotation.set(0, -Math.PI / 2, 0.55);
    windscreen.position.set(0.42, 1.12, 0);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.9), material(COLORS.deck, { roughness: 0.8 }));
    seat.position.set(-0.7, 0.13 + 0.25, 0);
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.9), material(COLORS.motor, { roughness: 0.9 }));
    cushion.position.set(-0.7, 0.68, 0);
    this.hull.add(desk, windscreen, seat, cushion);

    // The outboard motor: its cowling over the transom, its leg into the water
    const motor = material(COLORS.motor, { roughness: 0.4 });
    const cowling = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.4), motor);
    cowling.position.set(-half - 0.12, 0.62, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.12), motor);
    leg.position.set(-half - 0.1, 0.05, 0);
    this.hull.add(cowling, leg);

    scene.add(this.root);
    this.setReport(shipInfo);
  }

  update(dt, ocean) {
    this.updateMotion(dt, ocean);
    dt = Math.min(dt, 0.1);
    // Pitch and roll from the surface normal (as BlueBoatEntity), less: it is longer
    if (this.waveNormal) {
      const local = this.waveNormal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.root.rotation.y);
      this.hull.rotation.z += (-Math.atan2(local.x, local.y) * 0.6 - this.hull.rotation.z) * Math.min(1, dt * 3);
      this.hull.rotation.x += (Math.atan2(local.z, local.y) * 0.6 - this.hull.rotation.x) * Math.min(1, dt * 3);
    }
  }
}

export { ZodiacEntity };
