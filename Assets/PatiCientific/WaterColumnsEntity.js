import * as THREE from 'three';

// THE PATÍ CIENTÍFIC'S WATER COLUMNS (2021-22), in the 3D view's mode of their own (see
// GUIManager.patiMode). At each of its regular stations, a column under the sea from the surface
// to the deepest measure, at its real size and coloured by temperature, with a mark every
// MARK_STEP metres down (its depth and temperature), and a label over it with the station's number
// and the surface temperature. The camera dives next to one of them to look down along it (see
// SceneManager.setPati). Each date shows, at each station, its profile taken closest to it (up to
// MAX_DAYS away; none, and the column is hidden). The data: data/StaticData/pati_cientific.json
// (see tools/export_pati_cientific.py and WaterColumnChart.vue, which draws the same over the year)

const DATA_URL = '/boiasomorrostro/data/StaticData/pati_cientific.json';
// Cold to warm, as the water column chart and the sea temperature forecast on the map
const COLORS = ['#2c3e9e', '#2f7fb5', '#1fa3a3', '#7cc47f', '#e8d24a', '#ef7d3c', '#d6454f'];
// One scale for all the dates, so the colours compare between them (the data: 11.6 to 26.1 ºC)
const COLDEST = 11, WARMEST = 27;
const MAX_DAYS = 10; // A campaign took a few days
const RADIUS = 1.5; // m
const TOP = -0.4; // m: just under the waves
const MAX_GAP = 1.5; // m: missing depths up to this are filled from the nearest ones (as the chart)
const LABEL_HEIGHT = 4; // m over the sea
const MARK_STEP = 5; // m

// Colour of a temperature, between COLORS
function temperatureColor(temperature) {
  const f = THREE.MathUtils.clamp((temperature - COLDEST) / (WARMEST - COLDEST), 0, 1) * (COLORS.length - 1);
  const i = Math.min(COLORS.length - 2, Math.floor(f));
  return new THREE.Color(COLORS[i]).lerp(new THREE.Color(COLORS[i + 1]), f - i);
}

// A text on a dark pill, as a texture, and its width / height
function textTexture(text, background, color) {
  const scale = 2, height = 30 * scale, font = `600 ${17 * scale}px "TT Commons", sans-serif`;
  const canvas = document.createElement('canvas');
  let context = canvas.getContext('2d');
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width + 22 * scale);
  canvas.height = height;
  context = canvas.getContext('2d'); // Resizing the canvas resets it
  context.font = font;
  context.fillStyle = background;
  context.beginPath();
  context.roundRect(0, 0, canvas.width, height, height / 2);
  context.fill();
  context.fillStyle = color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, height / 2 + scale);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: canvas.width / height };
}

// Frees what a group holds
function dispose(object) {
  object?.traverse(child => {
    child.geometry?.dispose();
    [child.material].flat().forEach(material => { material?.map?.dispose(); material?.dispose(); });
  });
}

class WaterColumnsEntity {

  constructor(scene, latitude, longitude) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.stations = [];
    this.loaded = fetch(DATA_URL).then(res => res.json()).then(data => {
      this.bin = data.bin;
      data.stations.filter(s => s.id != null).forEach(s => {
        const north = (s.lat - latitude) * 111320;
        const east = (s.lon - longitude) * 111320 * Math.cos(latitude * Math.PI / 180);
        const group = new THREE.Group();
        group.position.set(east, 0, -north); // North is -z
        this.root.add(group);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, fog: false, transparent: true }));
        label.position.y = LABEL_HEIGHT;
        label.renderOrder = 21;
        group.add(label);
        this.stations.push({ ...s, group, label, times: s.profiles.map(p => Date.parse(p.date + 'T12:00:00Z')) });
      });
    }).catch(error => console.warn('Patí Científic profiles not loaded:', error));
  }

  show = (visible) => {
    this.root.visible = visible;
  }

  // Columns for a date ('YYYY-MM-DD'): at each station, its profile closest to it
  setDate = async (date) => {
    await this.loaded;
    const time = Date.parse(date + 'T12:00:00Z');
    this.stations.forEach(station => {
      let best;
      station.times.forEach((t, n) => {
        if (Math.abs(t - time) <= MAX_DAYS * 86400e3 && (best == undefined || Math.abs(t - time) < Math.abs(station.times[best] - time))) best = n;
      });
      const profile = best == undefined ? undefined : station.profiles[best];
      if (profile === station.shown && station.label.material.map) return;
      station.shown = profile;
      this.draw(station);
    });
  }

  draw = (station) => {
    this.drawColumn(station, station.shown);
    this.drawMarks(station, station.shown);
    this.drawLabel(station, station.shown);
  }

  drawColumn = (station, profile) => {
    station.group.remove(station.column);
    dispose(station.column);
    station.column = undefined;
    if (!profile) return;
    // A texture with the temperature every bin from the surface down, gaps filled from the nearest
    const bin = this.bin, depths = profile.depth, bottom = depths[depths.length - 1] + bin / 2;
    const rows = Math.max(1, Math.round(bottom / bin));
    const pixels = new Uint8Array(rows * 4);
    for (let r = 0; r < rows; r++) {
      const temperature = this.temperatureAt(profile, bottom - (r + 0.5) * bin); // Row 0 is the column's bottom
      const color = temperature != undefined ? temperatureColor(temperature) : new THREE.Color(0x0d2a4c);
      color.convertLinearToSRGB(); // THREE.Color keeps linear components
      pixels.set([color.r * 255, color.g * 255, color.b * 255, 255], r * 4);
    }
    const texture = new THREE.DataTexture(pixels, 1, rows);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const height = bottom - Math.max(0, depths[0] - bin / 2);
    // Its own colours, not those of the water around (no underwater fog)
    const material = (options) => new THREE.MeshBasicMaterial({ fog: false, ...options });
    station.column = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, height, 32, 1), [
      material({ map: texture }), // Side
      material({ color: temperatureColor(profile.temperature[0]) }), // Top
      material({ color: temperatureColor(profile.temperature[depths.length - 1]) }), // Bottom
    ]);
    station.column.position.y = TOP - height / 2;
    station.group.add(station.column);
  }

  // Temperature at a depth, from the nearest measure (up to MAX_GAP away), or undefined
  temperatureAt = (profile, depth) => {
    let k = 0;
    profile.depth.forEach((d, i) => { if (Math.abs(d - depth) < Math.abs(profile.depth[k] - depth)) k = i; });
    return Math.abs(profile.depth[k] - depth) <= MAX_GAP ? profile.temperature[k] : undefined;
  }

  // Every MARK_STEP m down and at the bottom: a thin white ring around the column, and its depth
  // and temperature beside it, on the camera's side (see update)
  drawMarks = (station, profile) => {
    station.group.remove(station.marks);
    dispose(station.marks);
    station.marks = undefined;
    if (!profile) return;
    station.marks = new THREE.Group();
    const bottom = profile.depth[profile.depth.length - 1];
    const depths = [];
    for (let depth = MARK_STEP; depth < bottom - 1.5; depth += MARK_STEP) depths.push(depth);
    depths.push(bottom);
    depths.forEach(depth => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(RADIUS + 0.03, 0.05, 6, 48),
        new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.85 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = TOP - depth;
      station.marks.add(ring);
      const temperature = this.temperatureAt(profile, depth);
      const text = `${this.number(depth, 0)} m` + (temperature != undefined ? ` · ${this.number(temperature, 1)} ºC` : '');
      const { texture, aspect } = textTexture(text, 'rgba(13, 42, 76, 0.8)', 'white');
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, fog: false, transparent: true }));
      label.center.set(-0.08, 0.5); // Its left end, just beside the column
      label.position.y = TOP - depth;
      label.userData.isMark = true;
      label.userData.aspect = aspect;
      station.marks.add(label);
    });
    station.group.add(station.marks);
  }

  // The station's number and the temperature at the surface, on a dark pill
  drawLabel = (station, profile) => {
    const text = profile ? `${station.id} · ${this.number(profile.temperature[0], 1)} ºC` : `${station.id}`;
    const { texture, aspect } = profile ? textTexture(text, 'rgba(13, 42, 76, 0.85)', 'white')
      : textTexture(text, 'rgba(13, 42, 76, 0.45)', 'rgba(255, 255, 255, 0.6)');
    station.label.material.map?.dispose();
    station.label.material.map = texture;
    station.label.material.needsUpdate = true;
    station.label.userData.aspect = aspect;
  }

  number = (value, decimals) => value.toLocaleString(this.locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

  // Labels the same size on screen wherever they are: a fraction of the distance to the camera.
  // Smaller on a narrow screen (a phone upright), or they would cover each other. The marks a
  // little smaller, beside the column on the camera's right, and only at the station the camera is
  // at (active, its number); under the water, the other stations' labels hidden too
  update = (camera) => {
    if (!this.root.visible) return;
    const size = 0.035 * THREE.MathUtils.clamp(camera.aspect, 0.6, 1);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize().multiplyScalar(RADIUS);
    const scale = (sprite, fraction) => {
      const h = camera.position.distanceTo(sprite.getWorldPosition(new THREE.Vector3())) * fraction;
      sprite.scale.set(h * (sprite.userData.aspect || 1), h, 1);
    };
    const underwater = camera.position.y < 0;
    this.stations.forEach(station => {
      const active = station.id === this.active;
      station.label.visible = active || !underwater;
      scale(station.label, size);
      if (station.marks) station.marks.visible = active;
      if (!active) return;
      station.marks?.children.forEach(mark => {
        if (!mark.userData.isMark) return;
        mark.position.set(right.x, mark.position.y, right.z);
        scale(mark, 0.03); // Not smaller on a phone: they don't cover each other
      });
    });
  }

  // Where each station's label is, for picking (see SceneManager.pickAt)
  pickables = () => this.root.visible ? this.stations.map(s => [`station-${s.id}`, s.label.getWorldPosition(new THREE.Vector3())]) : []

  // A station's position (on the surface) and how deep its column goes, once loaded
  stationAt = (id) => {
    const station = this.stations.find(s => s.id === id);
    if (!station) return undefined;
    const profile = station.shown;
    return { position: station.group.position.clone(), depth: profile ? profile.depth[profile.depth.length - 1] : 15 };
  }

  // In the app's language (the decimal comma), drawn again
  setLocale = (locale) => {
    this.locale = locale;
    this.stations.forEach(this.draw);
  }
}

export { WaterColumnsEntity };
