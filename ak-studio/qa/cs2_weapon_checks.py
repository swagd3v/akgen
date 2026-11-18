import asyncio,json,struct
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def idle(page):
 await page.wait_for_function('!document.querySelector("#download-render").disabled',timeout=90000)
async def save(page,button,name):
 async with page.expect_download(timeout=180000) as event:await page.locator(button).click()
 path=ROOT/'qa'/name;await(await event.value).save_as(str(path));await idle(page);return path
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':1200},accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  try:
   await page.goto('http://127.0.0.1:4318/?debug=1');await page.wait_for_function('window.akStudio?.ready',timeout=90000)
   assert await page.locator('#model').input_value()=='aks74u'
   await page.locator('#model').select_option('ak47-cs2');await idle(page)
   assert await page.locator('#status').inner_text()=='Your model is ready. Add images, or choose an animation.'
   assert list((await page.evaluate('akStudio.state'))['parts'])==['Weapon']
   assert await page.locator('[data-view="hands"]').is_disabled() and await page.locator('#glove').is_disabled() and await page.locator('#sleeve').is_disabled()
   assert await page.locator('#animation-play').is_disabled() and await page.locator('#animation-time').is_disabled()
   assert await page.locator('#animation-clip option').all_text_contents()==['Idle','Draw','Reload','Fire','Inspect']
   base=await page.evaluate('akStudio.atlas.canvas.toDataURL()')
   await page.locator('#scene').screenshot(path=str(ROOT/'qa'/'cs2-weapon-original.png'))
   original=await page.evaluate('''async()=>{const s=akStudio.scene,m=s.meshes[0],T=await import('./vendor/three.module.js');m.computeBoundingBox();return {roughness:m.material.roughness,metalness:m.material.metalness,bounds:new T.Box3().setFromObject(m).getSize(new T.Vector3()).toArray(),uv:Array.from(m.geometry.attributes.uv.array),source:Array.from(s.active.originalMaterial.color.toArray())};}''')
   await page.locator('#files').set_input_files(str(ROOT/'qa'/'red.png'));await idle(page)
   await page.locator('#seed').fill('cs2-weapon-047');await page.locator('#apply-seed').click();await idle(page)
   atlas=await page.evaluate('akStudio.atlas.canvas.toDataURL()');assert atlas!=base
   assert await page.evaluate('(()=>{const m=akStudio.scene.meshes[0].material;return m.roughness===.75&&m.metalness===0&&!m.roughnessMap&&!m.metalnessMap&&!!m.normalMap&&!!m.aoMap})()')
   await page.locator('#apply-seed').click();await idle(page);assert atlas==await page.evaluate('akStudio.atlas.canvas.toDataURL()')
   assert original['uv']==await page.evaluate('Array.from(akStudio.scene.meshes[0].geometry.attributes.uv.array)')
   for index in range(5):
    await page.locator('#animation-clip').select_option(str(index));duration=await page.evaluate('akStudio.scene.animationState.duration')
    if duration:await page.locator('#animation-time').fill(str(round(duration*.5,3)))
    assert await page.evaluate('(()=>{const m=akStudio.scene.meshes[0];m.skeleton.update();return Array.from(m.skeleton.boneMatrices).every(Number.isFinite)})()')
   await page.locator('#animation-clip').select_option('2');await page.locator('#animation-time').fill('1.1')
   await page.locator('#scene').screenshot(path=str(ROOT/'qa'/'cs2-weapon-reload.png'))
   render=await save(page,'#download-render','cs2-weapon-render.png');assert Image.open(render).size==(1920,1080)
   texture=await save(page,'#download-texture','cs2-weapon-texture.png');assert Image.open(texture).size==(2048,2048)
   glb=await save(page,'#download-model','cs2-weapon-export.glb');b=glb.read_bytes();g=json.loads(b[20:20+struct.unpack_from('<I',b,12)[0]])
   assert len(g['skins'])==1 and len(g['animations'])==5
   assert abs((await page.evaluate('akStudio.scene.animationState'))['time']-1.1)<.001
   result=await page.evaluate('''async()=>{const T=await import('./vendor/three.module.js'),{GLTFLoader}=await import('./vendor/loaders/GLTFLoader.js');const g=await new GLTFLoader().loadAsync('./qa/cs2-weapon-export.glb');let mesh;g.scene.traverse(o=>{if(o.isSkinnedMesh)mesh=o});const mixer=new T.AnimationMixer(g.scene);let maxError=0,count=0;for(let i=0;i<5;i++){akStudio.scene.setClip(i);for(const t of [0,akStudio.scene.active.clips[i].duration*.5,akStudio.scene.active.clips[i].duration]){akStudio.scene.scrub(t);mixer.stopAllAction();const a=mixer.clipAction(g.animations[i]).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();mixer.setTime(t);g.scene.updateMatrixWorld(true);const source=akStudio.scene.meshes[0];for(let v=0;v<source.geometry.attributes.position.count;v+=89){const a=source.getVertexPosition(v,new T.Vector3()).applyMatrix4(source.matrixWorld),b=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld);maxError=Math.max(maxError,a.distanceTo(b));count++;}}}return {maxError,count,normal:!!mesh.material.normalMap,ao:!!mesh.material.aoMap,roughness:mesh.material.roughness,metalness:mesh.material.metalness};}''')
   assert result['maxError']<.002 and result['count']>100 and result['normal'] and result['ao'] and result['roughness']==.75 and result['metalness']==0,result
   await page.locator('#animation-clip').select_option('2');await page.locator('#animation-time').fill('1.1')
   for model in ['ak47','aks74u']:
    await page.locator('#model').select_option(model);await idle(page)
    assert await page.locator('[data-view="hands"]').is_enabled()
   await page.locator('#model').select_option('ak47-cs2');await idle(page)
   assert atlas==await page.evaluate('akStudio.atlas.canvas.toDataURL()') and abs((await page.evaluate('akStudio.scene.animationState'))['time']-1.1)<.001
   await page.evaluate('document.querySelector("#parts-panel").open=true');await page.locator('.part-chip').first.click();await page.locator('#part-original').click();await idle(page)
   assert base==await page.evaluate('akStudio.atlas.canvas.toDataURL()')
   assert await page.evaluate('akStudio.scene.meshes[0].material.roughnessMap===akStudio.scene.active.originalMaterial.roughnessMap')
   await page.locator('#reset').click();await idle(page);assert (await page.evaluate('akStudio.scene.animationState'))['clipIndex']==0
   await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(ROOT/'qa'/'cs2-weapon-mobile.png'),full_page=True);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   await page.locator('#model').select_option('ak47');await idle(page);await page.reload();await page.wait_for_function('window.akStudio?.ready',timeout=90000)
   await page.route('**/assets/ak47-cs2.glb',lambda route:route.abort());await page.locator('#model').select_option('ak47-cs2');await idle(page)
   assert 'Could not load model' in await page.locator('#status').inner_text() and await page.locator('#model').input_value()=='aks74u'
   assert not errors,errors
   print(json.dumps({'clips':5,'native_UVs':'unchanged','matte_paint_and_original_restoration':'passed','workspace_and_missing_model':'passed','PNG_texture_GLB':'passed','roundtrip':result,'errors':errors}))
  finally:await browser.close()
asyncio.run(main())
