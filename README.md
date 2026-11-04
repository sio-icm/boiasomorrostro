# Boia Somorrostro · SIO ICM-CSIC

Digital twin of the buoy station in front of Barcelona (Somorrostro beach), maintained by the
Oceanographic Engineering Service (SIO) of the Institut de Ciències del Mar (ICM-CSIC).

## Original project

This is a fork of [Boia Somorrostro](https://github.com/ICATMAR/boiasomorrostro), created by
Gerard Llorach at [ICATMAR](https://icatmar.cat) (ICM-CSIC), who also provides the buoy data.
See the [original web application](https://icatmar.github.io/boiasomorrostro/). To cite it:

- Llorach Tó, G., Martí Comas, A., Pitarch Claramunt, X., Ribera Altimir, J., Molina, D., Casals Baixas, C., ... & Ballabrera Poy, J. (2025). Data flow, infrastructure, harmonization and 3d visualization: the use case of somorrostro's moored buoy's deployment. Instrumentation viewpoint, (24), 32-33.

## Changes in this version

- New look for the sea: tone mapping, foam and sky reflections.
- Marine map: bathymetry and isobaths, nautical marks, wind, current and sea temperature
  forecasts, the 3D camera's view cone, AIS ships by type with their trails, a wind rose,
  the other buoys of ICATMAR's network and a distance ruler.
- Branding of the SIO, ICM-CSIC.

## Running it locally

The app expects to be served from `/boiasomorrostro/`, so serve the parent folder:

```bash
python3 dev_server.py 8765
```

and open http://localhost:8765/boiasomorrostro/. `dev_server.py` also proxies the ERDDAP
requests, which the servers don't allow from localhost.

ICATMAR's AIS feed only accepts its own website, so locally the ships come from
[aisstream.io](https://aisstream.io) (free, needs an API key) through `ais_relay.py`. Put the key
in a `.env` file (not in git) as `AISSTREAM_API_KEY=...`, then:

```bash
python3 ais_relay.py
```
