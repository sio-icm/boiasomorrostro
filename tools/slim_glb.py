"""Slims a GLB that carries every texture twice (WebP + PNG fallback, EXT_texture_webp):
keeps only the WebP images, and quantizes NORMAL to normalized int8 and TEXCOORD_0 to
normalized uint16 (standard library only) when inside [0, 1] (KHR_mesh_quantization, read natively by three.js).

Usage: python3 slim_glb.py in.glb out.glb
"""
import json
import struct
import sys

from array import array

COMPONENT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
json_len = struct.unpack('<I', data[12:16])[0]
gltf = json.loads(data[20:20 + json_len])
bin_start = 20 + json_len + 8
blob = data[bin_start:bin_start + struct.unpack('<I', data[20 + json_len:24 + json_len])[0]]


def view_bytes(index):
    view = gltf['bufferViews'][index]
    start = view.get('byteOffset', 0)
    return blob[start:start + view['byteLength']]


def read_accessor(accessor):
    """Flat array of the accessor's components (tightly packed)"""
    view = gltf['bufferViews'][accessor['bufferView']]
    code = COMPONENT[accessor['componentType']]
    width = WIDTH[accessor['type']]
    size = array(code).itemsize
    stride = view.get('byteStride', 0) or width * size
    raw = view_bytes(accessor['bufferView'])
    offset = accessor.get('byteOffset', 0)
    if stride == width * size:
        return array(code, raw[offset:offset + accessor['count'] * stride])
    values = array(code)
    for i in range(accessor['count']):
        values.frombytes(raw[offset + i * stride:offset + i * stride + width * size])
    return values


# New list of chunks: (bytes, target, stride) per buffer view, rebuilt from scratch
chunks = []
new_views = {}


def add_chunk(raw, target=None, stride=None):
    chunks.append((raw, target, stride))
    return len(chunks) - 1


# 1. Images: keep the WebP ones only
webp_images = {}
for index, image in enumerate(gltf['images']):
    if image['mimeType'] == 'image/webp':
        webp_images[index] = image
for texture in gltf['textures']:
    texture['source'] = texture['extensions']['EXT_texture_webp']['source']
    del texture['extensions']
image_map = {old: new for new, old in enumerate(sorted(webp_images))}
gltf['images'] = [dict(webp_images[old], bufferView=add_chunk(view_bytes(webp_images[old]['bufferView'])))
                  for old in sorted(webp_images)]
for texture in gltf['textures']:
    texture['source'] = image_map[texture['source']]

# 2. Accessors: copy, quantizing normals and texture coordinates
quantized = set()
for mesh in gltf['meshes']:
    for primitive in mesh['primitives']:
        for name, index in primitive['attributes'].items():
            if name in ('NORMAL', 'TEXCOORD_0'):
                quantized.add((index, name))
kind = dict(quantized)
for index, accessor in enumerate(gltf['accessors']):
    values = read_accessor(accessor)
    name = kind.get(index)
    if name == 'NORMAL':
        packed = array('b')
        for i in range(0, len(values), 3):
            packed.extend(round(max(-1.0, min(1.0, v)) * 127) for v in values[i:i + 3])
            packed.append(0)  # 4-byte aligned vertices
        accessor.update(componentType=5120, normalized=True)
        accessor.pop('byteOffset', None)
        accessor['bufferView'] = add_chunk(packed.tobytes(), 34962, 4)
    elif name == 'TEXCOORD_0' and min(values) >= 0 and max(values) <= 1:
        packed = array('H', (round(v * 65535) for v in values))
        accessor.update(componentType=5123, normalized=True)
        for key in ('byteOffset', 'min', 'max'):
            accessor.pop(key, None)
        accessor['bufferView'] = add_chunk(packed.tobytes(), 34962, None)
    else:
        target = gltf['bufferViews'][accessor['bufferView']].get('target')
        accessor.pop('byteOffset', None)
        accessor['bufferView'] = add_chunk(values.tobytes(), target, None)

# 3. Rebuild the binary buffer, 4-byte aligned
out = bytearray()
gltf['bufferViews'] = []
for raw, target, stride in chunks:
    while len(out) % 4:
        out.append(0)
    view = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(raw)}
    if target:
        view['target'] = target
    if stride:
        view['byteStride'] = stride
    gltf['bufferViews'].append(view)
    out += raw
while len(out) % 4:
    out.append(0)
gltf['buffers'] = [{'byteLength': len(out)}]
used = [e for e in gltf.get('extensionsUsed', []) if e != 'EXT_texture_webp'] + ['KHR_mesh_quantization']
gltf['extensionsUsed'] = used
gltf['extensionsRequired'] = ['KHR_mesh_quantization']

text = json.dumps(gltf, separators=(',', ':')).encode()
text += b' ' * (-len(text) % 4)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(text) + 8 + len(out)))
    f.write(struct.pack('<II', len(text), 0x4E4F534A) + text)
    f.write(struct.pack('<II', len(out), 0x004E4942) + bytes(out))
print(f'{len(data) / 2**20:.1f} MB -> {(28 + len(text) + len(out)) / 2**20:.1f} MB')
