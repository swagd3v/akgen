import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path('ak-studio/qa')
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']);page=await b.new_page(viewport={'width':1440,'height':1250});page.on('pageerror',lambda e:print('PAGEERROR',e));page.on('console',lambda m:print('CONSOLE',m.type,m.text) if m.type=='error' else None)
  await page.goto('http://127.0.0.1:4318/?debug=1');await page.wait_for_function('window.akStudio?.ready',timeout=90000)
  await page.locator('[data-view="hands"]').click();await page.wait_for_function('!document.querySelector("#download-render").disabled',timeout=90000);print('STATUS',await page.locator('#status').inner_text());print('RIG',await page.evaluate('({scales:akStudio.scene.active.cs2?.handScales,appearance:akStudio.state.appearance})'));await page.locator('#scene').screenshot(path=str(ROOT/'cs2-animated.png'))
  if await page.evaluate('!!akStudio.scene.active.cs2'):
   await page.locator('#animation-clip').select_option('0');await page.locator('#animation-time').fill('1.5');await page.locator('#scene').screenshot(path=str(ROOT/'cs2-reload.png'))
  await page.locator('#model').select_option('ak47');await page.wait_for_function('!document.querySelector("#download-render").disabled',timeout=90000);await page.locator('[data-view="hands"]').click();await page.wait_for_function('!document.querySelector("#download-render").disabled',timeout=90000);print('CLASSIC',await page.locator('#status').inner_text());await page.locator('#scene').screenshot(path=str(ROOT/'cs2-classic.png'));await b.close()
asyncio.run(main())
