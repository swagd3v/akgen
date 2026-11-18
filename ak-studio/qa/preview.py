import asyncio, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]

def fixtures():
    font = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 90)
    im = Image.new('RGB', (900, 650), '#c95f3c'); d = ImageDraw.Draw(im)
    for i in range(8): d.ellipse((i*110-150, -220, i*110+250, 750), outline='#f1deba', width=25)
    d.rectangle((110, 180, 790, 470), fill='#203d35'); d.text((145, 260), 'ORIGINAL', fill='#f5e8c8', font=font)
    im.save(ROOT/'qa'/'red.png')
    im = Image.new('RGB', (650, 1000), '#28483e'); d = ImageDraw.Draw(im)
    for i in range(10): d.line((0, i*140-300, 650, i*140+300), fill='#c8d19d', width=45)
    d.ellipse((100, 250, 550, 700), fill='#ecbd59'); d.text((160, 430), 'AK 47', fill='#28483e', font=font)
    im.save(ROOT/'qa'/'green.png')
    im = Image.new('RGBA', (800, 800), (0,0,0,0)); d = ImageDraw.Draw(im)
    d.ellipse((40,40,760,760), fill='#e8ce8f'); d.ellipse((220,220,580,580), fill='#b35437');d.text((220,335),'MAKE',fill='#263c33',font=font)
    im.save(ROOT/'qa'/'alpha.png')

async def main():
    fixtures()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        page = await browser.new_page(viewport={'width':1440,'height':1180})
        page.on('pageerror', lambda e: print('PAGEERROR',str(e)))
        page.on('console', lambda m: print('CONSOLE',m.type,m.text) if m.type=='error' else None)
        await page.goto('http://127.0.0.1:4318/?debug=1')
        await page.wait_for_function('window.akStudio?.ready', timeout=60000)
        print('MASKS',await page.evaluate('Object.fromEntries(Object.entries(akStudio.atlas.masks).map(([z,m])=>[z,m.pixelCount]))'))
        await page.screenshot(path=str(ROOT/'qa'/'original-desktop.png'), full_page=True)
        await page.locator('#files').set_input_files([str(ROOT/'qa'/n) for n in ['red.png','green.png','alpha.png']])
        await page.wait_for_function('!document.querySelector("#generate").disabled')
        await page.locator('#generate').click()
        await page.wait_for_function('!document.querySelector("#generate").disabled',timeout=60000)
        await page.screenshot(path=str(ROOT/'qa'/'collage-desktop.png'), full_page=True)
        print('STATE', await page.evaluate('akStudio.state'))
        for view in ['left','right','angle']:
            await page.locator('[data-view="'+view+'"]').click()
            await page.locator('#scene').screenshot(path=str(ROOT/'qa'/('view-'+view+'.png')))
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
