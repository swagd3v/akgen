"""Package the selected MultiRig models and their referenced assets into GLBs."""
import json,struct,zipfile,posixpath,hashlib
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FILES={
 'hardknuckle':'Arms/CT/glove_hardknuckle/v_glove_hardknuckle.glb',
 'hardknuckle-black':'Arms/CT/glove_hardknuckle/v_glove_hardknuckle_black.glb',
 'fingerless':'Arms/T/glove_fingerless/v_glove_fingerless.gltf',
 'fullfinger':'Arms/T/glove_fullfinger/v_glove_fullfinger.gltf',
 'fbi':'Arms/CT/Sleeves/FBI/sleeve_ctm_fbi.gltf',
 'sas':'Arms/CT/Sleeves/SAS/sleeve_ctm_sas.gltf',
 'balkan':'Arms/T/Sleeves/Balkan/sleeve_balkan.gltf',
}
def padded(data):return data+b'\0'*((-len(data))%4)
def prepare():
 out=ROOT/'assets'/'cs2';out.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(ROOT/'CS2_MultiRig_V3.zip') as archive:
  names=set(archive.namelist())
  def resolve(owner,uri):
   local=posixpath.normpath(posixpath.join(posixpath.dirname(owner),uri))
   if local in names:return archive.read(local)
   candidates=sorted(n for n in names if posixpath.basename(n)==posixpath.basename(uri))
   if not candidates:raise FileNotFoundError(f'{owner}: {uri}')
   hashes={hashlib.sha256(archive.read(n)).hexdigest() for n in candidates}
   if len(hashes)>1:raise ValueError(f'Ambiguous shared resource: {uri}')
   return archive.read(candidates[0])
  for key,name in FILES.items():
   data=archive.read(name);original_bin=None
   if name.endswith('.glb'):
    size=struct.unpack_from('<I',data,12)[0];g=json.loads(data[20:20+size]);original_bin=data[28+size:]
   else:g=json.loads(data)
   binary=bytearray();offsets=[]
   for buffer in g['buffers']:
    offsets.append(len(binary));binary+=padded(resolve(name,buffer['uri']) if 'uri'in buffer else original_bin[:buffer['byteLength']])
   for view in g['bufferViews']:
    view['byteOffset']=view.get('byteOffset',0)+offsets[view.get('buffer',0)];view['buffer']=0
   for image in g.get('images',[]):
    if 'uri'not in image:continue
    image_data=resolve(name,image.pop('uri'));image['mimeType']='image/png';image['bufferView']=len(g['bufferViews'])
    g['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(image_data)});binary+=padded(image_data)
   g['buffers']=[{'byteLength':len(binary)}]
   g.pop('animations',None) # The app supplies the weapon-specific poses and clips.
   g.setdefault('asset',{})['generator']='AK Studio / CS2 MultiRig curated package'
   js=json.dumps(g,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
   result=struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary
   (out/(key+'.glb')).write_bytes(result);print(key,len(result))
if __name__=='__main__':prepare()
