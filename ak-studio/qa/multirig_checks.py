import asyncio,json,struct
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def idle(page):
 await page.wait_for_function('!document.querySelector("#download-render").disabled',timeout=90000)
async def download(page,button,name):
 async with page.expect_download(timeout=240000) as event:await page.locator(button).click()
 path=ROOT/'qa'/name;await(await event.value).save_as(str(path));await idle(page);return path
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':1250},accept_downloads=True)
  errors=[];page.on('pageerror',lambda e:(errors.append(str(e)),print('PAGEERROR',e)))
  await page.goto('http://127.0.0.1:4318/?debug=1');await page.wait_for_function('window.akStudio?.ready',timeout=90000)
  assert await page.locator('#glove').input_value()=='hardknuckle'
  assert await page.locator('#sleeve').input_value()=='fbi'
  assert await page.evaluate('!akStudio.scene.active.cs2') # lazy startup
  await page.locator('#files').set_input_files(str(ROOT/'qa'/'red.png'));await idle(page);await page.locator('#generate').click();await idle(page)
  texture=await page.evaluate('akStudio.atlas.canvas.toDataURL()')
  for model in ['aks74u','ak47']:
   if await page.locator('#model').input_value()!=model:await page.locator('#model').select_option(model);await idle(page)
   await page.locator('[data-view="hands"]').click();await idle(page)
   for glove,sleeve in [('hardknuckle','fbi'),('hardknuckle-black','sas'),('fingerless','balkan'),('fullfinger','bare')]:
    await page.locator('#glove').select_option(glove);await idle(page);await page.locator('#sleeve').select_option(sleeve);await idle(page)
    assert 'Could not' not in await page.locator('#status').inner_text()
    state=await page.evaluate('akStudio.state');assert state['appearance']=={'glove':glove,'sleeve':sleeve}
    valid=await page.evaluate('''()=>{const s=akStudio.scene,r=s.active;let meshes=0,valid=true;r.cs2.group.traverse(o=>{if(o.isSkinnedMesh){meshes++;o.skeleton.update();valid=valid&&Array.from(o.skeleton.boneMatrices).every(Number.isFinite)&&!!o.material.map}});return {meshes,valid,nativeHidden:r.arms.every(o=>!o.visible)&&(!r.hands||!r.hands.visible)};}''')
    assert valid['valid'] and valid['nativeHidden'] and valid['meshes']>=2,valid
    await page.locator('#scene').screenshot(path=str(ROOT/'qa'/f'cs2-{model}-{glove}.png'))
   if model=='aks74u':
    assert texture==await page.evaluate('akStudio.atlas.canvas.toDataURL()')
    for i in range(7):
     await page.locator('#animation-clip').select_option(str(i));d=await page.evaluate('akStudio.scene.animationState.duration');await page.locator('#animation-time').fill(str(round(d*.5,3)))
     assert await page.evaluate('(()=>{let good=true;akStudio.scene.active.cs2.group.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();good=good&&Array.from(o.skeleton.boneMatrices).every(Number.isFinite)}});return good})()')
   await page.locator('#glove').select_option('original');await idle(page)
   assert await page.locator('#sleeve').is_disabled()
   assert await page.evaluate('!akStudio.scene.active.cs2.group.visible')
   assert await page.evaluate('akStudio.scene.active.id==="aks74u"?akStudio.scene.active.arms[0].visible:akStudio.scene.active.hands.visible')
   await page.locator('#glove').select_option('hardknuckle');await idle(page);await page.locator('#sleeve').select_option('fbi');await idle(page)
   if model=='ak47':
    static=await download(page,'#download-model','cs2-classic.glb');data=static.read_bytes();n=struct.unpack_from('<I',data,12)[0];g=json.loads(data[20:20+n]);assert g.get('skins') and not g.get('animations')
    print('CLASSIC EXPORT',len(data),'bytes')
  await page.locator('#model').select_option('aks74u');await idle(page)
  assert (await page.evaluate('akStudio.state'))['appearance']=={'glove':'hardknuckle','sleeve':'fbi'}
  await page.locator('#animation-clip').select_option('0');await page.locator('#animation-time').fill('1.5')
  render=await download(page,'#download-render','cs2-render.png');assert Image.open(render).size==(1920,1080)
  assert texture==await page.evaluate('akStudio.atlas.canvas.toDataURL()')
  path=await download(page,'#download-model','cs2-animated.glb');data=path.read_bytes();size=struct.unpack_from('<I',data,12)[0];g=json.loads(data[20:20+size]);assert len(g['animations'])==7
  assert sum(1 for node in g['nodes'] if node.get('name','').startswith('CS2_'))>=38
  assert abs((await page.evaluate('akStudio.scene.animationState'))['time']-1.5)<.001
  print('ANIMATED EXPORT',len(data),'bytes')
  comparison=await page.evaluate('''async()=>{
   const T=await import('./vendor/three.module.js');const {GLTFLoader}=await import('./vendor/loaders/GLTFLoader.js');
   const g=await new GLTFLoader().loadAsync('./qa/cs2-animated.glb');const mixer=new T.AnimationMixer(g.scene);
   let maxPositionError=0,maxAngleError=0,comparisons=0;
   for(let index=0;index<7;index++){
    akStudio.scene.setClip(index);const duration=akStudio.scene.active.clips[index].duration;
    for(const time of [0,Math.min(.1,duration),duration*.5,duration]){
     akStudio.scene.scrub(time);mixer.stopAllAction();const a=mixer.clipAction(g.animations[index]).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();mixer.setTime(time);g.scene.updateMatrixWorld(true);
     for(const [key,bone]of akStudio.scene.active.cs2.bones){const other=g.scene.getObjectByName(bone.name);if(!other)throw Error('Missing '+bone.name);maxPositionError=Math.max(maxPositionError,bone.getWorldPosition(new T.Vector3()).distanceTo(other.getWorldPosition(new T.Vector3())));maxAngleError=Math.max(maxAngleError,bone.getWorldQuaternion(new T.Quaternion()).angleTo(other.getWorldQuaternion(new T.Quaternion())));comparisons++;}
    }
   }
   let nativeArms=0,cs2Meshes=0,sleeveMeshes=0;g.scene.traverse(o=>{if(o.isSkinnedMesh){if(o.material.name==='arms')nativeArms++;else{cs2Meshes++;if(o.material.name.includes('sleeve'))sleeveMeshes++;}}});
   return {maxPositionError,maxAngleError,comparisons,clips:g.animations.length,nativeArms,cs2Meshes,sleeveMeshes};
  }''')
  assert comparison['clips']==7 and comparison['comparisons']>=1000 and comparison['maxPositionError']<.02 and comparison['maxAngleError']<.04 and comparison['nativeArms']==0 and comparison['sleeveMeshes']>0,comparison
  print('ROUNDTRIP',json.dumps(comparison))
  previous=await page.evaluate('akStudio.state.appearance')
  await page.route('**/assets/cs2/fullfinger.glb',lambda route:route.abort())
  await page.locator('#glove').select_option('fullfinger');await idle(page)
  assert 'Could not load appearance' in await page.locator('#status').inner_text()
  assert await page.evaluate('akStudio.state.appearance')==previous
  assert await page.evaluate('akStudio.scene.active.cs2.group.visible')
  await page.unroute('**/assets/cs2/fullfinger.glb')
  await page.route('**/assets/cs2/sas.glb',lambda route:route.abort())
  await page.locator('#sleeve').select_option('sas');await idle(page)
  assert 'Could not load appearance' in await page.locator('#status').inner_text()
  assert await page.evaluate('akStudio.state.appearance')==previous
  assert await page.evaluate('akStudio.scene.active.cs2.group.visible')
  await page.unroute('**/assets/cs2/sas.glb')
  await page.locator('#glove').select_option('original');await idle(page)
  await page.locator('#glove').select_option('hardknuckle');await idle(page)
  await page.locator('#animation-clip').select_option('2');await page.locator('#animation-time').fill('0');await page.screenshot(path=str(ROOT/'qa'/'cs2-studio.png'),full_page=True)
  await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(ROOT/'qa'/'cs2-mobile.png'),full_page=True);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors
  print(json.dumps({'errors':errors,'models':2,'gloves':4,'sleeveOptions':4,'clips':7,'skin_unchanged':True,'original_fallback':'passed','missing_assets':'last working appearance preserved','PNG_and_GLB_exports':'passed','roundtrip':comparison,'mobile_overflow':False}))
  await browser.close()
asyncio.run(main())
