import * as THREE from 'three';
import { MovingVessel } from './MovingVessel.js';

// A patí de vela, the Catalan beach catamaran, built here instead of loaded. As the real one
// (https://ca.wikipedia.org/wiki/Patí_de_vela): two narrow hulls 5.60 m long, 1.60 m wide overall,
// joined by wooden crossbeams; no rudder, no centreboard and no boom: a 6.80 m mast well forward,
// held by forestays and shrouds, and a big sail whose long foot reaches almost to the stern, with
// the sail number in the middle. The sailor sits aft on the windward hull.
// Forward is +X, as the other vessels. It moves as every vessel (see MovingVessel), pitches and
// rolls with the waves, and sets the sail by the wind.

const LENGTH = 5.6;
const HULL_SPACING = 1.28;   // m between the hulls' centres (1.60 m overall)
const HULL_WIDTH = 0.32;     // m, each hull at the deck
const DECK = 0.3;            // m, height of the hulls' deck above the water (at the stern)
const KEEL = -0.12;          // m, depth of the hulls under the water
const MAST_X = 1.45;         // m forward of the middle
const MAST_HEIGHT = 6.8;
const CLEW = [-2.45, 0.85];  // m: where the sail's foot ends, aft (x) and above the water (y)

// One hull, lofted from cross-sections: pointed bow, square transom, V bottom, and a sheer that
// rises a little towards the bow
function hullGeometry() {
  const SECTIONS = 28, POINTS = 10;
  const vertices = [], indices = [];
  for (let i = 0; i <= SECTIONS; i++) {
    const b = i / SECTIONS; // 0 stern, 1 bow
    const x = -LENGTH / 2 + b * LENGTH;
    const halfWidth = HULL_WIDTH / 2 * Math.sqrt(Math.max(0, 1 - b ** 3)) * (0.9 + 0.1 * (1 - b));
    const deck = DECK + 0.1 * b ** 2;
    const keel = KEEL * (1 - b ** 4) + 0.12 * b ** 4; // The bow lifts out of the water
    for (let k = 0; k <= POINTS; k++) {
      const phi = -Math.PI / 2 + Math.PI * k / POINTS;
      vertices.push(x, deck - (deck - keel) * Math.cos(phi) ** 1.4, halfWidth * Math.sin(phi));
    }
    if (i > 0) {
      for (let k = 0; k < POINTS; k++) {
        const a = (i - 1) * (POINTS + 1) + k, c = i * (POINTS + 1) + k;
        indices.push(a, c, a + 1, a + 1, c, c + 1);
      }
      // Deck: between the two top edges of consecutive sections
      const a0 = (i - 1) * (POINTS + 1), c0 = i * (POINTS + 1);
      indices.push(a0, a0 + POINTS, c0, c0, a0 + POINTS, c0 + POINTS);
    }
  }
  // Transom: the first section closed with a fan
  for (let k = 1; k < POINTS; k++) indices.push(0, k + 1, k);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// The sail: from the tack (at the mast) up the mast to the head, and down the curved leech to the
// clew. A grid of height x chord, with some belly to one side (+Z); u along the chord, v up
function sailGeometry() {
  const ROWS = 14, COLUMNS = 10;
  const tack = new THREE.Vector3(0, 0.55, 0), head = new THREE.Vector3(0, MAST_HEIGHT - 0.15, 0);
  const clew = new THREE.Vector3(CLEW[0] - MAST_X, CLEW[1], 0);
  const vertices = [], uvs = [], indices = [];
  for (let r = 0; r <= ROWS; r++) {
    const h = r / ROWS;
    const luff = tack.clone().lerp(head, h);
    // Leech from clew to head, bowed outward (the roach)
    const leech = clew.clone().lerp(head, h);
    leech.x -= 0.45 * Math.sin(Math.PI * h) * (1 - h * 0.3);
    for (let c = 0; c <= COLUMNS; c++) {
      const u = c / COLUMNS;
      const point = luff.clone().lerp(leech, u);
      point.z = 0.32 * (1 - h) * Math.sin(Math.PI * u) ** 1.2; // Belly, deeper low down
      vertices.push(point.x, point.y, point.z);
      uvs.push(u, h);
    }
    if (r > 0) {
      for (let c = 0; c < COLUMNS; c++) {
        const a = (r - 1) * (COLUMNS + 1) + c, b = r * (COLUMNS + 1) + c;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// White sailcloth with the sail number, as on the real ones (u along the chord, v up)
function sailTexture(number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f7f7f4';
  context.fillRect(0, 0, 512, 512);
  // Seams across the sail
  context.strokeStyle = 'rgba(0, 0, 0, 0.08)';
  for (let y = 40; y < 512; y += 46) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(512, y + 30);
    context.stroke();
  }
  if (number) {
    context.fillStyle = '#111';
    context.font = 'bold 110px Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText(number, 200, 512 * (1 - 0.42));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

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

    const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.35, side: THREE.DoubleSide });
    const wood = new THREE.MeshStandardMaterial({ color: 0xa8743f, roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc3c8cd, metalness: 0.7, roughness: 0.3 });

    // Hulls
    const hull = hullGeometry();
    [-1, 1].forEach(side => {
      const mesh = new THREE.Mesh(hull, white);
      mesh.position.z = side * HULL_SPACING / 2;
      this.hull.add(mesh);
    });
    // Deck: wooden crossbeams from hull to hull, and two strips along them aft, where the sailor goes
    [-2.35, -1.6, -0.85, 0.1, MAST_X].forEach(x => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, HULL_SPACING + 0.1), wood);
      beam.position.set(x, DECK + 0.04, 0);
      this.hull.add(beam);
    });
    [-0.3, 0.3].forEach(z => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.03, 0.12), wood);
      strip.position.set(-1.2, DECK + 0.08, z);
      this.hull.add(strip);
    });

    // Mast and its stays: forestays to both bows, shrouds to the hulls' sides
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, MAST_HEIGHT, 8), metal);
    mast.position.set(MAST_X, DECK + MAST_HEIGHT / 2, 0);
    this.hull.add(mast);
    const top = new THREE.Vector3(MAST_X, DECK + MAST_HEIGHT - 0.3, 0);
    const stays = [];
    [-1, 1].forEach(side => {
      stays.push(top, new THREE.Vector3(LENGTH / 2 - 0.25, DECK + 0.08, side * HULL_SPACING / 2));
      stays.push(top, new THREE.Vector3(MAST_X - 0.35, DECK + 0.02, side * (HULL_SPACING / 2 + HULL_WIDTH / 2)));
    });
    this.hull.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(stays),
      new THREE.LineBasicMaterial({ color: 0x7d858c })));

    // Sail, turning around the mast
    this.rig = new THREE.Group();
    this.rig.position.set(MAST_X, DECK, 0);
    this.hull.add(this.rig);
    // One face each side, so the number reads right from both (mirrored texture on the back)
    const number = (shipInfo.shipName || '').match(/\d+/)?.[0];
    const front = sailTexture(number), back = front.clone();
    back.repeat.x = -1;
    back.offset.x = 1;
    back.needsUpdate = true;
    this.sail = new THREE.Group();
    const cloth = sailGeometry();
    this.sail.add(new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ map: front, roughness: 0.85, side: THREE.FrontSide })));
    this.sail.add(new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ map: back, roughness: 0.85, side: THREE.BackSide })));
    this.rig.add(this.sail);

    // Sailor: sitting aft on the windward hull, leaning out (side set in update)
    this.sailor = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0x1d2b44, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc69476, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 4, 8), suit);
    body.position.y = 0.42;
    body.rotation.x = -0.35; // Leaning out (towards -Z)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), skin);
    head.position.set(0, 0.86, -0.28);
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), suit);
    legs.rotation.x = Math.PI / 2;
    legs.position.set(0.05, 0.1, 0.35); // Towards the middle of the boat
    this.sailor.add(body, head, legs);
    this.sailor.position.set(-2.0, DECK + 0.05, -HULL_SPACING / 2);
    this.hull.add(this.sailor);

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

    // Sail: on the side away from the wind, closed when beating, open when running, its belly to
    // leeward. The sailor on the windward hull. Heels a little away from the wind
    if (windFrom != undefined && this.heading != undefined) {
      const relative = ((windFrom - this.heading + 540) % 360) - 180; // + wind from starboard
      const side = relative > 0 ? -1 : 1; // Leeward: -1 port (-Z), +1 starboard (+Z)
      const angle = THREE.MathUtils.degToRad(Math.min(85, Math.max(8, (Math.abs(relative) - 30) * 0.6 + 8)));
      this.rig.rotation.y += (side * angle - this.rig.rotation.y) * Math.min(1, dt * 2);
      this.sail.scale.z = side; // Belly to leeward
      this.sailor.position.z = -side * HULL_SPACING / 2;
      this.sailor.rotation.y = side > 0 ? 0 : Math.PI; // Facing in, leaning out
      const heel = (this.heelTarget || 0) + side * THREE.MathUtils.degToRad(6) * Math.min(1, Math.abs(relative) / 90);
      this.hull.rotation.x += (heel - this.hull.rotation.x) * Math.min(1, dt * 2);
    }
  }
}

export { PatiEntity };
