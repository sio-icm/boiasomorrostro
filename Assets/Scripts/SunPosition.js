// Position of the sun in the sky for a place and moment: elevation above the horizon and azimuth
// (clockwise from north), in degrees. NOAA's simplified solar position equations, good to a
// fraction of a degree, plenty for lighting the scene.
// https://gml.noaa.gov/grad/solcalc/solareqns.PDF

function sunPosition(date, latitude, longitude) {
  const rad = Math.PI / 180;
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date - start) / 86400000) + 1;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + (hours - 12) / 24); // fractional year

  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)); // minutes
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  const solarMinutes = hours * 60 + equationOfTime + 4 * longitude;
  const hourAngle = (solarMinutes / 4 - 180) * rad;
  const lat = latitude * rad;

  const cosZenith = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const elevation = 90 - zenith / rad;
  // Azimuth from north, clockwise
  const azimuth = (Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat)) / rad + 180) % 360;
  return { elevation, azimuth };
}

export { sunPosition };
