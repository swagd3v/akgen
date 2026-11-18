import asyncio,json,struct
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
async def idle(page):
 await page.wait_for_function('!document.querySelector("#download-render").disabled',timeout=90000)
async def save(page,button,name):
 async with page.expect_download(timeout=180000) as event: await page.locator(button).click()
 path=ROOT/'qa'/name;await (await event.value).save_as(str(path));await idle(page);return path
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':1200},accept_downloads=True)
  errors=[];page.on('pageerror',lambda e:(errors.append(str(e)),print('PAGEERROR',e)));page.on('console',lambda m:print('ERROR',m.text) if m.type=='error' else None)
  await page.goto('http://127.0.0.1:4318/?debug=1');await page.wait_for_function('window.akStudio?.ready',timeout=90000)
  assert await page.locator('#model').input_value()=='aks74u'
  await page.locator('#glove').select_option('original');await idle(page)
  initial=await page.evaluate('akStudio.scene.animationState');assert initial['clipIndex']==2 and initial['time']==0 and not initial['playing']
  assert len(await page.locator('#animation-clip option').all())==7
  assert await page.evaluate('akStudio.scene.meshes.every(m=>m.geometry.attributes.uv1.array.every(v=>Number.isFinite(v)&&v>=0&&v<=1))')
  assert await page.evaluate('akStudio.scene.meshes.every(m=>m.material.map.channel===1)')
  assert set((await page.evaluate('akStudio.state'))['parts'])=={'Metal Body','Magazines','Wood Fittings'}
  await page.locator('#files').set_input_files([str(ROOT/'qa'/'red.png'),str(ROOT/'qa'/'green.png')]);await idle(page)
  await page.locator('#seed').fill('animated-047');await page.locator('#apply-seed').click();await idle(page)
  atlas=await page.evaluate('akStudio.atlas.canvas.toDataURL()')
  assert await page.evaluate('Object.values(akStudio.atlas.layers).every(c=>c.getContext("2d").getImageData(0,0,2048,2048).data.some((v,i)=>i%4===3&&v>0))')
  # Exact atlas stability while all clips run and their skeletons deform.
  for i in range(7):
   await page.locator('#animation-clip').select_option(str(i))
   assert (await page.evaluate('akStudio.scene.animationState'))['time']==0
   duration=(await page.evaluate('akStudio.scene.animationState'))['duration']
   await page.locator('#animation-time').fill(str(round(duration*.5,3)))
   state=await page.evaluate('akStudio.scene.animationState');assert abs(state['time']-duration*.5)<.002 and not state['playing']
   assert await page.evaluate('akStudio.scene.meshes.every(m=>{m.skeleton.update();return Array.from(m.skeleton.boneMatrices).every(Number.isFinite)})')
  assert atlas==await page.evaluate('akStudio.atlas.canvas.toDataURL()')
  await page.locator('#animation-clip').select_option('0')
  await page.locator('#animation-play').click();await page.wait_for_function('akStudio.scene.animationState.time>.12')
  await page.locator('#animation-play').click();state=await page.evaluate('akStudio.scene.animationState');assert not state['playing'] and state['time']>0
  await page.locator('#animation-clip').select_option('2');await page.locator('#animation-play').click();await page.wait_for_function('!akStudio.scene.animationState.playing',timeout=15000)
  assert abs((await page.evaluate('akStudio.scene.animationState'))['time']-.3)<.001
  restarted=await page.evaluate('()=>{const b=document.querySelector("#animation-play");b.click();const state={...akStudio.scene.animationState};b.click();return state;}')
  assert restarted['playing'] and restarted['time']==0,restarted
  await page.locator('#animation-clip').select_option('0');await page.locator('#animation-time').fill('1.5')
  await page.locator('[data-view="hands"]').click();await idle(page)
  assert await page.evaluate('akStudio.scene.active.arms[0].visible')
  await page.locator('#scene').screenshot(path=str(ROOT/'qa'/'animated-painted-reload.png'))
  render=await save(page,'#download-render','animated-render.png');assert Image.open(render).size==(1920,1080)
  assert abs((await page.evaluate('akStudio.scene.animationState'))['time']-1.5)<.001
  texture=await save(page,'#download-texture','animated-texture.png');assert Image.open(texture).size==(2048,2048)
  await page.locator('[data-view="angle"]').click();await idle(page)
  await page.screenshot(path=str(ROOT/'qa'/'animated-studio-final.png'),full_page=True)
  model=await save(page,'#download-model','customized-aks74u.glb')
  data=model.read_bytes();assert data[:4]==b'glTF';size=struct.unpack_from('<I',data,12)[0];gltf=json.loads(data[20:20+size]);assert len(gltf['animations'])==7 and gltf.get('skins')
  print('EXPORTED',model.stat().st_size,'bytes',len(gltf['animations']),'clips')
  # Load the actual exported bytes into a fresh GLTFLoader scene and inspect
  # all clips, paint channels and hand textures before rendering a screenshot.
  result=await page.evaluate('''async()=>{
   const T=await import('./vendor/three.module.js');const {GLTFLoader}=await import('./vendor/loaders/GLTFLoader.js');
   const g=await new GLTFLoader().loadAsync('./qa/customized-aks74u.glb');
   const meshes=[];g.scene.traverse(o=>{if(o.isMesh)meshes.push(o)});
   const paint=meshes.filter(o=>o.userData.zone);const hands=meshes.find(o=>o.material.name==='arms');
   const mixer=new T.AnimationMixer(g.scene);let finite=true;
   for(const clip of g.animations){mixer.stopAllAction();const a=mixer.clipAction(clip).play();mixer.setTime(clip.duration*.5);g.scene.updateMatrixWorld(true);meshes.forEach(m=>{if(m.isSkinnedMesh){m.skeleton.update();finite=finite&&Array.from(m.skeleton.boneMatrices).every(Number.isFinite)}});}
   akStudio.scene.active.container.visible=false;akStudio.scene.scene.add(g.scene);
   mixer.stopAllAction();mixer.clipAction(g.animations[0]).play();mixer.setTime(1.5);
   akStudio.scene.camera.position.set(1.4,.9,-3.3);akStudio.scene.camera.fov=60;akStudio.scene.camera.updateProjectionMatrix();akStudio.scene.camera.lookAt(0,.15,1.7);akStudio.scene.render();
   window.roundtrip=g;
   return {clips:g.animations.length,paintCount:paint.length,colorUV:paint.every(m=>m.geometry.attributes.uv1&&m.material.map?.channel===1),handsTextured:!!hands?.material.map,normals:paint.filter(m=>m.material.normalMap).length,finite};
  }''')
  assert result['clips']==7 and result['paintCount']==3 and result['colorUV'] and result['handsTextured'] and result['finite'] and result['normals']==2,result
  await page.locator('#scene').screenshot(path=str(ROOT/'qa'/'animated-roundtrip.png'))
  await page.evaluate('akStudio.scene.scene.remove(roundtrip.scene);akStudio.scene.active.container.visible=true')
  await page.locator('#model').select_option('ak47');await idle(page)
  assert await page.locator('#animation-panel').is_hidden() and len((await page.evaluate('akStudio.state'))['parts'])==7
  await page.locator('#seed').fill('classic-047');await page.locator('#apply-seed').click();await idle(page)
  classic=await page.evaluate('akStudio.atlas.canvas.toDataURL()')
  await page.locator('#model').select_option('aks74u');await idle(page)
  assert (await page.evaluate('akStudio.state'))['seed']=='animated-047'
  assert atlas==await page.evaluate('akStudio.atlas.canvas.toDataURL()')
  await page.locator('#model').select_option('ak47');await idle(page)
  assert classic==await page.evaluate('akStudio.atlas.canvas.toDataURL()')
  await page.locator('#model').select_option('aks74u');await idle(page)
  await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(ROOT/'qa'/'animated-mobile.png'),full_page=True)
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors
  print(json.dumps({'errors':errors,'clips':7,'uv_and_paint_groups':3,'play_pause_scrub_restart':'passed','PNG_exports':'passed','GLB_roundtrip':result,'model_workspace_restoration':'passed','mobile_overflow':False}))
  await browser.close()
asyncio.run(main())
