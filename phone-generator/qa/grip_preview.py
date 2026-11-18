import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']);page=await b.new_page(viewport={'width':1440,'height':1250});await page.goto('http://127.0.0.1:4317/?debug=1');await page.wait_for_function('window.pocketStudio?.scene?.ready');await page.locator('#scene').screenshot(path='phone-generator/qa/grip-final.png');await page.screenshot(path='phone-generator/qa/studio-desktop.png',full_page=True);
  for angle in ['front','left','high']:
   await page.select_option('#camera',angle);await page.locator('#scene').screenshot(path='phone-generator/qa/camera-'+angle+'.png')
  async with page.expect_download() as event:await page.locator('#download').click()
  await (await event.value).save_as('phone-generator/qa/example-scene.png')
  await b.close()
asyncio.run(main())
