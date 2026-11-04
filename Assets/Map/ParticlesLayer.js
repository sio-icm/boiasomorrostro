// Animated vector field (wind, currents) on a Leaflet map: a colour field of the speed and particles
// that drift with it leaving short trails. Draws on two canvases over the tiles; works in screen space,
// so the velocity field is resampled into a pixel grid each time the map moves or the hour changes.
// The field is a ForecastField (or anything with sample(lat, lon, hour) -> [u, v] in m/s).

// Speed colour scales, also used by the legend: [speed in m/s, [r, g, b]]
const COLOR_SCALES = {
  wind: [
    [0, [98, 182, 220]],
    [3, [82, 196, 170]],
    [6, [150, 205, 90]],
    [9, [240, 200, 70]],
    [12, [240, 135, 60]],
    [16, [215, 70, 80]],
    [22, [160, 60, 150]],
  ],
  currents: [
    [0, [40, 90, 160]],
    [0.1, [40, 150, 200]],
    [0.2, [70, 200, 190]],
    [0.35, [170, 225, 120]],
    [0.5, [250, 215, 80]],
    [0.8, [245, 130, 60]],
  ],
};
// Sea mask from the EMODnet bathymetry (~115 m): sea opaque, land transparent. Used to keep the
// currents at sea, since the current forecast gives the nearest sea value for points on land
const SEA_MASK_STYLE = `<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld"><NamedLayer><Name>emodnet:mean</Name>
  <UserStyle><FeatureTypeStyle><Rule><RasterSymbolizer><ColorMap type="intervals">
  <ColorMapEntry color="#000000" quantity="0" opacity="1"/><ColorMapEntry color="#000000" quantity="100000" opacity="0"/>
  </ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
function seaMaskURL(southWest, northEast, width, height) {
  return 'https://ows.emodnet-bathymetry.eu/wms?service=WMS&request=GetMap&version=1.3.0&layers=emodnet:mean' +
    '&crs=EPSG:3857&format=image/png&transparent=true' +
    `&bbox=${southWest.x},${southWest.y},${northEast.x},${northEast.y}&width=${width}&height=${height}` +
    '&SLD_BODY=' + encodeURIComponent(SEA_MASK_STYLE);
}

const CELL = 6;      // px of each cell of the screen velocity grid
const MAX_AGE = 90;  // frames a particle lives before respawning
const FADE = 0.93;   // how much of the previous frame stays (trail length)

function speedColor(scale, speed) {
  for (let k = 1; k < scale.length; k++) {
    if (speed <= scale[k][0]) {
      const [s0, c0] = scale[k - 1], [s1, c1] = scale[k];
      const f = (speed - s0) / (s1 - s0);
      return c0.map((c, n) => Math.round(c + (c1[n] - c) * f));
    }
  }
  return scale[scale.length - 1][1];
}

const ParticlesLayer = L.Layer.extend({

  options: {
    colors: COLOR_SCALES.wind,
    speedFactor: 0.18,      // px per frame for each m/s
    density: 600,           // px² of screen per particle
    particleColor: 'rgba(255, 255, 255, 0.85)',
    className: '',          // added to both canvases, e.g. to set the colour field's opacity
    seaOnly: false,         // hide it on land (see seaMaskURL)
  },

  initialize(field, options) {
    this.field = field;
    this.hour = 0;
    L.setOptions(this, options);
  },

  onAdd(map) {
    this.map = map;
    const pane = map.getPane('overlayPane');
    this.colorCanvas = L.DomUtil.create('canvas', 'map-field-colors leaflet-zoom-hide ' + this.options.className, pane);
    this.particleCanvas = L.DomUtil.create('canvas', 'map-field-particles leaflet-zoom-hide ' + this.options.className, pane);
    [this.colorCanvas, this.particleCanvas].forEach(canvas => {
      canvas.style.position = 'absolute';
      canvas.style.pointerEvents = 'none';
    });
    map.on('movestart zoomstart', this.stop, this);
    map.on('moveend zoomend resize', this.reset, this);
    this.reset();
  },

  onRemove(map) {
    this.stop();
    map.off('movestart zoomstart', this.stop, this);
    map.off('moveend zoomend resize', this.reset, this);
    this.colorCanvas.remove();
    this.particleCanvas.remove();
  },

  setHour(hour) {
    this.hour = hour;
    if (this.map) this.reset();
  },

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (this.particleCanvas) this.particleCanvas.getContext('2d').clearRect(0, 0, this.width, this.height);
  },

  // Rebuilds the screen velocity grid and the colour field, then (re)starts the animation
  reset() {
    this.stop();
    const map = this.map, size = map.getSize(), options = this.options;
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    const ratio = window.devicePixelRatio || 1;
    this.width = size.x;
    this.height = size.y;
    [this.colorCanvas, this.particleCanvas].forEach(canvas => {
      L.DomUtil.setPosition(canvas, topLeft);
      canvas.width = size.x * ratio;
      canvas.height = size.y * ratio;
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
      canvas.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
    });

    // Velocity in px/frame for each screen cell (y grows downwards on screen)
    const cols = Math.ceil(size.x / CELL) + 1, rows = Math.ceil(size.y / CELL) + 1;
    this.grid = { cols, rows, u: new Float32Array(cols * rows), v: new Float32Array(cols * rows), valid: new Uint8Array(cols * rows) };
    const colors = this.colorCanvas.getContext('2d');
    colors.clearRect(0, 0, size.x, size.y);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const latlng = map.containerPointToLatLng([c * CELL, r * CELL]);
        const velocity = this.field.sample(latlng.lat, latlng.lng, this.hour);
        if (velocity == undefined) continue;
        const index = r * cols + c;
        this.grid.u[index] = velocity[0] * options.speedFactor;
        this.grid.v[index] = -velocity[1] * options.speedFactor;
        this.grid.valid[index] = 1;
        const [red, green, blue] = speedColor(options.colors, Math.hypot(velocity[0], velocity[1]));
        const alpha = this.field.edge ? this.field.edge(latlng.lat, latlng.lng) : 1;
        colors.fillStyle = `rgba(${red},${green},${blue},${alpha})`;
        colors.fillRect(c * CELL - CELL / 2, r * CELL - CELL / 2, CELL, CELL);
      }
    }

    const count = Math.min(2500, Math.round(size.x * size.y / options.density));
    this.particles = Array.from({ length: count }, () => this.spawn({}));
    this.particles.forEach(p => p.age = Math.floor(Math.random() * MAX_AGE));
    if (options.seaOnly) this.applySeaMask();
    this.animate();
  },

  // Removes the land cells (and their colour) once the sea mask of this view is loaded:
  // one mask pixel per grid cell
  applySeaMask() {
    const map = this.map, grid = this.grid, crs = map.options.crs;
    const southWest = crs.project(map.containerPointToLatLng([-CELL / 2, (grid.rows - 0.5) * CELL]));
    const northEast = crs.project(map.containerPointToLatLng([(grid.cols - 0.5) * CELL, -CELL / 2]));
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (this.grid !== grid) return; // The view changed meanwhile
      const canvas = document.createElement('canvas');
      canvas.width = grid.cols;
      canvas.height = grid.rows;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const alpha = context.getImageData(0, 0, grid.cols, grid.rows).data;
      const colors = this.colorCanvas.getContext('2d');
      for (let index = 0; index < grid.valid.length; index++) {
        if (alpha[index * 4 + 3] > 127) continue;
        grid.valid[index] = 0;
        const c = index % grid.cols, r = Math.floor(index / grid.cols);
        colors.clearRect(c * CELL - CELL / 2, r * CELL - CELL / 2, CELL, CELL);
      }
    };
    image.src = seaMaskURL(southWest, northEast, grid.cols, grid.rows);
  },

  // Velocity at a screen position (nearest cell), or undefined where there is no data
  velocity(x, y) {
    const c = Math.round(x / CELL), r = Math.round(y / CELL), g = this.grid;
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return undefined;
    const index = r * g.cols + c;
    return g.valid[index] ? [g.u[index], g.v[index]] : undefined;
  },

  spawn(particle) {
    for (let tries = 0; tries < 10; tries++) {
      particle.x = Math.random() * this.width;
      particle.y = Math.random() * this.height;
      if (this.velocity(particle.x, particle.y)) break;
    }
    particle.age = 0;
    return particle;
  },

  animate() {
    const ctx = this.particleCanvas.getContext('2d');
    // Fade the previous frame, leaving the trails
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = `rgba(0, 0, 0, ${FADE})`;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = 'source-over';

    ctx.strokeStyle = this.options.particleColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    this.particles.forEach(p => {
      const velocity = this.velocity(p.x, p.y);
      if (velocity == undefined || p.age++ > MAX_AGE) {
        this.spawn(p);
        return;
      }
      ctx.moveTo(p.x, p.y);
      p.x += velocity[0];
      p.y += velocity[1];
      ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    this.frame = requestAnimationFrame(() => this.animate());
  },
});

export { ParticlesLayer, COLOR_SCALES };
