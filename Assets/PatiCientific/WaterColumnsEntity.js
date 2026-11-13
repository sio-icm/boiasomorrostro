import * as THREE from 'three';

// THE PATÍ CIENTÍFIC'S WATER COLUMNS (2021-22), in the 3D view's mode of their own (see
// GUIManager.patiMode). At each of its regular stations, a column under the sea from the surface
// to the deepest measure, coloured by temperature, and a label over it with the station's number
// and the surface temperature. Seen through the sea, as an X-ray, and DEPTH_SCALE times deeper
// than they are: at their real size they would be thin lines from a kilometre away. Each date shows, at each station, its profile taken closest to it
// (up to MAX_DAYS away; none, and the column is hidden). The data: data/StaticData/pati_cientific.json
// (see tools/export_pati_cientific.py and WaterColumnChart.vue, which draws the same over the year)

const DATA_URL = '/boiasomorrostro/data/StaticData/pati_cientific.json';
// Cold to warm, as the water column chart and the sea temperature forecast on the map
const COLORS = ['#2c3e9e', '#2f7fb5', '#1fa3a3', '#7cc47f', '#e8d24a', '#ef7d3c', '#d6454f'];
// One scale for all the dates, so the colours compare between them (the data: 11.6 to 26.1 ºC)
const COLDEST = 11, WARMEST = 27;
const MAX_DAYS = 10; // A campaign took a few days
const RADIUS = 35; // m: the columns are 0.5 to 2 km from each other, seen from far
const DEPTH_SCALE = 8;
const TOP = -0.4; // m: just under the waves
const MAX_GAP = 1.5; // m: missing depths up to this are filled from the nearest ones (as the chart)
const LABEL_HEIGHT = 12; // m over the sea

// Colour of a temperature, between COLORS
function temperatureColor(temperature) {
  const f = THREE.MathUtils.clamp((temperature - COLDEST) / (WARMEST - COLDEST), 0, 1) * (COLORS.length - 1);
  const i = Math.min(COLORS.length - 2, Math.floor(f));
  return new THREE.Color(COLORS[i]).lerp(new THREE.Color(COLORS[i + 1]), f - i);
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
      this.dates = [...new Set(this.stations.flatMap(s => s.profiles.map(p => p.date)))].sort();
    }).catch(error => console.warn('Patí Científic profiles not loaded:', error));
  }

  // The dates with profiles ('YYYY-MM-DD'), once loaded
  getDates = async () => {
    await this.loaded;
    return this.dates || [];
  }

  show = (visible) => {
    this.root.visible = visible;
  }

  // Columns for a date ('YYYY-MM-DD'): at each station, its profile closest to it
  setDate = async (date) => {
    await this.loaded;
    this.date = date;
    const time = Date.parse(date + 'T12:00:00Z');
    this.stations.forEach(station => {
      let best;
      station.times.forEach((t, n) => {
        if (Math.abs(t - time) <= MAX_DAYS * 86400e3 && (best == undefined || Math.abs(t - time) < Math.abs(station.times[best] - time))) best = n;
      });
      const profile = best == undefined ? undefined : station.profiles[best];
      if (profile === station.shown && station.column) return;
      station.shown = profile;
      this.drawColumn(station, profile);
      this.drawLabel(station, profile);
    });
  }

  drawColumn = (station, profile) => {
    if (station.column) {
      station.group.remove(station.column);
      station.column.geometry.dispose();
      station.column.material.forEach(m => { m.map?.dispose(); m.dispose(); });
      station.column = undefined;
    }
    if (!profile) return;
    // A texture with the temperature every bin from the surface down, gaps filled from the nearest
    const bin = this.bin, depths = profile.depth, bottom = depths[depths.length - 1] + bin / 2;
    const rows = Math.max(1, Math.round(bottom / bin));
    const pixels = new Uint8Array(rows * 4);
    for (let r = 0; r < rows; r++) {
      const depth = bottom - (r + 0.5) * bin; // Row 0 is the column's bottom
      let k = 0;
      depths.forEach((d, i) => { if (Math.abs(d - depth) < Math.abs(depths[k] - depth)) k = i; });
      const color = Math.abs(depths[k] - depth) <= MAX_GAP ? temperatureColor(profile.temperature[k]) : new THREE.Color(0x0d2a4c);
      color.convertLinearToSRGB(); // THREE.Color keeps linear components
      pixels.set([color.r * 255, color.g * 255, color.b * 255, 255], r * 4);
    }
    const texture = new THREE.DataTexture(pixels, 1, rows);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const height = bottom - Math.max(0, depths[0] - bin / 2);
    // Drawn after the sea, over it
    const material = (options) => new THREE.MeshBasicMaterial({ fog: false, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9, ...options });
    station.column = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, height * DEPTH_SCALE, 32, 1), [
      material({ map: texture }), // Side
      material({ color: temperatureColor(profile.temperature[0]) }), // Top
      material({ color: temperatureColor(profile.temperature[depths.length - 1]) }), // Bottom
    ]);
    station.column.position.y = TOP - height * DEPTH_SCALE / 2;
    station.column.renderOrder = 10;
    station.group.add(station.column);
  }

  // The station's number and the temperature at the surface, on a dark pill
  drawLabel = (station, profile) => {
    const temperature = profile?.temperature[0].toLocaleString(this.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const text = profile ? `${station.id} · ${temperature} ºC` : `${station.id}`;
    const scale = 2, height = 30 * scale, font = `600 ${17 * scale}px "TT Commons", sans-serif`;
    const canvas = document.createElement('canvas');
    let context = canvas.getContext('2d');
    context.font = font;
    canvas.width = Math.ceil(context.measureText(text).width + 22 * scale);
    canvas.height = height;
    context = canvas.getContext('2d');
    context.font = font;
    context.fillStyle = profile ? 'rgba(13, 42, 76, 0.85)' : 'rgba(13, 42, 76, 0.45)';
    context.beginPath();
    context.roundRect(0, 0, canvas.width, height, height / 2);
    context.fill();
    context.fillStyle = profile ? 'white' : 'rgba(255, 255, 255, 0.6)';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, height / 2 + scale);
    station.label.material.map?.dispose();
    station.label.material.map = new THREE.CanvasTexture(canvas);
    station.label.material.map.colorSpace = THREE.SRGBColorSpace;
    station.label.material.needsUpdate = true;
    station.label.userData.aspect = canvas.width / height;
  }

  // Labels the same size on screen wherever they are: a fraction of the distance to the camera.
  // Smaller on a narrow screen (a phone upright), or they would cover each other
  update = (camera) => {
    if (!this.root.visible) return;
    const size = 0.035 * THREE.MathUtils.clamp(camera.aspect, 0.6, 1);
    this.stations.forEach(station => {
      const position = station.label.getWorldPosition(new THREE.Vector3());
      const h = camera.position.distanceTo(position) * size;
      station.label.scale.set(h * (station.label.userData.aspect || 1), h, 1);
    });
  }

  // Where each station's label is, for picking (see SceneManager.pickAt)
  pickables = () => this.root.visible ? this.stations.map(s => [`station-${s.id}`, s.label.getWorldPosition(new THREE.Vector3())]) : []

  // In the app's language (the labels' decimal comma), drawn again
  setLocale = (locale) => {
    this.locale = locale;
    this.stations.forEach(station => this.drawLabel(station, station.shown));
  }

  // Over all the stations, to look at them from the south-west
  centre = () => {
    const box = new THREE.Box3();
    this.stations.forEach(s => box.expandByPoint(s.group.position));
    return box.getCenter(new THREE.Vector3());
  }
}

export { WaterColumnsEntity };
