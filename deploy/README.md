# Poner el servidor del SIO en marcha

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
python3 tools/simulate_pati.py https://boia.example.org/
```

En la app del móvil (Traccar Client), la dirección del servidor es `https://boia.example.org/`.
