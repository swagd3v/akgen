import asyncio,json
from playwright.async_api import async_playwright

async def idle(page):
 await page.wait_for_function('!document.querySelector("#download-render").disabled',timeout=90000)

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  try:
   await page.goto('http://127.0.0.1:4318/?debug=1');await page.wait_for_function('window.akStudio?.ready',timeout=90000)
   await page.route('**/assets/cs2/fbi.glb',lambda route:route.abort())
   await page.locator('[data-view="hands"]').click();await idle(page)
   assert 'Could not load hands' in await page.locator('#status').inner_text()
   assert await page.evaluate('akStudio.scene.view==="angle" && !akStudio.scene.freeze')
   await page.locator('#glove').select_option('original');await idle(page)
   await page.locator('[data-view="hands"]').click();await idle(page)
   assert await page.evaluate('akStudio.scene.active.arms.every(o=>o.visible)')
   await page.unroute('**/assets/cs2/fbi.glb')
   await page.locator('#glove').select_option('hardknuckle');await idle(page)
   await page.route('**/assets/cs2/sas.glb',lambda route:route.abort())
   await page.locator('#sleeve').select_option('sas');await idle(page)
   assert await page.locator('#sleeve').input_value()=='fbi'
   assert await page.evaluate('akStudio.scene.active.cs2.group.visible && !akStudio.scene.freeze')
   playback=await page.evaluate('''async()=>{const s=akStudio.scene;s.setClip(0);s.scrub(1.5);s.togglePlay();const before=s.animationState;const blob=await s.exportGLB();const after=s.animationState;s.togglePlay();return {before,after,size:blob.size};}''')
   assert playback['before']==playback['after'] and playback['after']['playing'] and playback['size']>10000000,playback
   await page.locator('#model').select_option('ak47');await idle(page)
   await page.locator('#glove').select_option('original');await idle(page)
   native=await page.evaluate('''async()=>{const s=akStudio.scene,before=s.active.hands?.parent;const blob=await s.exportGLB();const data=await blob.arrayBuffer(),view=new DataView(data);const g=JSON.parse(new TextDecoder().decode(new Uint8Array(data,20,view.getUint32(12,true))));return {skins:g.skins.length,animations:g.animations?.length||0,view:s.view,donorRestored:s.active.hands.parent===s.scene,hidden:!s.active.hands.visible};}''')
   assert native=={'skins':3,'animations':0,'view':'angle','donorRestored':True,'hidden':True},native
   assert not errors,errors
   print(json.dumps({'first_load_failure_and_original_fallback':'passed','last_working_sleeves_preserved':'passed','playing_CS2_GLB_restores_state':playback,'classic_original_GLB':native,'errors':errors}))
  finally:await browser.close()

asyncio.run(main())
