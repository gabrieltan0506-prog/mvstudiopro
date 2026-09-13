"""独立小GLB资源门禁审查：仅普通Python预检，绝不调用Blender或图片解压。"""
import copy
import importlib.util
import json
from pathlib import Path
import struct
import sys
import zlib

loader = importlib.util.spec_from_file_location('audited_previs', Path(__file__).with_name('previs_rigged_model.py'))
module = importlib.util.module_from_spec(loader)
loader.loader.exec_module(module)
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
assert not (out/'resource-audit.json').exists(), '不得覆盖旧证据'

def add_view(doc, binary, data):
    binary.extend(b'\0' * (-len(binary) % 4))
    i = len(doc['bufferViews'])
    doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data)})
    binary.extend(data)
    doc['buffers'][0]['byteLength'] = len(binary)
    return i

def fixture():
    doc = {'asset':{'version':'2.0'},'buffers':[{'byteLength':0}],'bufferViews':[],
           'accessors':[], 'nodes':[{'name':'pelvis'},{'name':'test-mesh','mesh':0,'skin':0}],
           'skins':[{'joints':[0],'skeleton':0}], 'scenes':[{'nodes':[0,1]}], 'scene':0,
           'meshes':[{'primitives':[{'attributes':{'POSITION':0,'JOINTS_0':1,'WEIGHTS_0':2},'indices':3}]}]}
    binary=bytearray()
    for data,ct,kind in ((struct.pack('<9f',0,0,0,1,0,0,0,1,0),5126,'VEC3'),
                         (bytes(12),5121,'VEC4'),(struct.pack('<12f',*[1,0,0,0]*3),5126,'VEC4'),
                         (struct.pack('<3H',0,1,2),5123,'SCALAR')):
        view=add_view(doc,binary,data)
        doc['accessors'].append({'bufferView':view,'componentType':ct,'count':3,'type':kind})
    doc['accessors'][0].update(min=[0,0,0],max=[1,1,0])
    return doc,binary

def encode(doc,binary):
    text=json.dumps(doc,separators=(',',':')).encode()
    text+=b' ' * (-len(text)%4)
    binary=bytes(binary)+b'\0'*(-len(binary)%4)
    body=struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(binary),0x004e4942)+binary
    return struct.pack('<4sII',b'glTF',2,len(body)+12)+body

def sparse_position(doc,binary):
    accessor=doc['accessors'][0]
    data=accessor.pop('bufferView')
    index=add_view(doc,binary,bytes([0,1,2]))
    accessor['sparse']={'count':3,'indices':{'bufferView':index,'componentType':5121},'values':{'bufferView':data}}

def sparse_duplicate(doc,binary):
    sparse_position(doc,binary)
    view=doc['bufferViews'][doc['accessors'][0]['sparse']['indices']['bufferView']]
    binary[view['byteOffset']+1]=0

def disconnected_joints(doc,binary):
    doc['nodes'].append({'name':'joint-other'})
    doc['scenes'][0]['nodes'].append(2)
    doc['skins'][0]['joints'].append(2)

def bad_bind_matrix(doc,binary):
    view=add_view(doc,binary,struct.pack('<16f',1,0,0,.5,0,1,0,0,0,0,1,0,0,0,0,1))
    doc['skins'][0]['inverseBindMatrices']=len(doc['accessors'])
    doc['accessors'].append({'bufferView':view,'count':1,'type':'MAT4','componentType':5126})

def giant_composed_transform(doc,binary):
    old=0
    for _ in range(7):
        current=len(doc['nodes']);doc['nodes'].append({'children':[old],'scale':[1e6,1e6,1e6]});old=current
    doc['scenes'][0]['nodes']=[old,1]

def image(doc,binary,payload,mime):
    doc['images']=[{'mimeType':mime,'bufferView':add_view(doc,binary,payload)}]

def png_chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))

def png_no_pixels(doc,binary):
    payload=b'\x89PNG\r\n\x1a\n'+png_chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+png_chunk(b'IEND',b'')
    image(doc,binary,payload,'image/png')

def png_large_header(doc,binary):
    payload=b'\x89PNG\r\n\x1a\n'+png_chunk(b'IHDR',struct.pack('>IIBBBBB',99999,99999,8,6,0,0,0))+png_chunk(b'IDAT',zlib.compress(b'\0\xff\0\0\xff'))+png_chunk(b'IEND',b'')
    image(doc,binary,payload,'image/png')

def png_valid_small(doc,binary):
    payload=b'\x89PNG\r\n\x1a\n'+png_chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+png_chunk(b'IDAT',zlib.compress(b'\0\xff\0\0\xff'))+png_chunk(b'IEND',b'')
    image(doc,binary,payload,'image/png')

def jpeg_no_scan(doc,binary):
    payload=b'\xff\xd8\xff\xc0'+struct.pack('>H',11)+bytes([8,0,1,0,1,1,1,0x11,0])+b'\xff\xda\x00\x02\xff\xd9'
    image(doc,binary,payload,'image/jpeg')

def multi_morph_mismatch(doc,binary):
    primitive=doc['meshes'][0]['primitives'][0]
    primitive['targets']=[{'POSITION':0}]
    doc['meshes'][0]['primitives'].append({**primitive,'targets':[]})

def repeated_mesh(doc,binary):
    doc['nodes'].append({'name':'test-instance','mesh':0,'skin':0})
    doc['scenes'][0]['nodes'].append(2)

def zero_accessor_budget(doc,binary):
    sparse_position(doc,binary)
    sparse=copy.deepcopy(doc['accessors'][0]['sparse'])
    for _ in range(2):
        doc['accessors'].append({'componentType':5126,'type':'VEC3','count':1_500_000,'sparse':sparse})

cases=[
    ('valid-small-skin',lambda d,b:None,True),('valid-zero-base-sparse',sparse_position,True),
    ('sparse-duplicate-indices',sparse_duplicate,False),
    ('component-expansion-budget',zero_accessor_budget,False),
    ('bad-indices-reference',lambda d,b:d['meshes'][0]['primitives'][0].update(indices=999),False),
    ('stride-smaller-than-element',lambda d,b:d['bufferViews'][0].update(byteStride=4),False),
    ('skeleton-not-ancestor',lambda d,b:d['skins'][0].update(skeleton=1),False),
    ('joints-no-common-root',disconnected_joints,False),
    ('inverse-bind-not-affine',bad_bind_matrix,False),
    ('node-zero-quaternion',lambda d,b:d['nodes'][0].update(rotation=[0,0,0,0]),False),
    ('composed-scale-beyond-float32',giant_composed_transform,False),
    ('valid-small-png',png_valid_small,True),('png-missing-image-data',png_no_pixels,False),('jpeg-missing-scan-data',jpeg_no_scan,False),
    ('png-large-header-no-decompression',png_large_header,False),
    ('multi-primitive-morph-mismatch',multi_morph_mismatch,False),('mesh-two-instances-counted',repeated_mesh,True),
]
results=[]
for name,mutate,expected in cases:
    doc,binary=fixture();mutate(doc,binary)
    target=out/('TEST_ONLY-'+name+'.glb');target.write_bytes(encode(doc,binary))
    row={'case':name,'bytes':target.stat().st_size,'expectedAccepted':expected}
    try:
        report=module.inspect_glb(target)
        row.update(accepted=True,vertices=report['vertices'],instanceComponents=report['instanceComponents'])
    except ValueError as error:
        row.update(accepted=False,error=str(error))
    row['matched']=row['accepted']==expected
    results.append(row)
summary={'inspectorSha256':module.hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest(),
         'cases':results,'matched':sum(r['matched'] for r in results),'total':len(results),
         'blenderCalls':0,'imageDecompressions':0,'boundaryZh':'仅小GLB普通Python预检；未导入Blender，未证明崩溃或可利用'}
(out/'resource-audit.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps(summary,ensure_ascii=False))
sys.exit(0 if summary['matched']==summary['total'] else 1)
