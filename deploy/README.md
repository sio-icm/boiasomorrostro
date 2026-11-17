# Poner el servidor del SIO en marcha

## Dónde está publicada ahora

En **https://iot.icm.csic.es/boiasomorrostro/**, una máquina virtual del ICM (solo accesible por
SSH con la VPN del CMIMA). Allí todo va con nginx, sin túnel:

| Qué | Dónde |
|---|---|
| La web | `/var/www/boiasomorrostro` (la raíz `/` redirige a `/boiasomorrostro/`) |
| `boia_server.py` | `/opt/boiasomorrostro`, con su `.env` y un `venv` (`websockets` ≥ 10, `psycopg`), servicio `boiasomorrostro` |
| Base de datos | PostgreSQL + PostGIS en Docker, contenedor `boia-db` (ver «Base de datos») |
| Intranet | `/boiasomorrostro/intranet/`, con usuario y contraseña (ver «Histórico del AIS de la boya e intranet») |
| nginx | `/etc/nginx/conf.d/boiasomorrostro.conf`, copia en [`nginx-boiasomorrostro.conf`](nginx-boiasomorrostro.conf) |
| HTTPS | certificado de Let's Encrypt (`certbot`, nombre `iot.cmima.csic.es`) |

Rutas: `/ais` (WebSocket, al puerto 8766), `/proxy/`, `/pati` y `/boiasomorrostro/intranet/api/` (al 8767). En Traccar Client, la
dirección del servidor es `https://iot.icm.csic.es/pati`.

Para subir una versión nueva de la web, desde el repositorio:

```bash
git ls-files | grep -v -E '^(deploy/|tools/)|\.(py|blend)$|(^|/)\.' > /tmp/web.txt && rsync -az --delete --files-from=/tmp/web.txt ./ bardaji@iot.icm.csic.es:/var/www/boiasomorrostro/
```

Se queda fuera lo que no es de la web: `deploy/`, `tools/`, los `.py` (el servidor va aparte), los
`.blend` (originales de Blender de los modelos) y los archivos ocultos (`.gitignore`, `.env.example`...).

Y si cambia el servidor (`boia_server.py`, `erddap_mirror.py`, `boia_db.py`, `buoy_ais.py` o
`deploy/postgres/`):

```bash
rsync -az -R boia_server.py erddap_mirror.py boia_db.py buoy_ais.py deploy/postgres/ bardaji@iot.icm.csic.es:/opt/boiasomorrostro/ && ssh bardaji@iot.icm.csic.es sudo systemctl restart boiasomorrostro
```

nginx hace que el navegador compruebe el código (`.html`, `.js`, `.vue`, `.css`) en cada visita, así que
una versión nueva se ve al recargar normal. Las imágenes y modelos 3D se guardan 7 días: si se cambia
uno, conviene darle otro nombre.

Ojo: el `websockets` de Ubuntu 22.04 (9.1) es demasiado antiguo; por eso el `venv`.

En su `.env`, además de la clave y `BOIA_ORIGINS`: `BOIA_HTTP_HOST=127.0.0.1` (el puerto 8767 solo
se usa a través de nginx) y sin `PATI_SIMULATOR`, para que nadie pueda enviar un patí falso.

### Copia local de los datos de las boyas

El proxy no pide al ERDDAP los datos de las boyas: los contesta desde una copia en
`/opt/boiasomorrostro/erddap_mirror.sqlite` (`erddap_mirror.py`), que `boia_server.py` pone al día
cada 5 min con las filas nuevas de cada ERDDAP (`erddap.icatmar.cat` y `hebe.icm.csic.es`). Copia
todos los datasets de Somorrostro (`BUOY_SOMO_*`) y el viento, oleaje y CTD de las otras boyas de
la red. Así, si un ERDDAP falla o deja de listar las boyas un tiempo, la web sigue con lo que tenía.

- La primera vez descarga todo el histórico que tenga el ERDDAP, por meses; lo que el ERDDAP ya no
  tiene no se puede recuperar.
- En el registro salen las filas nuevas (`ERDDAP copy: ...`) y cuándo un ERDDAP deja de contestar
  o vuelve (`❌ ERDDAP ... not answering` / `✅ ERDDAP ... copied`).
- Para empezar de cero, parar el servicio, borrar `erddap_mirror.sqlite*` y arrancarlo; para
  desactivarla, `ERDDAP_MIRROR=0` en el `.env`.

### Base de datos

Todos los datos que guardamos van a una sola base de datos, **PostgreSQL con PostGIS**, en Docker
en la misma máquina: contenedor `boia-db`, definido en [`postgres/docker-compose.yml`](postgres/docker-compose.yml),
con sus datos en el volumen `boia-db`. Las tablas las crea `boia_db.py` al arrancar
([`postgres/schema.sql`](postgres/schema.sql)):

- `platforms`: cada equipo (la boya, la Pelagia, cada BlueBoat...), con el id que le da la app
  (su MMSI, o `BLUEBOAT-<id>`).
- `positions`: dónde estuvo cada uno y cuándo, y de dónde viene el dato (`source`): `tugemi` (los
  CSV de la boya), `aisstream` (la Pelagia) y `bluelab` (los BlueBoats). Con `geom` para consultas
  espaciales.

En `/opt/boiasomorrostro/.env` están `POSTGRES_PASSWORD` y `DATABASE_URL`. Para ponerla en marcha
(una vez):

```bash
cd /opt/boiasomorrostro/deploy/postgres && sudo docker compose --env-file ../../.env up -d
```

**Para entrar desde tu ordenador** (DBeaver, pgAdmin, `psql`...), con la VPN, por un túnel SSH:

```bash
ssh -N -L 5433:localhost:5432 bardaji@iot.icm.csic.es
```

y conectar a `localhost`, puerto `5433`, base de datos `boia`, usuario `boia`, con la contraseña
`POSTGRES_PASSWORD` del `.env` del servidor.

**Copias de seguridad**: [`postgres/backup.sh`](postgres/backup.sh), cada noche a las 3:30 (cron,
`/etc/cron.d/boiasomorrostro-backup`), deja un `pg_dump` en `/var/backups/boiasomorrostro/` y
guarda 30 días. Para bajarte la última:

```bash
scp "bardaji@iot.icm.csic.es:/var/backups/boiasomorrostro/boia-$(date +%F).dump" ~/
```

**En local**, la misma base de datos con Docker (con `POSTGRES_PASSWORD` y `DATABASE_URL` en el
`.env` local) y psycopg instalado en `.pylib/`, porque no hay pip:

```bash
cd deploy/postgres && docker compose --env-file ../../.env up -d
```

```bash
docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v $PWD:/w python:3.12 pip install -q --target /w/.pylib "psycopg[binary]"
```

```bash
PYTHONPATH=.pylib python3 -u boia_server.py
```

### Histórico de nuestros equipos

`boia_server.py` guarda en `positions` cada posición de la Pelagia Primer (AIS) y de los
BlueBoats (no del simulado) a medida que llega, es decir, solo mientras están fuera emitiendo. Los
patís, todavía no.

### Histórico del AIS de la boya e intranet

La boya emite AIS como ayuda a la navegación (MMSI 992241239, «ODAS SOMORROSTRO»), pero
aisstream.io no pasa esos mensajes. Su histórico se descarga a mano en CSV de la base de datos AIS
TUGEMI de la UPC (https://ais.fnb.upc.edu/database/multi-info, «By Multi MMSIs», todos los campos;
pide reCAPTCHA, así que no se puede automatizar) y **se sube en la intranet**,
https://iot.icm.csic.es/boiasomorrostro/intranet/ (no está enlazada desde la web; pide usuario y
contraseña). Las filas repetidas no se duplican.

Al subirlo, `boia_server.py` lo añade a la base de datos (`buoy_ais.py`) y vuelve a escribir los
ficheros de la boya para la app en `/opt/boiasomorrostro/buoy_data/` (`BUOY_DATA_DIR`), que nginx
sirve en lugar de los de git (`data/StaticData/buoy_*`): `buoy_ais.json` y `buoy_ais_track.json`
(la capa «La boya» del mapa y su barra de tiempo) y `buoy_position.js`, su última posición
conocida, que es donde la app pone la boya. Se ve al recargar la web.

**Usuarios de la intranet**: en `/etc/nginx/boiasomorrostro-intranet.htpasswd`. Para añadir uno
o cambiarle la contraseña, en el servidor (pide el usuario y luego la contraseña, dos veces):

```bash
read -p "Usuario: " U && echo "$U:$(openssl passwd -apr1)" | sudo tee -a /etc/nginx/boiasomorrostro-intranet.htpasswd > /dev/null
```

(Si el usuario ya estaba, borrar antes su línea de ese fichero.)

También se puede importar desde un ordenador con acceso a la base de datos:

```bash
PYTHONPATH=.pylib python3 buoy_ais.py ~/Descargas/vessel_info_992241239_*.csv
```

### Vehículos del BlueLab (BlueBoat)

`boia_server.py` lee el tracker público de la flota del BlueLab
([BlueLab-ICM/dashboard-public](https://github.com/BlueLab-ICM/dashboard-public)), en `FLEET_URL`
del `.env`, y reenvía sus vehículos como el patí. Solo salen los vistos en las últimas
`FLEET_MAX_HOURS` (6 por defecto), es decir, cuando están en campaña, y nunca sus simulados (`sim-`).

**Si el tracker deja de funcionar** (funciona desde un ordenador del laboratorio, publicado con
Tailscale Funnel), no se rompe nada:
- el servidor lo reintenta solo: su WebSocket cada minuto y la lista de vehículos cada 5 min;
- en la web, los vehículos desaparecen al cabo de 30 min sin datos;
- la ficha de un vehículo cambia el enlace al panel por el aviso «El panel de la flota no está
  disponible ahora».

En el registro del servicio sale `❌ BlueLab fleet tracker not answering` (`journalctl -u
boiasomorrostro`). Qué hacer:
- **si ha cambiado de dirección**, poner la nueva en `FLEET_URL` y reiniciar el servicio;
- **si ya no existe o no se quiere**, dejar `FLEET_URL` vacía y reiniciar: se desactiva del todo;
- **si ha cambiado su formato** (su API está en desarrollo), adaptar la parte «BLUELAB'S FLEET» de
  `boia_server.py`, la única que depende de él.

### Barcos simulados

Con `SIMULATED_BOATS` en el `.env`, el propio `boia_server.py` saca siempre barcos simulados cerca
de la boya, para enseñar la web aunque no haya nada nuestro en el agua: `blueboat`, `pati` (separados
por comas) o `1` para los dos. En el servidor está `SIMULATED_BOATS=blueboat`. En la web salen como
«Simulado». No abre la entrada de posiciones a nadie (eso es `PATI_SIMULATOR`, que en el servidor
sigue apagado). Para quitarlos, vaciarla y reiniciar el servicio.

## En otro servidor

La web es estática (GitHub Pages, por ejemplo), pero necesita un pequeño servidor para lo que el
navegador no puede pedir directamente a los servicios de ICATMAR, que solo aceptan su propia web:

| Qué | Por qué | Dónde |
|---|---|---|
| Datos de la boya (ERDDAP) | Los ERDDAP rechazan las peticiones de navegadores | `boia_server.py`, `/proxy/` |
| Barcos AIS | El AIS de ICATMAR solo acepta `icatmar.github.io` | `boia_server.py`, `/ais`, con aisstream.io |
| Patí (posiciones del móvil) | Hace falta una dirección pública | `boia_server.py`, `/` |

Todo es un único programa, `boia_server.py`, que también se usa en local. Abajo, los pasos en
un servidor Linux (por ejemplo, el del ICM).

## 1. Copiar el código y preparar Python

```bash
sudo useradd --system --create-home boia
sudo git clone https://github.com/sio-icm/boiasomorrostro.git /opt/boiasomorrostro
sudo chown -R boia: /opt/boiasomorrostro
cd /opt/boiasomorrostro
sudo -u boia python3 -m venv venv
sudo -u boia venv/bin/pip install -r deploy/requirements.txt
```

## 2. Configurar

```bash
sudo -u boia cp .env.example .env
sudo -u boia nano .env
```

- `AISSTREAM_API_KEY`: la clave de aisstream.io.
- `BOIA_ORIGINS`: la dirección de la web publicada, p. ej. `https://sio-icm.github.io`.
- `PATI_DEVICES`: los móviles que envían posiciones, `identificador:Nombre`.
- `BOIA_HTTP_HOST`: `127.0.0.1` si el servidor está detrás de nginx (si no, vacío).
- `PATI_SIMULATOR`: `1` solo para probar con `tools/simulate_pati.py`; nunca en un servidor público.

## 3. Arrancarlo como servicio

```bash
sudo cp deploy/boia-server.service /etc/systemd/system/
sudo systemctl enable --now boia-server
journalctl -u boia-server -f
```

Debe decir `Connected to aisstream.io` y la lista de orígenes permitidos.

## 4. Darle HTTPS con un túnel de Cloudflare

La web va por HTTPS, así que el servidor también. Un túnel de Cloudflare lo da gratis, sin abrir
puertos en el router ni en el ICM. Hace falta un dominio gestionado en Cloudflare (o pedir uno
al ICM).

```bash
# Instalar cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel login
cloudflared tunnel create boia
cloudflared tunnel route dns boia boia.example.org
cp deploy/cloudflared.yml ~/.cloudflared/config.yml   # y poner el id del túnel y el nombre
sudo cloudflared service install
```

Si el ICM ya da un nombre con HTTPS al servidor (con nginx, por ejemplo), no hace falta el túnel:
basta con enviar `/ais` al puerto 8766 (WebSocket) y el resto al 8767.

## 5. Decirle a la web dónde está

En `Assets/Scripts/config.js`, poner la dirección en `SIO_SERVER`:

```js
const SIO_SERVER = 'https://boia.example.org';
```

y publicar la web.

## 6. Comprobarlo

```bash
# Proxy: debe devolver la última temperatura del agua
curl "https://boia.example.org/proxy/?url=https%3A%2F%2Ferddap.icatmar.cat%2Ferddap%2Ftabledap%2FBUOY_SOMO_CTD.csv%3Ftime%2CTEMP%26orderByMax(%22time%22)"
# Patí simulado durante un rato
python3 tools/simulate_pati.py https://boia.example.org/   # con PATI_SIMULATOR=1
```

En la app del móvil (Traccar Client), la dirección del servidor es `https://boia.example.org/`.
