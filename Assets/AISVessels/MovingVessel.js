import * as THREE from 'three';

// Movement shared by every vessel in the scene (see VesselEntity, PatiEntity). Placed at its first
// AIS report, between reports it keeps sailing at its speed and heading, and eases towards each
// new one; small boats also ride the waves. this.root is the vessel's 3D object, forward +X
// (heading 90º, east), as the models.

const KNOTS = 0.514444; // m/s
const RIDES_WAVES_BELOW = 40; // m long: bigger ships barely move with these waves

class MovingVessel {

  // Scene position (x east, z south, in m from the buoy) of a latitude and longitude.
  // LONGITUDE and LATITUDE, the buoy's, are set by the subclasses
  toScene(latitude, longitude) {
    const R = 6371000;
    const north = (latitude - this.LATITUDE) * Math.PI / 180 * R;
    const east = (longitude - this.LONGITUDE) * Math.PI / 180 * R * Math.cos(this.LATITUDE * Math.PI / 180);
    return new THREE.Vector3(east, 0, -north);
  }

  // A new AIS report. The first one (once the model is loaded) places the vessel
  setReport(shipInfo) {
    this.target = this.toScene(shipInfo.latitude, shipInfo.longitude);
    const heading = shipInfo.heading != 511 ? Number(shipInfo.heading) : Number(shipInfo.empiricHeading);
    if (!isNaN(heading)) this.heading = heading;
    this.speed = (Number(shipInfo.sog) || 0) * KNOTS;
    this.length = shipInfo.length > 0 ? shipInfo.length : this.length;
    if (this.root && !this.placed) {
      this.root.position.copy(this.target);
      this.root.rotation.y = -THREE.MathUtils.degToRad((this.heading || 0) - 90);
      this.placed = true;
    }
  }

  // Called every frame
  updateMotion(dt, ocean) {
    const root = this.root;
    if (!root || !this.placed) return;
    dt = Math.min(dt, 0.1);
    // Turn towards the heading, the short way
    if (this.heading != undefined) {
      const goal = -THREE.MathUtils.degToRad(this.heading - 90);
      const diff = Math.atan2(Math.sin(goal - root.rotation.y), Math.cos(goal - root.rotation.y));
      root.rotation.y += diff * Math.min(1, dt * 1.5);
    }
    // Sail on at its speed, and correct slowly towards the last reported position
    const forward = new THREE.Vector3(Math.cos(root.rotation.y), 0, -Math.sin(root.rotation.y));
    root.position.addScaledVector(forward, this.speed * dt);
    const error = this.target.clone().sub(root.position).setY(0);
    if (error.length() > 300) root.position.x = this.target.x, root.position.z = this.target.z; // Too far off: jump
    else root.position.addScaledVector(error, Math.min(1, dt * 0.3));
    this.target.addScaledVector(forward, this.speed * dt); // The report ages: it has sailed on since

    // Ride the waves (height only; PatiEntity also pitches and rolls)
    this.waveNormal = undefined;
    if (ocean?.isLoaded && (this.length || 0) < RIDES_WAVES_BELOW) {
      const position = new THREE.Vector3(root.position.x, 0, root.position.z);
      const normal = new THREE.Vector3();
      ocean.getNormalAndPositionAt(position, normal);
      if (!isNaN(position.y)) {
        root.position.y += (position.y - root.position.y) * Math.min(1, dt * 4);
        this.waveNormal = normal;
      }
    }
  }
}

export { MovingVessel };
