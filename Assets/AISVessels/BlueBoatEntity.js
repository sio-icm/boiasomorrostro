import * as THREE from 'three';
import { MovingVessel } from './MovingVessel.js';

// A BlueBoat, the BlueLab's (ICM) autonomous surface vehicle by Blue Robotics, built here instead of
// loaded. Approximate: a catamaran some 1.2 m long, two rounded hulls joined by two tubes, the
// electronics box in the middle, a short mast with the GPS and the radio antennas, and a thruster
// under the stern of each hull. Yellow hulls, to be seen on the sea.
// Its positions come from the BlueLab's fleet tracker (see boia_server.py), about one a minute.
// Forward is +X, as the other vessels. It moves as every vessel (see MovingVessel), and pitches
// and rolls with the waves.

const LENGTH = 1.2;
const HULL_SPACING = 0.7; // m between the hulls' centres
const HULL_RADIUS = 0.09;
const DECK = 0.08; // m, top of the hulls above the water
const COLORS = { hull: 0xf2c200, frame: 0xb9c0c7, box: 0x1d2329, accent: 0x1e6fd9 };

class BlueBoatEntity extends MovingVessel {

  isLoaded = true;
  length = LENGTH;

  constructor(scene, shipInfo, LONGITUDE, LATITUDE) {
    super();
    this.LONGITUDE = LONGITUDE;
    this.LATITUDE = LATITUDE;
    this.root = new THREE.Group();
    this.root.name = 'BlueBoat';
    this.hull = new THREE.Group(); // Pitches and rolls; root only moves and turns
    this.root.add(this.hull);

    const hullMaterial = new THREE.MeshStandardMaterial({ color: COLORS.hull, roughness: 0.45 });
    const frame = new THREE.MeshStandardMaterial({ color: COLORS.frame, metalness: 0.7, roughness: 0.35 });
    const box = new THREE.MeshStandardMaterial({ color: COLORS.box, roughness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.5 });

    // Hulls: capsules along X, a little flattened, half under the water; a thruster under each stern
    [-1, 1].forEach(side => {
      const z = side * HULL_SPACING / 2;
      const hull = new THREE.Mesh(new THREE.CapsuleGeometry(HULL_RADIUS, LENGTH - 2 * HULL_RADIUS, 6, 12), hullMaterial);
      hull.rotation.z = Math.PI / 2;
      hull.scale.set(0.85, 1, 1); // Flatter: the capsule's x is the height once turned
      hull.position.set(0, DECK - HULL_RADIUS * 0.85, z);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(LENGTH * 0.6, 0.012, 0.05), accent);
      stripe.position.set(-0.05, DECK + 0.002, z);
      const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.11, 12), box);
      thruster.rotation.z = Math.PI / 2;
      thruster.position.set(-LENGTH / 2 + 0.12, -0.1, z);
      this.hull.add(hull, stripe, thruster);
    });

    // Two tubes across the hulls, the electronics box on them
    [0.25, -0.25].forEach(x => {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, HULL_SPACING + 0.06, 8), frame);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(x, DECK + 0.03, 0);
      this.hull.add(tube);
    });
    const electronics = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.3), box);
    electronics.position.set(0, DECK + 0.1, 0);
    this.hull.add(electronics);

    // Mast with the GPS dome and a radio antenna
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 8), frame);
    mast.position.set(-0.08, DECK + 0.33, 0);
    const gps = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.5 }));
    gps.position.set(-0.08, DECK + 0.5, 0);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.3, 6), box);
    antenna.position.set(0.12, DECK + 0.3, 0.08);
    this.hull.add(mast, gps, antenna);

    scene.add(this.root);
    this.setReport(shipInfo);
  }

  update(dt, ocean) {
    this.updateMotion(dt, ocean);
    dt = Math.min(dt, 0.1);
    // Pitch and roll from the surface normal
    if (this.waveNormal) {
      const local = this.waveNormal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.root.rotation.y);
      this.hull.rotation.z += (-Math.atan2(local.x, local.y) * 0.8 - this.hull.rotation.z) * Math.min(1, dt * 4);
      this.hull.rotation.x += (Math.atan2(local.z, local.y) * 0.8 - this.hull.rotation.x) * Math.min(1, dt * 4);
    }
  }
}

export { BlueBoatEntity };
