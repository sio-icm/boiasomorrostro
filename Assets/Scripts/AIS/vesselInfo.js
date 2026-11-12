// WHAT IS SHOWN ABOUT A VESSEL (an AIS ship, or one of our vehicles relayed as one, see
// boia_server.py), in one place for its card on the map (MapBuoyLocation) and in the 3D view
// (NowCard). Also window.VesselInfo, for the .vue components.

// Ship categories from the AIS ship type code (https://api.vtexplorer.com/docs/ref-aistypes.html),
// each with its colour on the map. The first one that matches is used
const SHIP_CATEGORIES = [
  { label: "Cargo", color: '#3f9a5a', matches: type => type >= 70 && type <= 79 },
  { label: "Tanker", color: '#d6454f', matches: type => type >= 80 && type <= 89 },
  { label: "Passenger", color: 'var(--lightBlue)', matches: type => type >= 60 && type <= 69 },
  { label: "High speed craft", color: '#e0a21b', matches: type => type >= 40 && type <= 49 },
  { label: "Fishing", color: '#ef7d3c', matches: type => type == 30 },
  { label: "Recreational", color: '#a05cc4', matches: type => type == 36 || type == 37 },
  { label: "Service vessel", color: '#1fa3a3', matches: type => [31, 32, 33, 34, 35, 50, 51, 52, 53, 54, 55, 58].includes(type) },
  { label: "Other", color: '#7d8a99', matches: () => true },
];

// Boats without AIS whose position comes from a phone, and the BlueLab's autonomous vehicles
const isPati = (ship) => String(ship.MMSI).startsWith('PATI-');
const isBlueBoat = (ship) => String(ship.MMSI).startsWith('BLUEBOAT-');

function shipCategory(ship) {
  if (isPati(ship)) return { label: "Sailing dinghy", color: '#e5397a' };
  if (isBlueBoat(ship)) return { label: "Autonomous vehicle", color: '#e8b400' };
  if (String(ship.MMSI).startsWith('99')) return { label: "Aid to navigation", color: 'var(--darkBlue)' };
  return SHIP_CATEGORIES.find(category => category.matches(Number(ship.shipTypeId)));
}

// Heading in degrees, or undefined: 511 means not available, then the one inferred from the track
function shipHeading(ship) {
  if (ship.heading != undefined && ship.heading != 511) return Number(ship.heading);
  if (ship.empiricHeading != undefined) return Number(ship.empiricHeading);
  return undefined;
}

// Everything its card shows, with texts through t (the app's i18n):
//   title, tag ({text, simulated} or undefined: ours or simulated), category ({label, color}),
//   minutes (since its last report), rows ([{label, value, heading}]: heading, for an arrow),
//   link ({href, text}) or note: for a BlueBoat, its fleet tracker while it answers
function vesselInfo(ship, t) {
  const heading = shipHeading(ship);
  const rows = [];
  if (ship.sog != undefined) rows.push({ label: t("Speed"), value: `${Number(ship.sog).toFixed(1)} kn (${(ship.sog * 1.852).toFixed(1)} km/h)` });
  if (heading != undefined) rows.push({ label: t("Heading"), value: `${heading.toFixed(0)}°`, heading });
  if (ship.length > 0 && ship.beam > 0) rows.push({ label: t("Size"), value: `${ship.length} × ${ship.beam} m` });
  if (!isPati(ship) && !isBlueBoat(ship)) rows.push({ label: 'MMSI', value: ship.MMSI });
  const telemetry = ship.telemetry || {};
  if (telemetry.battery != undefined) rows.push({ label: t("Battery"), value: `${telemetry.battery.toFixed(1)} V` });
  if (telemetry.lorawan_temp != undefined) rows.push({ label: t("Temperature inside"), value: `${telemetry.lorawan_temp.toFixed(1)} ºC` });

  const own = window.OwnAssets?.ownGroupOf(ship.MMSI);
  const tag = ship.simulated ? { text: t("Simulated"), simulated: true }
    : own ? { text: t("Own equipment") + (own.owner ? ' · ' + own.owner : '') } : undefined;

  let link, note;
  if (isBlueBoat(ship) && !ship.simulated) {
    // The BlueLab's tracker runs on a lab computer: while it doesn't answer, a note instead
    const fleet = window.AISManager?.fleet;
    if (fleet?.up && fleet.url) link = { href: fleet.url, text: t("See on the fleet tracker") };
    else note = t("The fleet tracker is not available now");
  }

  return {
    title: ship.shipName, tag, category: shipCategory(ship),
    minutes: (Date.now() - new Date(ship.lastTmst).getTime()) / 60000,
    rows, link, note,
  };
}

// "x min ago", from minutes, with the app's i18n (timeAgo.*)
function timeAgo(minutes, t) {
  if (isNaN(minutes)) return '';
  const hours = minutes / 60;
  if (minutes < 1) return t('timeAgo.now');
  if (hours < 1) return t('timeAgo.minutes', { n: Math.floor(minutes) });
  if (hours < 2) return t('timeAgo.hour');
  if (hours < 24) return t('timeAgo.hours', { n: Math.floor(hours) });
  const days = Math.floor(hours / 24);
  if (days === 1) return t('timeAgo.day');
  if (days <= 7) return t('timeAgo.days', { n: days });
  return t('timeAgo.moreThanWeek');
}

export { SHIP_CATEGORIES, isPati, isBlueBoat, shipCategory, shipHeading, vesselInfo, timeAgo };
