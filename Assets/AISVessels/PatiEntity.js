import * as THREE from 'three';
import { MovingVessel } from './MovingVessel.js';

// A patí de vela (the Catalan beach catamaran, without rudder), built here instead of loaded:
// two hulls, a deck of planks, the mast and the sail with its boom. 5.68 m long, 1.6 m wide.
// Forward is +X, as the other vessels. It moves as every vessel (see MovingVessel), pitches and
// rolls with the waves, and sets the sail by the wind.

const LENGTH = 5.68;
const BEAM = 1.6;
const MAST_HEIGHT = 7.2;
const BOOM_LENGTH = 3.4;

class PatiEntity extends MovingVessel {

  isLoaded = true;
  isPati = true;
  length = LENGTH;

  constructor(scene, shipInfo, LONGITUDE, LATITUDE) {
    super();
    this.LONGITUDE = LONGITUDE;
    this.LATITUDE = LATITUDE;
    this.root = new THREE.Group();
    this.root.name = 'Pati';
    this.hull = new THREE.Group(); // Heels and pitches; root only moves and turns
    this.root.add(this.hull);

    const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.4 });
    const wood = new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc0c6cc, metalness: 0.6, roughness: 0.3 });
    const sailMaterial = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.9, side: THREE.DoubleSide });

    // Hulls: long capsules, pointed by squashing their ends
    [-1, 1].forEach(side => {
      const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, LENGTH - 0.44, 6, 12), white);
      hull.rotation.z = Math.PI / 2;
      hull.scale.set(1, 1, 0.9);
      hull.position.set(0, 0.12, side * (BEAM / 2 - 0.22));
      this.hull.add(hull);
    });
    // Deck: planks across the hulls
    for (let i = 0; i < 7; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, BEAM - 0.1), wood);
      plank.position.set(-1.2 + i * 0.33, 0.36, 0);
      this.hull.add(plank);
    }
    // Mast, forward of the deck
    const mastX = 1.1;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, MAST_HEIGHT, 8), metal);
    mast.position.set(mastX, 0.36 + MAST_HEIGHT / 2, 0);
    this.hull.add(mast);
    // Sail and boom turn together around the mast
    this.rig = new THREE.Group();
    this.rig.position.set(mastX, 0.36, 0);
    this.hull.add(this.rig);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, BOOM_LENGTH, 6), metal);
    boom.rotation.z = Math.PI / 2;
    boom.position.set(-BOOM_LENGTH / 2, 0.7, 0);
    this.rig.add(boom);
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0.72);
    sailShape.lineTo(0, MAST_HEIGHT - 0.1);
    sailShape.quadraticCurveTo(-BOOM_LENGTH * 0.45, MAST_HEIGHT * 0.45, -BOOM_LENGTH, 0.72);
    sailShape.lineTo(0, 0.72);
    this.rig.add(new THREE.Mesh(new THREE.ShapeGeometry(sailShape), sailMaterial));

    scene.add(this.root);
    this.setReport(shipInfo);
  }

  // windFrom: where the wind comes from (degrees), to set the sail
  update(dt, ocean, windFrom) {
    this.updateMotion(dt, ocean);
    dt = Math.min(dt, 0.1);
    // Pitch and roll from the surface normal
    if (this.waveNormal) {
      const local = this.waveNormal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.root.rotation.y);
      this.hull.rotation.z += (-Math.atan2(local.x, local.y) * 0.6 - this.hull.rotation.z) * Math.min(1, dt * 3);
      this.heelTarget = Math.atan2(local.z, local.y) * 0.6;
    }

    // Sail: on the side away from the wind, closed when beating, open when running.
    // Heels a little away from the wind
    if (windFrom != undefined && this.heading != undefined) {
      const relative = ((windFrom - this.heading + 540) % 360) - 180; // + wind from starboard
      const side = relative > 0 ? -1 : 1;
      const boom = THREE.MathUtils.degToRad(Math.min(85, Math.max(10, (Math.abs(relative) - 30) * 0.6 + 10)));
      this.rig.rotation.y += (side * boom - this.rig.rotation.y) * Math.min(1, dt * 2);
      const heel = (this.heelTarget || 0) + side * THREE.MathUtils.degToRad(6) * Math.min(1, Math.abs(relative) / 90);
      this.hull.rotation.x += (heel - this.hull.rotation.x) * Math.min(1, dt * 2);
    }
  }
}

export { PatiEntity };
