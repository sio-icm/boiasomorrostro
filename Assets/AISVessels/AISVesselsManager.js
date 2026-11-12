import { VesselEntity, TankerVesselEntity, CargoVesselEntity, CruiseBigEntity } from "./VesselEntity.js";
import { PatiEntity } from "./PatiEntity.js";
import { BlueBoatEntity } from "./BlueBoatEntity.js";

// The AIS vessels in the 3D scene: one entity per ship (see AISManager), with a model by its
// type, moving with its reports (see MovingVessel).

// Ships further than this from the buoy aren't drawn: they'd be lost in the haze anyway,
// and each one costs a model in the scene
const MAX_DISTANCE = 10000; // m
// Ships silent for longer than this are taken out of the scene
const STALE_MINUTES = 30;

class AISVesselsManager {

  constructor(scene, LONGITUDE, LATITUDE) {
    this.scene = scene;
    this.LONGITUDE = LONGITUDE;
    this.LATITUDE = LATITUDE;
    this.ships = {}; // MMSI -> entity
    this.sinceCleanUp = 0;

    if (window.AISManager) {
      Object.values(window.AISManager.getCurrentShips()).forEach(this.handleAISMessage);
      window.eventBus.on('AISManager_receivedAISMessage', this.handleAISMessage);
    }
  }

  // Called every frame by SceneManager
  update(dt, ocean, windFrom) {
    Object.values(this.ships).forEach(ship => ship.update?.(dt, ocean, windFrom));
    this.sinceCleanUp += dt;
    if (this.sinceCleanUp > 10) {
      this.sinceCleanUp = 0;
      this.removeStale();
    }
  }

  // Boats without AIS, sent from a phone through boia_server.py
  isPati = (shipInfo) => String(shipInfo.MMSI).startsWith('PATI-')

  // The BlueLab's autonomous vehicles, from its fleet tracker through boia_server.py
  isBlueBoat = (shipInfo) => String(shipInfo.MMSI).startsWith('BLUEBOAT-')

  isNearby = (shipInfo) => {
    const north = (shipInfo.latitude - this.LATITUDE) * 111320;
    const east = (shipInfo.longitude - this.LONGITUDE) * 111320 * Math.cos(this.LATITUDE * Math.PI / 180);
    return Math.hypot(north, east) < MAX_DISTANCE;
  }

  // Which model, from the AIS ship type code (https://api.vtexplorer.com/docs/ref-aistypes.html)
  modelFor = (shipInfo) => {
    if (this.isPati(shipInfo)) return PatiEntity;
    if (this.isBlueBoat(shipInfo)) return BlueBoatEntity;
    const type = Number(shipInfo.shipTypeId);
    if (type >= 70 && type <= 79) return CargoVesselEntity;
    if (type >= 80 && type <= 89) return TankerVesselEntity;
    // Ferries, fast ferries (high-speed craft, 40-49) and cruise ships
    if (((type >= 60 && type <= 69) || (type >= 40 && type <= 49)) && shipInfo.length > 60) return CruiseBigEntity;
    // Any other big ship (unknown or other type): the small boat would be stretched too far
    if (shipInfo.length > 60) return CargoVesselEntity;
    return VesselEntity; // Small boats: fishing, pleasure, tugs, pilots...
  }

  handleAISMessage = (shipInfo) => {
    if (shipInfo.typeOfMessages.includes("AidsToNavigationReport")) return; // Buoys and beacons, not vessels
    if (shipInfo.latitude == undefined) return;
    let ship = this.ships[shipInfo.MMSI];
    // The type often arrives after the first positions: then the ship gets its proper model
    const Model = this.modelFor(shipInfo);
    if (ship && ship.constructor !== Model) {
      this.remove(shipInfo.MMSI);
      ship = undefined;
    }
    if (ship == undefined) {
      if (!this.isNearby(shipInfo)) return;
      ship = this.ships[shipInfo.MMSI] = this.createShip(Model, shipInfo);
    }
    ship.setReport(shipInfo);
    if (ship.setShipDimensions && shipInfo.length > 0) ship.setShipDimensions(shipInfo.length, shipInfo.beam);
  }

  createShip = (Model, shipInfo) => {
    if (Model === PatiEntity || Model === BlueBoatEntity) return new Model(this.scene, shipInfo, this.LONGITUDE, this.LATITUDE);
    const ship = new Model(this.scene, shipInfo, () => ship.setReport(shipInfo));
    ship.LONGITUDE = this.LONGITUDE;
    ship.LATITUDE = this.LATITUDE;
    return ship;
  }

  remove = (mmsi) => {
    const ship = this.ships[mmsi];
    if (ship?.root) this.scene.remove(ship.root);
    ship.removed = true; // If its model is still loading (see VesselEntity.addToScene)
    delete this.ships[mmsi];
  }

  removeStale = () => {
    const now = Date.now();
    Object.keys(this.ships).forEach(mmsi => {
      const lastTmst = window.AISManager?.ships[mmsi]?.lastTmst;
      if (lastTmst && now - new Date(lastTmst).getTime() > STALE_MINUTES * 60000) this.remove(mmsi);
    });
  }

}

export { AISVesselsManager };
