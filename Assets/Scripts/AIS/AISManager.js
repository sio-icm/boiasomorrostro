
import shipTypes from './AISShipTypes.js';
import { AIS_URL } from '/boiasomorrostro/Assets/Scripts/config.js';


export class AISManager {

  ships = {}; // Dictionary to store ship objects
  isCreated = false;
  bboxes = [];
  // The BlueLab's fleet tracker, from boia_server.py: {up, url}; up false while it doesn't answer
  fleet = undefined;

  constructor() {

    // Initiate AIS Websocket connection
    this.createWSConnection();

    // Refocusing on tab or window event, restart if needed
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState == "visible")
        this.createWSConnection();
    });
    document.addEventListener("focus", this.createWSConnection);

  }

  // WEBSOCKET AIS
  // Create Websocket connection
  createWSConnection() {
    if (this.isCreated) return;

    // Connection
    this.ws;
    // ICATMAR's feed only accepts its own website: elsewhere boia_server.py serves the same (see config.js)
    this.ws = new WebSocket(AIS_URL);
    this.isCreated = true;

    // General connection events
    // OPEN
    this.ws.onopen = () => {
      window.eventBus.emit('AISManager_wsConnected');
      console.log('✅ WebSocket connection established');
      // Subscribe to the desired channel
      this.ws.send(JSON.stringify({ action: 'subscribe', id: 'boiasomorrostro' }));
    }
    // CLOSE
    this.ws.onclose = () => {
      window.eventBus.emit('AISManager_wsClosed');
      console.log('❌ WebSocket connection closed');
      this.isCreated = false;
    }
    // ERROR
    this.ws.onerror = (error) => {
      window.eventBus.emit('AISManager_wsError', error);
      console.error('❌ WebSocket error:', error);
      this.isCreated = false;
    }

    // MESSAGE
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      // Add bounding boxes
      if (data.bboxes) {
        this.bboxes = data.bboxes;
        window.eventBus.emit('AISManager_bboxes', data.bboxes);
      }

      // Whether the BlueLab's fleet tracker answers (see boia_server.py)
      if (data.fleet) {
        this.fleet = data.fleet;
        window.eventBus.emit('AISManager_fleet', data.fleet);
      }

      // Message history
      if (data.history) {
        for (let i = 0; i < data.history.length; i++) {
          this.processAISMessage(data.history[i]);
        }
      }

      // Process AIS message
      if (!data.message || !data.message.Message) return;
      this.processAISMessage(data.message);
    }
  }

  // Process AIS message
  processAISMessage(message) {
    if (message.MessageType == "SubscriptionConfirmation")
      return;
    const metaData = message.MetaData;
    if (!metaData || !metaData.latitude || !metaData.longitude) { debugger };

    const MMSI = metaData.MMSI_String;
    // Create ship
    if (!this.ships[MMSI]) {
      this.ships[MMSI] = { MMSI: MMSI };
      window.eventBus.emit('AISManager_shipCreated', metaData);
    }


    // Default values
    let shipName = metaData.ShipName || this.ships[MMSI].shipName || "Unknown Ship";
    const lat = metaData.latitude;
    const long = metaData.longitude;

    let heading = this.ships[MMSI].heading || 511; // A value of 511 indicates no heading: https://api.vtexplorer.com/docs/response-ais.html
    let sog = this.ships[MMSI].sog || 0;
    // https://api.vtexplorer.com/docs/ref-aistypes.html
    let shipType = this.ships[MMSI].shipTypeId ?? "Unknown" // The code (shipType holds its description)
    // https://api.vtexplorer.com/docs/response-ais.html
    let dimensions = this.ships[MMSI].dimensions || { A: -1, B: -1, C: -1, D: -1 };
    let typeOfMessages = this.ships[MMSI].typeOfMessages || [];


    // Get information from the message
    // Position Report
    if (message.Message.PositionReport) {
      const positionReport = message.Message.PositionReport;
      heading = positionReport.TrueHeading;
      sog = positionReport.Sog;
      if (typeOfMessages.includes("PositionReport") == false) typeOfMessages.push("PositionReport");
      this.ships[MMSI].heading = heading;
      this.ships[MMSI].sog = sog;

    }
    // Static Ship Data
    if (message.Message.ShipStaticData) {
      const shipStaticData = message.Message.ShipStaticData;
      shipType = shipStaticData.Type;
      dimensions = shipStaticData.Dimension;
      if (typeOfMessages.includes("ShipStaticData") == false) typeOfMessages.push("ShipStaticData");
    }
    // StandardClassBPositionReport
    if (message.Message.StandardClassBPositionReport) {
      const standardClassBPositionReport = message.Message.StandardClassBPositionReport;
      heading = standardClassBPositionReport.TrueHeading;
      sog = standardClassBPositionReport.Sog;
      if (typeOfMessages.includes("StandardClassBPositionReport") == false) typeOfMessages.push("StandardClassBPositionReport");
    }
    // AidsToNavigationReport
    if (message.Message.AidsToNavigationReport) {
      shipName = message.Message.AidsToNavigationReport.Name;
    }
    // Other kind of messages
    if (!message.Message.ShipStaticData && !message.Message.PositionReport && !message.Message.StandardClassBPositionReport) {
      let messageType = Object.keys(message.Message)[0];
      if (typeOfMessages.includes(messageType) == false) typeOfMessages.push(messageType);
    }

    // Infer heading from position change if not available
    // Only when it has moved (~5 m): from two equal positions it would come out as north
    const moved = Math.hypot(lat - this.ships[MMSI].latitude, (long - this.ships[MMSI].longitude) * 0.75) > 0.00005;
    if (heading == 511 && this.ships[MMSI].latitude && this.ships[MMSI].longitude && moved) {
      heading = this.calculateHeading(this.ships[MMSI].longitude, this.ships[MMSI].latitude, long, lat);
      this.ships[MMSI].empiricHeading = heading.toFixed(1);
    }


    // Assign new lat long
    this.ships[MMSI].latitude = lat;
    this.ships[MMSI].longitude = long;
    // Assign values to ship
    this.ships[MMSI].shipName = shipName;
    this.ships[MMSI].shipTypeId = shipType;
    this.ships[MMSI].shipType = shipTypes[shipType];
    this.ships[MMSI].sog = sog;
    this.ships[MMSI].heading = heading;
    this.ships[MMSI].dimensions = dimensions;
    this.ships[MMSI].length = dimensions.A + dimensions.B;
    this.ships[MMSI].beam = dimensions.C + dimensions.D;
    // For some reason the ShipStaticData is always 10 minutes old. TODO? Only PositionReport and StandardClassBPositionReport?
    if (this.ships[MMSI].lastTmst == undefined) {
      this.ships[MMSI].lastTmst = metaData.time_utc;
    }
    // If new message is older, use most recent tmst
    else if (new Date(this.ships[MMSI].lastTmst) < new Date(metaData.time_utc)) {
      this.ships[MMSI].lastTmst = metaData.time_utc;
    }
    this.ships[MMSI].typeOfMessages = typeOfMessages;
    // A BlueBoat's battery and temperatures (see boia_server.py)
    if (metaData.Telemetry) this.ships[MMSI].telemetry = metaData.Telemetry;


    // Emit event to update ship data
    window.eventBus.emit('AISManager_receivedAISMessage', this.ships[MMSI]);
  }



  // UTILS
  // Calculate the heading between two points
  calculateHeading(oldLong, oldLat, newLong, newLat) {
    // Convert degrees to radians
    const toRadians = (deg) => (deg * Math.PI) / 180;
    const toDegrees = (rad) => (rad * 180) / Math.PI;

    const lat1 = toRadians(oldLat);
    const lat2 = toRadians(newLat);
    const deltaLong = toRadians(newLong - oldLong);

    // Calculate the bearing
    const y = Math.sin(deltaLong) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLong);
    let bearing = toDegrees(Math.atan2(y, x));

    // Normalize the bearing to 0° - 360°
    return (bearing + 360) % 360;
  }





  // PUBLIC
  // Get current ships
  getCurrentShips() {
    return this.ships;
  }



}

export default AISManager;