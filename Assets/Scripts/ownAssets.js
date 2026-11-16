// OUR EQUIPMENT (also window.OwnAssets, for the .vue components): what is the ICM's own among what
// the app shows (the rest, AIS ships or ICATMAR's other buoys, are other people's data). They are listed in the "Our equipment" menu (see
// OwnAssetsMenu), with whether they are transmitting, and marked on the map and in the 3D scene.
// To add one, a line here: a buoy (always in the scene), or vehicles, known by the start of their
// MMSI as boia_server.py relays them (prefix), or by their own MMSI if they have real AIS (mmsi).
//   name: an i18n key; owner: shown on its card and in the menu; model: how the 3D scene draws them,
//   if not by their AIS type (see AISVesselsManager.modelFor)
const OWN_ASSETS = [
  { id: 'buoy', kind: 'buoy', name: 'Somorrostro buoy', owner: 'ICM-CSIC · ICATMAR' },
  { id: 'blueboats', kind: 'vehicles', name: 'BlueBoats', owner: 'BlueLab · ICM-CSIC', prefix: 'BLUEBOAT-' },
  { id: 'patis', kind: 'vehicles', name: 'Sailing dinghies', prefix: 'PATI-' },
  // The Pelagia Primer: a red rigid inflatable (Zodiac) of 6 m, with its own AIS (see ZodiacEntity)
  { id: 'boats', kind: 'vehicles', name: 'Boats', owner: 'ICM-CSIC', mmsi: ['224946750'], model: 'zodiac' },
];

// A vehicle is transmitting if its last position is this recent (as AISVesselsManager drops them)
const LIVE_MINUTES = 30;
// The buoy, if its last data is this recent (as NowCard)
const BUOY_LIVE_HOURS = 3;

// Whether a vehicle (its MMSI) is one of a group of ours
function inGroup(asset, mmsi) {
  return asset.prefix ? String(mmsi).startsWith(asset.prefix) : !!asset.mmsi?.includes(String(mmsi));
}

// Our vehicles' group (see OWN_ASSETS), from its MMSI, or undefined if it is not ours
function ownGroupOf(mmsi) {
  return OWN_ASSETS.find(asset => asset.kind === 'vehicles' && inGroup(asset, mmsi));
}

// Whether a vehicle (AISManager's ship) is transmitting
function isLive(ship) {
  return ship?.lastTmst != undefined && Date.now() - new Date(ship.lastTmst).getTime() < LIVE_MINUTES * 60000;
}

export { OWN_ASSETS, LIVE_MINUTES, BUOY_LIVE_HOURS, inGroup, ownGroupOf, isLive };
