import asyncio,json
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def idle(page):
 await page.wait_for_function('!document.querySelector("#download-render").disabled',timeout=30000)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':1100},accept_downloads=True)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://127.0.0.1:4318/?debug=1');await page.wait_for_function('window.akStudio?.ready');await page.locator('#model').select_option('ak47');await idle(page)
  assert await page.evaluate('!akStudio.scene.hands')
  await page.locator('#glove').select_option('original');await idle(page)
  await page.locator('#files').set_input_files(str(ROOT/'qa'/'red.png'));await idle(page)
  await page.locator('#generate').click();await idle(page)
  original=await page.evaluate('akStudio.atlas.canvas.toDataURL()')
  await page.locator('[data-view="hands"]').click();await idle(page)
  assert await page.evaluate('akStudio.scene.hands.visible && !akStudio.scene.controls.enabled && akStudio.scene.hands.userData.source==="pov-grip.glb"')
  assert await page.evaluate('(()=>{let skins=0,visibleWeapons=0;akStudio.scene.hands.traverse(o=>{if(o.isSkinnedMesh&&o.visible)skins++;else if(o.isMesh&&o.visible)visibleWeapons++});return skins===3&&visibleWeapons===0})()')
  assert original==await page.evaluate('akStudio.atlas.canvas.toDataURL()')
  await page.locator('#scene').screenshot(path=str(ROOT/'qa'/'hands-view.png'))
  async with page.expect_download() as event:await page.locator('#download-render').click()
  await (await event.value).save_as(str(ROOT/'qa'/'hands-render.png'));await idle(page)
  assert Image.open(ROOT/'qa'/'hands-render.png').size==(1920,1080)
  async with page.expect_download() as event:await page.locator('#download-texture').click()
  await (await event.value).save_as(str(ROOT/'qa'/'hands-texture.png'));await idle(page)
  assert Image.open(ROOT/'qa'/'hands-texture.png').size==(2048,2048)
  assert original==await page.evaluate('akStudio.atlas.canvas.toDataURL()')
  await page.locator('#reset-view').click();await idle(page)
  assert await page.evaluate('akStudio.scene.view==="hands" && akStudio.scene.hands.visible')
  await page.locator('[data-view="left"]').click();await idle(page)
  assert await page.evaluate('!akStudio.scene.hands.visible && akStudio.scene.controls.enabled')
  await page.locator('[data-view="hands"]').click();await idle(page)
  await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(ROOT/'qa'/'hands-mobile.png'),full_page=True)
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  await page.locator('#reset').click();await idle(page)
  assert await page.evaluate('akStudio.scene.view==="angle" && !akStudio.scene.hands.visible && akStudio.scene.controls.enabled')
  failed=await browser.new_page();await failed.route('**/assets/pov-grip.glb',lambda route:route.abort());await failed.goto('http://127.0.0.1:4318/?debug=1');await failed.wait_for_function('window.akStudio?.ready');await failed.locator('#model').select_option('ak47');await idle(failed)
  await failed.locator('[data-view="hands"]').click();await idle(failed)
  assert 'Could not load hands' in await failed.locator('#status').inner_text()
  assert await failed.evaluate('akStudio.scene.view==="angle" && akStudio.scene.controls.enabled')
  await failed.close();assert not errors,errors
  print(json.dumps({'browser_errors':errors,'rigged_hands':2,'mode_switch_and_reset':'passed','skin_unchanged':True,'render_and_texture_exports':'passed','mobile_overflow':False,'missing_hand_fallback':'passed'}))
  await browser.close()
asyncio.run(main())
