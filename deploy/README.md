# Poner el servidor del SIO en marcha

## Dónde está publicada ahora

En **https://iot.icm.csic.es/boiasomorrostro/**, una máquina virtual del ICM (solo accesible por
SSH con la VPN del CMIMA). Allí todo va con nginx, sin túnel:

| Qué | Dónde |
|---|---|
| La web | `/var/www/boiasomorrostro` (la raíz `/` redirige a `/boiasomorrostro/`) |
| `boia_server.py` | `/opt/boiasomorrostro`, con su `.env` y un `venv` (`websockets` ≥ 10), servicio `boiasomorrostro` |
| nginx | `/etc/nginx/conf.d/boiasomorrostro.conf`, copia en [`nginx-boiasomorrostro.conf`](nginx-boiasomorrostro.conf) |
| HTTPS | certificado de Let's Encrypt (`certbot`, nombre `iot.cmima.csic.es`) |

Rutas: `/ais` (WebSocket, al puerto 8766), `/proxy/` y `/pati` (al 8767). En Traccar Client, la
dirección del servidor es `https://iot.icm.csic.es/pati`.

Para subir una versión nueva de la web, desde el repositorio:

```bash
git ls-files | grep -v -E '^(deploy/|tools/)|\.(py|blend)$|(^|/)\.' > /tmp/web.txt && rsync -az --delete --files-from=/tmp/web.txt ./ bardaji@iot.icm.csic.es:/var/www/boiasomorrostro/
```

Se queda fuera lo que no es de la web: `deploy/`, `tools/`, los `.py` (el servidor va aparte), los
`.blend` (originales de Blender de los modelos) y los archivos ocultos (`.gitignore`, `.env.example`...).

Y si cambia `boia_server.py`:

```bash
scp boia_server.py bardaji@iot.icm.csic.es:/opt/boiasomorrostro/ && ssh bardaji@iot.icm.csic.es sudo systemctl restart boiasomorrostro
```

nginx hace que el navegador compruebe el código (`.html`, `.js`, `.vue`, `.css`) en cada visita, así que
una versión nueva se ve al recargar normal. Las imágenes y modelos 3D se guardan 7 días: si se cambia
uno, conviene darle otro nombre.

Ojo: el `websockets` de Ubuntu 22.04 (9.1) es demasiado antiguo; por eso el `venv`.

En su `.env`, además de la clave y `BOIA_ORIGINS`: `BOIA_HTTP_HOST=127.0.0.1` (el puerto 8767 solo
se usa a través de nginx) y sin `PATI_SIMULATOR`, para que nadie pueda enviar un patí falso.

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

Con `SIMULATED_BOATS=1` en el `.env`, el propio `boia_server.py` saca siempre un BlueBoat y un patí
simulados cerca de la boya, para enseñar la web aunque no haya nada nuestro en el agua. En la web
salen como «Simulado». No abre la entrada de posiciones a nadie (eso es `PATI_SIMULATOR`, que en el
servidor sigue apagado). Para quitarlos, vaciarla y reiniciar el servicio.

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
