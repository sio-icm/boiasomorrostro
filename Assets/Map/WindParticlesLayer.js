// Animated wind on a Leaflet map: a colour field of the wind speed and particles that drift with
// the wind leaving short trails. Draws on two canvases over the tiles; works in screen space,
// so the velocity field is resampled into a pixel grid each time the map moves or the hour changes.

// Wind speed colour scale (m/s), shared with the legend
const SPEED_COLORS = [
  [0, [98, 182, 220]],
  [3, [82, 196, 170]],
  [6, [150, 205, 90]],
  [9, [240, 200, 70]],
  [12, [240, 135, 60]],
  [16, [215, 70, 80]],
  [22, [160, 60, 150]],
];
const CELL = 6;            // px of each cell of the screen velocity grid
const SPEED_FACTOR = 0.18; // px per frame for each m/s
const MAX_AGE = 90;        // frames a particle lives before respawning
const FADE = 0.93;         // how much of the previous frame stays (trail length)

function speedColor(speed) {
  for (let k = 1; k < SPEED_COLORS.length; k++) {
    if (speed <= SPEED_COLORS[k][0]) {
      const [s0, c0] = SPEED_COLORS[k - 1], [s1, c1] = SPEED_COLORS[k];
      const f = (speed - s0) / (s1 - s0);
      return c0.map((c, n) => Math.round(c + (c1[n] - c) * f));
    }
  }
  return SPEED_COLORS[SPEED_COLORS.length - 1][1];
}

const WindParticlesLayer = L.Layer.extend({

  initialize(field, options) {
    this.field = field;
    this.hour = 0;
    L.setOptions(this, options);
  },

  onAdd(map) {
    this.map = map;
    const pane = map.getPane(this.options.pane || 'overlayPane');
    this.colorCanvas = L.DomUtil.create('canvas', 'map-wind-colors leaflet-zoom-hide', pane);
    this.particleCanvas = L.DomUtil.create('canvas', 'map-wind-particles leaflet-zoom-hide', pane);
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
    const map = this.map, size = map.getSize();
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
        const wind = this.field.sample(latlng.lat, latlng.lng, this.hour);
        if (wind == undefined) continue;
        const index = r * cols + c;
        this.grid.u[index] = wind[0] * SPEED_FACTOR;
        this.grid.v[index] = -wind[1] * SPEED_FACTOR;
        this.grid.valid[index] = 1;
        const [red, green, blue] = speedColor(Math.hypot(wind[0], wind[1]));
        colors.fillStyle = `rgb(${red},${green},${blue})`;
        colors.fillRect(c * CELL - CELL / 2, r * CELL - CELL / 2, CELL, CELL);
      }
    }

    // About one particle every 600 px², fewer on small screens
    const count = Math.min(2500, Math.round(size.x * size.y / 600));
    this.particles = Array.from({ length: count }, () => this.spawn({}));
    this.particles.forEach(p => p.age = Math.floor(Math.random() * MAX_AGE));
    this.animate();
  },

  // Velocity at a screen position (nearest cell), or undefined outside the forecast area
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

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
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

export { WindParticlesLayer, SPEED_COLORS, speedColor };
