"""Slims a GLB (standard library only). Each step only applies where it still can, so it can be
run again on its own output:
- keeps only the WebP images when every texture is there twice (WebP + PNG fallback,
  EXT_texture_webp)
- quantizes (KHR_mesh_quantization, read natively by three.js) NORMAL to normalized int8,
  TEXCOORD_0 to normalized uint16 when inside [0, 1], and POSITION to normalized int16: each
  mesh then hangs from a child node that scales it back (uniform scale, so normals stay right)

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


# 1. Images: keep the WebP ones only (when there are both)
if not any('EXT_texture_webp' in texture.get('extensions', {}) for texture in gltf.get('textures', [])):
    gltf['images'] = [dict(image, bufferView=add_chunk(view_bytes(image['bufferView']))) for image in gltf.get('images', [])]
webp_images = {}
if any('EXT_texture_webp' in texture.get('extensions', {}) for texture in gltf.get('textures', [])):
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

# 2. Accessors: copy, quantizing normals, texture coordinates and positions (if still floats)
FLOAT = 5126
quantized = set()
position_mesh = {}  # position accessor -> its mesh
for mesh_index, mesh in enumerate(gltf['meshes']):
    for primitive in mesh['primitives']:
        for name, index in primitive['attributes'].items():
            if name in ('NORMAL', 'TEXCOORD_0', 'POSITION') and gltf['accessors'][index]['componentType'] == FLOAT:
                quantized.add((index, name))
            if name == 'POSITION':
                position_mesh[index] = mesh_index
kind = dict(quantized)
# Positions: one centre and (uniform) half size per mesh, from its primitives' bounds
mesh_bounds = {}
for index, mesh_index in position_mesh.items():
    if kind.get(index) != 'POSITION':
        continue
    accessor = gltf['accessors'][index]
    low, high = mesh_bounds.get(mesh_index, (accessor['min'], accessor['max']))
    mesh_bounds[mesh_index] = ([min(a, b) for a, b in zip(low, accessor['min'])], [max(a, b) for a, b in zip(high, accessor['max'])])
mesh_transform = {m: ([(lo + hi) / 2 for lo, hi in zip(*b)], max(max((hi - lo) / 2 for lo, hi in zip(*b)), 1e-6))
                  for m, b in mesh_bounds.items()}
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
    elif name == 'POSITION' and position_mesh[index] in mesh_transform:
        center, half = mesh_transform[position_mesh[index]]
        packed = array('h')
        for i in range(0, len(values), 3):
            packed.extend(round((values[i + k] - center[k]) / half * 32767) for k in range(3))
            packed.append(0)  # 4-byte aligned vertices
        accessor.update(componentType=5122, normalized=True,
                        min=[min(packed[k::4]) / 32767 for k in range(3)], max=[max(packed[k::4]) / 32767 for k in range(3)])
        accessor.pop('byteOffset', None)
        accessor['bufferView'] = add_chunk(packed.tobytes(), 34962, 8)
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

# Each quantized mesh hangs from a new child node that puts it back in place
for node in list(gltf['nodes']):
    mesh_index = node.get('mesh')
    if mesh_index in mesh_transform:
        center, half = mesh_transform[mesh_index]
        gltf['nodes'].append({'mesh': mesh_index, 'translation': center, 'scale': [half] * 3})
        node.setdefault('children', []).append(len(gltf['nodes']) - 1)
        del node['mesh']

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
