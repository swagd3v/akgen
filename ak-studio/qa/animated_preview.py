import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path('ak-studio/qa')
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']);page=await b.new_page(viewport={'width':1440,'height':1250});page.on('pageerror',lambda e:print('PAGEERROR',e));page.on('console',lambda m:print('CONSOLE',m.type,m.text) if m.type=='error' else None)
  await page.goto('http://127.0.0.1:4318/?debug=1');await page.wait_for_function('window.akStudio?.ready',timeout=90000)
  print('MODEL',await page.evaluate('({state:akStudio.state,anim:akStudio.scene.animationState,bounds:akStudio.scene.active.restBox,arms:akStudio.scene.active.arms.length,meshes:akStudio.scene.meshes.map(m=>({name:m.name,zone:m.userData.zone}))})'))
  await page.screenshot(path=str(ROOT/'animated-desktop.png'),full_page=True)
  await page.locator('[data-view="hands"]').click();await page.wait_for_function('!document.querySelector("#download-render").disabled');await page.locator('#scene').screenshot(path=str(ROOT/'animated-hands.png'))
  await page.locator('#animation-clip').select_option('0');await page.locator('#animation-time').fill('1.5');await page.locator('#scene').screenshot(path=str(ROOT/'animated-reload.png'))
  await b.close()
asyncio.run(main())
