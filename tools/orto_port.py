"""Downloads the ICGC orthophoto of the port of Barcelona and makes its water transparent.
Usage: python3 tools/orto_port.py Assets/Terrain/PortGround   (needs numpy, pillow, scipy)
Orthophoto: Institut Cartogràfic i Geològic de Catalunya (ICGC), CC BY 4.0"""
import sys, io, urllib.request
import numpy as np
from PIL import Image
from scipy import ndimage

# Port box (keep in sync with Assets/Terrain/PortGround/PortGroundEntity.js)
SOUTH, NORTH, WEST, EAST = 41.315, 41.3676, 2.125, 2.1886
W, H = 3712, 4096
out = sys.argv[1]

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
# Clean up: smooth, drop specks of land on the water (boats, foam) and fill water specks on land
water = ndimage.binary_opening(water, iterations=2)
water = ndimage.binary_closing(water, iterations=2)
land = ~water
labels, n = ndimage.label(land)
sizes = ndimage.sum(land, labels, range(1, n + 1))
land = np.isin(labels, np.nonzero(sizes >= 3000)[0] + 1)   # ~6000 m²: ships and buoys go
labels, n = ndimage.label(~land)
sizes = ndimage.sum(~land, labels, range(1, n + 1))
land |= np.isin(labels, np.nonzero(sizes < 6000)[0] + 1)    # dark roofs, shadows
mask = Image.fromarray((land * 255).astype(np.uint8))

img.save(f'{out}/port.jpg', quality=82, optimize=True, progressive=True)
mask.save(f'{out}/port_mask.png', optimize=True)
# Half size, for phones (see PortGroundEntity)
img.resize((W // 2, H // 2), Image.LANCZOS).save(f'{out}/port_small.jpg', quality=82, optimize=True, progressive=True)
mask.resize((W // 2, H // 2), Image.BILINEAR).point(lambda v: 255 if v >= 128 else 0).save(f'{out}/port_mask_small.png', optimize=True)
img.resize((928, 1024)).save(f'{out}/preview.jpg', quality=80)
Image.composite(img, Image.new('RGB', img.size, (255, 0, 255)), mask).resize((928, 1024)).save(f'{out}/preview_mask.jpg', quality=80)
print('land fraction', land.mean())
