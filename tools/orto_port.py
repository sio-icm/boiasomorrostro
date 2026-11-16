"""Downloads the ICGC orthophoto of a port and makes its water transparent.
Usage: python3 tools/orto_port.py [port|olimpic] Assets/Terrain/PortGround   (needs numpy, pillow, scipy)
  port: the port of Barcelona (port.jpg...); olimpic: the Port Olímpic marina (olimpic.jpg...)
Orthophoto: Institut Cartogràfic i Geològic de Catalunya (ICGC), CC BY 4.0"""
import sys, io, urllib.request
import numpy as np
from PIL import Image
from scipy import ndimage

# Each area: its box (keep in sync with Assets/Terrain/PortGround/PortGroundEntity.js), its size in
# pixels, and how the mask is cleaned up: opening iterations (more, the thinner the land that goes),
# and the smallest specks of land and of water kept, in pixels
AREAS = {
    # ~1.4 m a pixel: ships and buoys go, dark roofs and shadows are filled
    'port': dict(box=(41.315, 41.3676, 2.125, 2.1886), size=(3712, 4096), opening=2, land=3000, water=6000),
    # ~0.33 m a pixel: the pontoons (a few metres wide) and the moored boats stay
    # Its basin, sheltered, is dark grey-green rather than blue: water too, below `dark`
    'olimpic': dict(box=(41.3830, 41.3890, 2.1975, 2.2045), size=(1792, 2048), opening=1, land=150, water=3000, dark=110),
}
name, out = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ('port', sys.argv[1])
area = AREAS[name]
SOUTH, NORTH, WEST, EAST = area['box']
W, H = area['size']

url = ('https://geoserveis.icgc.cat/servei/catalunya/orto-territorial/wms?SERVICE=WMS&VERSION=1.3.0'
       '&REQUEST=GetMap&LAYERS=ortofoto_color_vigent&STYLES=&CRS=EPSG:4326'
       f'&BBOX={SOUTH},{WEST},{NORTH},{EAST}&WIDTH={W}&HEIGHT={H}&FORMAT=image/png')
img = Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=300).read())).convert('RGB')
rgb = np.asarray(img).astype(np.int16)
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

# Water: bluer/greener than red, not bright; plus the white no-data corner (open sea)
water = (b > r + 12) & (g >= r) & (np.maximum(g, b) < 150)
nodata = ((r > 250) & (g > 250) & (b > 250)) | ((r < 8) & (g < 8) & (b < 8))
water |= (np.maximum(np.maximum(r, g), b) < 70) & (b >= r)  # dark sea in the shade of the breakwater
water |= nodata
if 'dark' in area:
    water |= (np.maximum(np.maximum(r, g), b) < area['dark']) & (g >= r) & (b >= r - 4)
# Clean up: smooth, drop specks of land on the water (boats, foam) and fill water specks on land
water = ndimage.binary_opening(water, iterations=area['opening'])
water = ndimage.binary_closing(water, iterations=area['opening'])
land = ~water
labels, n = ndimage.label(land)
sizes = ndimage.sum(land, labels, range(1, n + 1))
land = np.isin(labels, np.nonzero(sizes >= area['land'])[0] + 1)
labels, n = ndimage.label(~land)
sizes = ndimage.sum(~land, labels, range(1, n + 1))
land |= np.isin(labels, np.nonzero(sizes < area['water'])[0] + 1)
mask = Image.fromarray((land * 255).astype(np.uint8))

img.save(f'{out}/{name}.jpg', quality=82, optimize=True, progressive=True)
mask.save(f'{out}/{name}_mask.png', optimize=True)
# Half size, for phones (see PortGroundEntity)
img.resize((W // 2, H // 2), Image.LANCZOS).save(f'{out}/{name}_small.jpg', quality=82, optimize=True, progressive=True)
mask.resize((W // 2, H // 2), Image.BILINEAR).point(lambda v: 255 if v >= 128 else 0).save(f'{out}/{name}_mask_small.png', optimize=True)
preview = (W * 1024 // H, 1024)
img.resize(preview).save(f'{out}/{name}_preview.jpg', quality=80)
Image.composite(img, Image.new('RGB', img.size, (255, 0, 255)), mask).resize(preview).save(f'{out}/{name}_preview_mask.jpg', quality=80)
print('land fraction', land.mean())
