import { VesselEntity, TankerVesselEntity, CargoVesselEntity, CruiseBigEntity } from "./VesselEntity.js";
import { PatiEntity } from "./PatiEntity.js";

// Ships further than this from the buoy aren't drawn: they'd be lost in the haze anyway,
// and each one costs a model in the scene
const MAX_DISTANCE = 10000; // m

class AISVesselsManager {

  constructor(scene, LONGITUDE, LATITUDE) {
    // Store scene
    this.scene = scene;
    // Set longitude and latitude
    this.LONGITUDE = LONGITUDE;
    this.LATITUDE = LATITUDE;

    // Add current ships
    this.ships = {};
    if (window.AISManager) {
      let aisShips = window.AISManager.getCurrentShips();

      Object.keys(aisShips).forEach((key) => {
        let shipInfo = aisShips[key];
        // Ignore aids to navigation reports
        if (shipInfo.typeOfMessages.includes("AidsToNavigationReport")) {
          console.log("⚠️⛵ Ignoring AidsToNavigationReport for "+ shipInfo.shipName +", MMSI " + shipInfo.MMSI + ", at "+ shipInfo.latitude + "º N, " + shipInfo.longitude + "º E");
          return;
        }
        // Create ship entity
        this.createShip(shipInfo, scene);
      });


      // Manage new messages
      // EVENTS
      // AIS messages
      window.eventBus.on('AISManager_receivedAISMessage', this.handleAISMessage);
    }
  }

  // Update. Only patís move between reports for now (see PatiEntity)
  update(dt, ocean, windFrom) {
    Object.values(this.ships).forEach(ship => {
      if (ship.isPati) ship.update(dt, ocean, windFrom);
    });
  }

  // Boats without AIS, sent from a phone through ais_relay.py
  isPati = (shipInfo) => String(shipInfo.MMSI).startsWith('PATI-')


  handleAISMessage = (shipInfo) => {
    if (shipInfo.typeOfMessages.includes("AidsToNavigationReport")) {
      console.log("⚠️⛵ Ignoring AidsToNavigationReport for "+ shipInfo.shipName +", MMSI " + shipInfo.MMSI + ", at "+ shipInfo.latitude + "º N, " + shipInfo.longitude + "º E");
      return;
    }
    // Heading correction
    let heading;
    if (shipInfo.heading === 511) {
      if (shipInfo.empiricHeading) {
        heading = shipInfo.empiricHeading.toFixed(0);
      } else {
        heading = 511;
      }
    } else {
      heading = shipInfo.heading;
    }

    if (this.isPati(shipInfo)) {
      const pati = this.ships[shipInfo.MMSI];
      if (pati) pati.setReport(shipInfo);
      else this.createShip(shipInfo, this.scene);
      return;
    }
    // Create new ship if it doesn't exist
    if (this.ships[shipInfo.MMSI] == undefined) {
      this.createShip(shipInfo, this.scene);
    }
    // Update ship
    else {
      //this.ships[shipInfo.MMSI].setShipPosition(this.LONGITUDE, this.LATITUDE, shipInfo.longitude, shipInfo.latitude);
      this.ships[shipInfo.MMSI].setShipOrientation(heading);
      this.ships[shipInfo.MMSI].setShipSOG(shipInfo.sog);
      this.ships[shipInfo.MMSI].setShipDimensions(shipInfo.length, shipInfo.beam);
    }
  }



  isNearby = (shipInfo) => {
    const north = (shipInfo.latitude - this.LATITUDE) * 111320;
    const east = (shipInfo.longitude - this.LONGITUDE) * 111320 * Math.cos(this.LATITUDE * Math.PI / 180);
    return Math.hypot(north, east) < MAX_DISTANCE;
  }

  createShip = (shipInfo, scene) => {
    if (!this.isNearby(shipInfo)) return;
    if (this.isPati(shipInfo)) {
      this.ships[shipInfo.MMSI] = new PatiEntity(scene, shipInfo, this.LONGITUDE, this.LATITUDE);
      return;
    }
    // Create ship entity
    let shipEntity

    // Check ship type and create appropriate entity
    let shipType = shipInfo.shipType || "Unknown";

    const onLoadShip = () => {
      // Set ship position
      shipEntity.setShipPosition(this.LONGITUDE, this.LATITUDE, shipInfo.longitude, shipInfo.latitude);
      // Set ship orientation
      shipEntity.setShipOrientation(shipInfo.heading);
      // Set ship speed-over-ground
      shipEntity.setShipSOG(shipInfo.sog);
    }

    if (shipType.includes("Cargo")) {
      shipEntity = new CargoVesselEntity(scene, shipInfo, onLoadShip);
    }
    else if (shipType.includes("Tanker")) {
      shipEntity = new TankerVesselEntity(scene, shipInfo, onLoadShip);
    }
    else if (shipType.includes("Passenger")) { // TODO: small passenger ships
      shipEntity = new CruiseBigEntity(scene, shipInfo, onLoadShip);
    }
    else {
      // Create default ship entity
      shipEntity = new VesselEntity(scene, shipInfo, onLoadShip);
    }


    // Add ship to ships list
    this.ships[shipInfo.MMSI] = shipEntity;
  }

}


export { AISVesselsManager };