import asyncio,json
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page();await page.route('**/assets/aks74u.glb',lambda route:route.abort())
  await page.goto('http://127.0.0.1:4318/?debug=1');await page.wait_for_function('document.querySelector("#loading strong").textContent.includes("could not")')
  assert await page.locator('#model').is_enabled()
  await page.locator('#model').select_option('ak47');await page.wait_for_function('window.akStudio?.ready')
  assert (await page.evaluate('akStudio.state'))['model']=='ak47'
  await page.close()
  page=await browser.new_page();await page.goto('http://127.0.0.1:4318/?debug=1');await page.wait_for_function('window.akStudio?.ready',timeout=90000)
  await page.locator('#animation-clip').select_option('1');await page.locator('#animation-time').fill('1.5')
  await page.locator('#reset').click();await page.wait_for_function('!document.querySelector("#download-render").disabled')
  assert (await page.evaluate('akStudio.scene.animationState'))=={'clipIndex':2,'duration':0.30000001192092896,'time':0,'playing':False}
  assert await page.locator('#animation-clip').input_value()=='2'
  await page.locator('#animation-clip').select_option('0');await page.locator('#animation-play').click()
  await page.wait_for_function('akStudio.scene.animationState.time>.2')
  blob=await page.evaluate('''async()=>{const before=akStudio.scene.animationState;const blob=await akStudio.scene.exportPNG();const after=akStudio.scene.animationState;return {before,after,size:blob.size};}''')
  assert blob['before']['playing'] and blob['after']['playing'] and abs(blob['before']['time']-blob['after']['time'])<.001 and blob['size']>10000
  print(json.dumps({'missing_model_recovery':'passed','animation_reset':'passed','playing_PNG_export_restores_time':'passed'}))
  await browser.close()
asyncio.run(main())
