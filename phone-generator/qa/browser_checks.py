import asyncio,json,io
from pathlib import Path
from PIL import Image,ImageDraw
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]

def fixture(name,size):
 im=Image.new('RGB',size,'#ffe6ab');d=ImageDraw.Draw(im);w,h=size;d.rectangle((0,0,w//2,h//2),fill='#ee4433');d.rectangle((w//2,0,w,h//2),fill='#3366ee');d.rectangle((0,h//2,w//2,h),fill='#44bb66');d.rectangle((w//2,h//2,w,h),fill='#dd44aa');d.text((w//4,h//4),'TOP LEFT',fill='white');d.text((w//3,h*3//4),'BOTTOM',fill='white');im.save(ROOT/'qa'/name)

async def main():
 fixture('portrait.png',(600,1200));fixture('landscape.png',(1200,600));fixture('square.png',(700,700))
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']);page=await browser.new_page(viewport={'width':1440,'height':1250},accept_downloads=True)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://127.0.0.1:4317/?debug=1');await page.wait_for_function('window.pocketStudio?.scene?.ready')
  assert await page.locator('#download').is_enabled()
  for angle in ['front','left','high']:
   await page.select_option('#camera',angle);await page.locator('#scene').screenshot(path=str(ROOT/'qa'/f'camera-{angle}.png'))
  for name in ['portrait.png','landscape.png','square.png']:
   await page.locator('#files').set_input_files(str(ROOT/'qa'/name));await page.wait_for_function(f'window.pocketStudio.images.length=={["portrait.png","landscape.png","square.png"].index(name)+1}');await page.wait_for_function('!document.querySelector("#generate").disabled')
   await page.get_by_role('button',name='Use '+name,exact=True).click()
   for mode in ['fit','fill']:
    await page.locator('#'+mode).click();await page.locator('#scene').screenshot(path=str(ROOT/'qa'/f'{name[:-4]}-{mode}.png'))
  await page.locator('#files').set_input_files(str(ROOT/'qa'/'portrait.png'));await page.wait_for_function('!document.querySelector("#generate").disabled');assert len(await page.evaluate('pocketStudio.images'))==3
  await page.locator('#seed').fill('repeatable-42');await page.locator('#apply-seed').click();first=await page.evaluate('pocketStudio.config');frame=await page.evaluate('document.querySelector("canvas").toDataURL()')
  await page.locator('#generate').click();assert (await page.evaluate('pocketStudio.config'))['seed']!='repeatable-42'
  await page.locator('#seed').fill('repeatable-42');await page.locator('#seed').press('Enter');assert first==await page.evaluate('pocketStudio.config');assert frame==await page.evaluate('document.querySelector("canvas").toDataURL()')
  async with page.expect_download() as event:await page.locator('#download').click()
  download=await event.value;await download.save_as(str(ROOT/'qa'/'export.png'));im=Image.open(ROOT/'qa'/'export.png');assert im.size==(1080,1350);assert im.mode in ['RGBA','RGB'];assert '1080' in await page.locator('#status').inner_text();assert await page.evaluate('pocketStudio.config')==first
  if im.mode=='RGBA':assert im.getchannel('A').getextrema()==(255,255)
  await page.locator('#files').set_input_files({'name':'broken.png','mimeType':'image/png','buffer':b'broken'});await page.wait_for_function('!document.querySelector("#generate").disabled');assert 'could not open' in await page.locator('#status').inner_text()
  await page.locator('#files').set_input_files({'name':'not-an-image.txt','mimeType':'text/plain','buffer':b'hello'});await page.wait_for_function('!document.querySelector("#generate").disabled');assert 'choose an image' in await page.locator('#status').inner_text()
  await page.get_by_role('button',name='Remove landscape.png',exact=True).click();assert len(await page.evaluate('pocketStudio.images'))==2
  await page.locator('#reset').click();assert len(await page.evaluate('pocketStudio.images'))==0;assert (await page.evaluate('pocketStudio.config'))['imageId']=='placeholder'
  await page.screenshot(path=str(ROOT/'qa'/'studio-desktop.png'),full_page=True)
  await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(ROOT/'qa'/'studio-mobile.png'),full_page=True);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  # An oversized upload is rejected without adding a library entry.
  await page.locator('#files').set_input_files({'name':'large.png','mimeType':'image/png','buffer':b'x'*(20*1024*1024+1)})
  await page.wait_for_function('!document.querySelector("#generate").disabled')
  assert 'exceeds 20 MB' in await page.locator('#status').inner_text()
  # Simulated model failure leaves export disabled and an actionable error.
  failed=await browser.new_page()
  await failed.route('**/assets/phone.glb',lambda route:route.abort())
  await failed.goto('http://127.0.0.1:4317/')
  await failed.wait_for_function('document.querySelector("#loading strong")')
  assert await failed.locator('#download').is_disabled()
  await failed.close()
  # WebGL-unavailable browsers get an error instead of a blank successful preview.
  no_gl=await browser.new_page()
  await no_gl.add_init_script("const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:original.call(this,type,...args)}")
  await no_gl.goto('http://127.0.0.1:4317/')
  await no_gl.wait_for_function('document.querySelector("#loading strong")')
  assert await no_gl.locator('#download').is_disabled()
  await no_gl.close()
  # Context loss disables generation and export on an already loaded scene.
  await page.evaluate('pocketStudio.scene.renderer.getContext().getExtension("WEBGL_lose_context").loseContext()')
  await page.wait_for_function('document.querySelector("#download").disabled')
  assert 'context was lost' in await page.locator('#status').inner_text()
  assert not errors,errors
  print(json.dumps({'browser_errors':errors,'cameras_checked':3,'image_aspects_checked':3,'fit_modes_checked':2,'png_size':im.size,'seed_and_pixels_repeatable':True,'duplicate_invalid_and_remove_checks':'passed','mobile_overflow':False}))
  await browser.close()
asyncio.run(main())
