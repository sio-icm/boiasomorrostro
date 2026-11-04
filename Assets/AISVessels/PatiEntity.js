import * as THREE from 'three';
import { MovingVessel } from './MovingVessel.js';

// A patí de vela, the Catalan beach catamaran, built here instead of loaded. As the real one
// (https://ca.wikipedia.org/wiki/Patí_de_vela, and photos of patins sailing): two tall, narrow,
// nearly box-sided hulls 5.60 m long, 1.60 m wide overall, flat-decked, with the sail number at the
// bow and the boat's name at the stern; wooden benches across them (a wide one at the mast, one
// aft, two strips along); no rudder, no centreboard and no boom: a 6.80 m mast well forward with
// forestays and shrouds, and a big sail whose long foot reaches almost to the stern, with a window
// and the sail number. The sailor, in a red life jacket, sits aft on the windward hull.
// Colours as the Grill (214): black hulls with a white deck, wooden benches.
// Forward is +X, as the other vessels. It moves as every vessel (see MovingVessel), pitches and
// rolls with the waves, and sets the sail by the wind.

const LENGTH = 5.6;
const HULL_SPACING = 1.26;   // m between the hulls' centres (1.60 m overall)
const HULL_WIDTH = 0.34;     // m, each hull
const DECK = 0.42;           // m, height of the hulls' deck above the water (at the stern)
const KEEL = -0.14;          // m, depth of the hulls under the water
const MAST_X = 1.45;         // m forward of the middle
const MAST_HEIGHT = 6.8;
const CLEW = [-2.45, 1.0];   // m: where the sail's foot ends, aft (x) and above the water (y)
const COLORS = { hull: 0x15181c, deck: 0xf2f2ee, wood: 0x9a6a3c };

// One hull, lofted from cross-sections: pointed bow, square transom, nearly straight sides with a
// rounded bottom, a sheer that rises a little towards the bow. The sides and the flat deck are
// separate geometries, for their colours
function hullGeometries() {
  const SECTIONS = 30, POINTS = 12;
  const sides = [], deck = [], sideIndices = [], deckIndices = [];
  for (let i = 0; i <= SECTIONS; i++) {
    const b = i / SECTIONS; // 0 stern, 1 bow
    const x = -LENGTH / 2 + b * LENGTH;
    const halfWidth = HULL_WIDTH / 2 * Math.sqrt(Math.max(0, 1 - b ** 4));
    const top = DECK + 0.1 * b ** 2;
    const keel = KEEL * (1 - b ** 3) + 0.15 * b ** 3; // The bow lifts out of the water
    for (let k = 0; k <= POINTS; k++) {
      // Superellipse: box-like sides, rounded bottom
      const phi = -Math.PI / 2 + Math.PI * k / POINTS;
      const s = Math.sin(phi), c = Math.cos(phi);
      sides.push(x, top - (top - keel) * Math.abs(c) ** 0.45, halfWidth * Math.sign(s) * Math.abs(s) ** 0.45);
    }
    deck.push(x, top + 0.002, -halfWidth, x, top + 0.002, halfWidth);
    if (i > 0) {
      for (let k = 0; k < POINTS; k++) {
        const a = (i - 1) * (POINTS + 1) + k, c = i * (POINTS + 1) + k;
        sideIndices.push(a, c, a + 1, a + 1, c, c + 1);
      }
      const d = (i - 1) * 2;
      deckIndices.push(d, d + 1, d + 2, d + 2, d + 1, d + 3);
    }
  }
  for (let k = 1; k < POINTS; k++) sideIndices.push(0, k + 1, k); // Transom
  const build = (vertices, indices) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };
  return { sides: build(sides, sideIndices), deck: build(deck, deckIndices) };
}

// The sail: from the tack (at the mast) up the mast to the head, and down the curved leech to the
// clew. A grid of height x chord, with some belly to one side (+Z); u along the chord, v up
function sailGeometry() {
  const ROWS = 14, COLUMNS = 10;
  const tack = new THREE.Vector3(0, 0.55, 0), head = new THREE.Vector3(0, MAST_HEIGHT - 0.15, 0);
  const clew = new THREE.Vector3(CLEW[0] - MAST_X, CLEW[1] - DECK, 0);
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

// White sailcloth (u along the chord, v up): seams, a dark draft stripe, the window low down,
// and the sail number high up
function sailTexture(number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  const y = (v) => 512 * (1 - v);
  context.fillStyle = '#f7f7f4';
  context.fillRect(0, 0, 512, 512);
  context.strokeStyle = 'rgba(0, 0, 0, 0.07)';
  for (let v = 0.08; v < 1; v += 0.09) {
    context.beginPath();
    context.moveTo(0, y(v));
    context.lineTo(512, y(v - 0.06));
    context.stroke();
  }
  context.strokeStyle = 'rgba(20, 20, 30, 0.75)';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(0, y(0.52));
  context.lineTo(400, y(0.47));
  context.stroke();
  context.fillStyle = 'rgba(90, 105, 120, 0.55)'; // Window
  context.fillRect(170, y(0.2), 190, 512 * 0.08);
  if (number) {
    context.fillStyle = '#111';
    context.font = 'bold 96px Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText(number, 175, y(0.66));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A label painted on the hull's side (white on the black hull)
function hullLabel(text, width) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.font = 'bold 70px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 256, 52);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width * 96 / 512),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
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

    // Sail number and name from the boat's name, e.g. "Patí 214-Grill"
    const [, number, name] = (shipInfo.shipName || '').match(/(\d+)[\s-]*([^\d\s-][^\d]*)?$/) || [];

    const hullMaterial = new THREE.MeshStandardMaterial({ color: COLORS.hull, roughness: 0.3, side: THREE.DoubleSide });
    const deckMaterial = new THREE.MeshStandardMaterial({ color: COLORS.deck, roughness: 0.5 });
    const wood = new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.65 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc3c8cd, metalness: 0.7, roughness: 0.3 });

    // Hulls, with the number at the bow and the name at the stern on their outer sides
    const hull = hullGeometries();
    [-1, 1].forEach(side => {
      const z = side * HULL_SPACING / 2;
      const sides = new THREE.Mesh(hull.sides, hullMaterial);
      const deck = new THREE.Mesh(hull.deck, deckMaterial);
      sides.position.z = deck.position.z = z;
      this.hull.add(sides, deck);
      const outside = z + side * (HULL_WIDTH / 2 + 0.004);
      [[number, 1.85, 0.55], [name?.toUpperCase(), -1.75, 0.8]].forEach(([text, x, width]) => {
        if (!text) return;
        const label = hullLabel(text, width);
        label.position.set(x, DECK - 0.13, outside);
        label.rotation.y = side > 0 ? 0 : Math.PI;
        this.hull.add(label);
      });
    });

    // Benches: a wide one at the mast, a wide one aft, a narrow one in between, and two strips along
    [[MAST_X - 0.05, 0.4], [0.1, 0.12], [-2.25, 0.36]].forEach(([x, width]) => {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, HULL_SPACING + HULL_WIDTH * 0.6), wood);
      bench.position.set(x, DECK + 0.03, 0);
      this.hull.add(bench);
    });
    [-0.22, 0.22].forEach(z => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.035, 0.14), wood);
      strip.position.set(-0.6, DECK + 0.05, z);
      this.hull.add(strip);
    });

    // Mast and its stays: forestays to both bows, shrouds to the hulls' sides
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, MAST_HEIGHT, 8), metal);
    mast.position.set(MAST_X, DECK + MAST_HEIGHT / 2, 0);
    this.hull.add(mast);
    const top = new THREE.Vector3(MAST_X, DECK + MAST_HEIGHT - 0.3, 0);
    const stays = [];
    [-1, 1].forEach(side => {
      stays.push(top, new THREE.Vector3(LENGTH / 2 - 0.25, DECK + 0.1, side * HULL_SPACING / 2));
      stays.push(top, new THREE.Vector3(MAST_X - 0.35, DECK + 0.02, side * (HULL_SPACING / 2 + HULL_WIDTH / 2)));
    });
    this.hull.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(stays),
      new THREE.LineBasicMaterial({ color: 0x7d858c })));

    // Sail, turning around the mast. One face each side, so the number reads right from both
    // (mirrored texture on the back)
    this.rig = new THREE.Group();
    this.rig.position.set(MAST_X, DECK, 0);
    this.hull.add(this.rig);
    const front = sailTexture(number), back = front.clone();
    back.repeat.x = -1;
    back.offset.x = 1;
    back.needsUpdate = true;
    this.sail = new THREE.Group();
    const cloth = sailGeometry();
    this.sail.add(new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ map: front, roughness: 0.85, side: THREE.FrontSide })));
    this.sail.add(new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ map: back, roughness: 0.85, side: THREE.BackSide })));
    this.rig.add(this.sail);

    // Sailor: sitting aft on the windward hull's deck, leaning out (side set in update), in a red
    // life jacket
    this.sailor = new THREE.Group();
    const trousers = new THREE.MeshStandardMaterial({ color: 0x1d2b44, roughness: 0.8 });
    const jacket = new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc69476, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 8), jacket);
    body.position.y = 0.4;
    body.rotation.x = -0.4; // Leaning out (towards -Z)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), skin);
    head.position.set(0, 0.83, -0.3);
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), trousers);
    legs.rotation.x = Math.PI / 2;
    legs.position.set(0.05, 0.08, 0.38); // Towards the middle of the boat
    this.sailor.add(body, head, legs);
    this.sailor.position.set(-2.0, DECK, -HULL_SPACING / 2);
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
