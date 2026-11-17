import * as THREE from 'three';
import { HISTORY_URL } from '/boiasomorrostro/Assets/Scripts/config.js';
import { BlueBoatEntity } from '/boiasomorrostro/Assets/AISVessels/BlueBoatEntity.js';
import { ZodiacEntity } from '/boiasomorrostro/Assets/AISVessels/ZodiacEntity.js';
import { PatiEntity } from '/boiasomorrostro/Assets/AISVessels/PatiEntity.js';
import { OwnMarker } from '/boiasomorrostro/Assets/AISVessels/OwnMarker.js';

// THE 3D VIEW'S HISTORY MODE (see GUIManager.historyTime): where our equipment was at a past
// moment, from what the server keeps (boia_server.py, HISTORY): the buoy (its AIS GPS fixes), the
// Pelagia and the BlueBoats. Each vessel is built as when it is live (see AISVesselsManager), with
// its ring, and placed where it was at that moment: between two of its positions, where it was
// on the way; with no position of it near that moment (GAP), not shown. The buoy, which is always
// there, goes where it was (see buoyOffset); with no position then, it stays where it was last seen.
// The positions are loaded a UTC day at a time (with some hours of the days around, so a
// moment near midnight has positions on both sides), as the moment moves on.

const DAY = 86400e3;
const MARGIN = 6 * 3600e3; // ms of the days around loaded with each day
const GAP = 20 * 60e3; // ms: farther than this from its positions, a vessel is not shown
const SPIKE = 300; // m: a position this far from both its neighbours (which are close) is a bad fix
const KEEP_DAYS = 6; // Days kept loaded

class HistoryManager {

  constructor(scene, LATITUDE, LONGITUDE) {
    this.scene = scene;
    this.LATITUDE = LATITUDE;
    this.LONGITUDE = LONGITUDE;
    this.days = {}; // UTC day number -> Promise of its tracks, then the tracks ({id: {t, x, z, heading}})
    this.vessels = {}; // id -> entity, while shown
    this.buoyOffset = new THREE.Vector3(); // Where the buoy was, from its last known position
    this.present = {}; // id -> whether it has a position at the moment
    this.summary = fetch(HISTORY_URL + 'summary').then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
    this.summary.then(summary => this.platforms = Object.fromEntries(summary.platforms.map(p => [p.id, p])), () => {});
  }

  // Scene metres (x east, z south) of a latitude and longitude, from the buoy (as MovingVessel)
  toScene(lat, lon) {
    const R = 6371000, rad = Math.PI / 180;
    return { x: (lon - this.LONGITUDE) * rad * R * Math.cos(this.LATITUDE * rad), z: -(lat - this.LATITUDE) * rad * R };
  }

  // The moment shown (ms): its day loaded, and the next or previous one too when near its end
  setTime(time) {
    this.time = time;
    const day = Math.floor(time / DAY);
    this.load(day);
    if (time - day * DAY > DAY - MARGIN) this.load(day + 1);
    if (time - day * DAY < MARGIN) this.load(day - 1);
  }

  load(day) {
    if (this.days[day]) return;
    const from = new Date(day * DAY - MARGIN).toISOString(), to = new Date((day + 1) * DAY + MARGIN).toISOString();
    this.days[day] = fetch(`${HISTORY_URL}positions?from=${from}&to=${to}`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)))
      .then(data => this.days[day] = this.prepare(data.tracks))
      .catch(error => {
        console.warn('History: positions of', from, 'not loaded:', error);
        delete this.days[day]; // Tried again when needed
      });
    // Not too many kept
    const loaded = Object.keys(this.days).map(Number).sort((a, b) => Math.abs(a - day) - Math.abs(b - day));
    loaded.slice(KEEP_DAYS).forEach(old => delete this.days[old]);
  }

  // Whether the positions of a moment are still loading
  loading(time) {
    return time != undefined && this.days[Math.floor(time / DAY)] instanceof Promise;
  }

  // The first moment of a day ('YYYY-MM-DD') with a position of any of these (ids), or undefined
  async firstIn(day, ids) {
    const number = Math.floor(Date.parse(day + 'T00:00:00Z') / DAY);
    this.load(number);
    const tracks = await this.days[number];
    const start = number * DAY, end = start + DAY;
    const times = ids.flatMap(id => (tracks?.[id] || []).map(p => p.t).filter(t => t >= start && t < end));
    return times.length ? Math.min(...times) : undefined;
  }

  // Each track in scene metres, without its bad fixes (spikes)
  prepare(tracks) {
    const prepared = {};
    Object.entries(tracks).forEach(([id, track]) => {
      const points = track.t.map((t, i) => ({ t: t * 1000, ...this.toScene(track.lat[i], track.lon[i]), heading: track.heading[i] }));
      const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      const good = points.filter((p, i) => {
        const before = points[i - 1], after = points[i + 1];
        return !(before && after && distance(p, before) > SPIKE && distance(p, after) > SPIKE && distance(before, after) < SPIKE);
      });
      prepared[id] = good;
    });
    return prepared;
  }

  // Where a vessel was at a moment: {x, z, heading}, or undefined
  sample(id, time) {
    const tracks = this.days[Math.floor(time / DAY)];
    const points = tracks?.[id];
    if (!points?.length) return undefined;
    // The last position at or before the moment
    let low = 0, high = points.length - 1;
    if (time < points[0].t) high = -1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (points[mid].t <= time) low = mid; else high = mid - 1;
    }
    const before = high >= 0 ? points[high] : undefined, after = points[high + 1];
    const near = (p) => p && Math.abs(p.t - time) <= GAP;
    if (!near(before) && !near(after)) return undefined;
    if (!near(before) || !near(after) || after.t - before.t > GAP) return { ...(near(before) ? before : after) };
    const k = (time - before.t) / (after.t - before.t);
    const x = before.x + (after.x - before.x) * k, z = before.z + (after.z - before.z) * k;
    // Heading: its own if it gives one, else where it was going
    let heading = before.heading ?? after.heading;
    if (heading == undefined && Math.hypot(after.x - before.x, after.z - before.z) > 2)
      heading = (Math.atan2(after.x - before.x, -(after.z - before.z)) * 180 / Math.PI + 360) % 360;
    return { x, z, heading };
  }

  // Which model, as when live (see AISVesselsManager.modelFor)
  modelFor(id) {
    if (id.startsWith('PATI-')) return PatiEntity;
    if (id.startsWith('BLUEBOAT-') || this.platforms?.[id]?.kind === 'vehicle') return BlueBoatEntity;
    return ZodiacEntity;
  }

  // Every frame: each one where it was at the moment
  update(dt, ocean, windFrom, camera) {
    if (this.time == undefined) return;
    const ids = new Set(Object.keys(this.platforms || {}));
    Object.keys(this.vessels).forEach(id => ids.add(id));
    ids.forEach(id => {
      const at = this.sample(id, this.time);
      this.present[id] = !!at;
      if (this.platforms?.[id]?.kind === 'buoy') {
        if (at) this.buoyOffset.set(at.x, 0, at.z);
        return;
      }
      let vessel = this.vessels[id];
      if (!at) {
        if (vessel) this.remove(id);
        return;
      }
      if (!vessel) {
        const Model = this.modelFor(id);
        const shipInfo = { MMSI: id, shipName: this.platforms?.[id]?.name, latitude: this.LATITUDE, longitude: this.LONGITUDE,
          heading: 511, sog: 0, lastTmst: new Date(0).toISOString() };
        vessel = this.vessels[id] = new Model(this.scene, shipInfo, this.LONGITUDE, this.LATITUDE);
        vessel.historyId = id;
        vessel.ownMarker = new OwnMarker(this.scene);
        vessel.placed = true;
        if (at.heading != undefined) vessel.root.rotation.y = -THREE.MathUtils.degToRad(at.heading - 90);
      }
      // There, without sailing on by itself (MovingVessel only turns it and rides the waves)
      vessel.speed = 0;
      vessel.target.set(at.x, 0, at.z);
      vessel.root.position.x = at.x;
      vessel.root.position.z = at.z;
      if (at.heading != undefined) vessel.heading = at.heading;
      vessel.update(dt, ocean, windFrom);
      vessel.ownMarker.update(vessel.root, camera, vessel.length);
    });
  }

  remove(id) {
    const vessel = this.vessels[id];
    if (!vessel) return;
    this.scene.remove(vessel.root);
    vessel.ownMarker?.remove();
    delete this.vessels[id];
  }

  // Out of the history mode: its vessels out of the scene, the buoy back
  clear() {
    Object.keys(this.vessels).forEach(id => this.remove(id));
    this.buoyOffset.set(0, 0, 0);
    this.time = undefined;
    this.present = {};
  }
}

export { HistoryManager };
