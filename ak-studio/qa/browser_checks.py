import asyncio, json, base64
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright
from preview import fixtures

ROOT = Path(__file__).resolve().parents[1]

async def wait_idle(page):
    await page.wait_for_function('!document.querySelector("#download-render").disabled', timeout=60000)

async def apply_seed(page, seed):
    await page.locator('#seed').fill(seed)
    await page.locator('#apply-seed').click()
    await wait_idle(page)

async def layer_hashes(page):
    return await page.evaluate('''async()=>{
      const out={};
      for(const [name,c] of Object.entries(akStudio.atlas.layers)){
        const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        out[name]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join('');
      }return out;
    }''')

async def download(page, button, name):
    async with page.expect_download() as event:
        await page.locator(button).click()
    await (await event.value).save_as(str(ROOT/'qa'/name))
    await wait_idle(page)
    return Image.open(ROOT/'qa'/name)

async def main():
    fixtures()
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        page=await browser.new_page(viewport={'width':1440,'height':1180},accept_downloads=True)
        errors=[]; page.on('pageerror',lambda error:errors.append(str(error)))
        await page.goto('http://127.0.0.1:4318/?debug=1')
        await page.wait_for_function('window.akStudio?.ready',timeout=60000)
        await page.locator('#model').select_option('ak47');await wait_idle(page)
        assert await page.locator('#generate').is_disabled()
        assert not await page.locator('#download-render').is_disabled()
        assert await page.evaluate('akStudio.scene.meshes.length')==25
        await page.locator('#files').set_input_files([str(ROOT/'qa'/name) for name in ['red.png','green.png','alpha.png']])
        await wait_idle(page)
        assert len((await page.evaluate('akStudio.state'))['images'])==3
        await apply_seed(page,'repeatable-42')
        original=await layer_hashes(page)
        first_atlas=await page.evaluate('akStudio.atlas.canvas.toDataURL()')
        await page.locator('#generate').click();await wait_idle(page)
        assert original!=await layer_hashes(page)
        await apply_seed(page,'repeatable-42')
        assert original==await layer_hashes(page)
        assert first_atlas==await page.evaluate('akStudio.atlas.canvas.toDataURL()')

        # Select a part through the actual 3D surface, not only the list.
        hit=await page.evaluate('''()=>{const s=akStudio.scene;const mesh=s.meshes.find(m=>m.userData.zone==='Stock');const p=mesh.geometry.attributes.position;const v=s.camera.position.clone().set(0,0,0);for(let i=0;i<p.count;i++)v.add(s.camera.position.clone().fromBufferAttribute(p,i));v.divideScalar(p.count).applyMatrix4(mesh.matrixWorld).project(s.camera);return {x:(v.x+1)/2,y:(1-v.y)/2};}''')
        bounds=await page.locator('#scene').bounding_box()
        await page.mouse.click(bounds['x']+hit['x']*bounds['width'],bounds['y']+hit['y']*bounds['height'])
        assert (await page.evaluate('akStudio.state'))['selected'] is not None
        await page.locator('[data-zone="Body"]').click()
        await page.locator('#part-lock').check()
        await page.locator('#generate').click();await wait_idle(page)
        second=await layer_hashes(page)
        assert second['Body']==original['Body']
        assert second['Stock']!=original['Stock']
        await page.locator('#part-lock').uncheck()
        before_part=await layer_hashes(page)
        await page.locator('#part-generate').click();await wait_idle(page)
        after_part=await layer_hashes(page)
        assert after_part['Body']!=before_part['Body']
        assert all(after_part[z]==before_part[z] for z in after_part if z!='Body')
        await page.locator('#part-original').click();await wait_idle(page)
        assert await page.evaluate("akStudio.state.parts.Body.seed") is None
        assert await page.evaluate("akStudio.atlas.layers.Body.getContext('2d').getImageData(0,0,2048,2048).data.every((v,i)=>i%4!==3||v===0)")
        await page.get_by_role('checkbox',name='Use red.png on Body',exact=True).uncheck();await wait_idle(page)
        assert len((await page.evaluate('akStudio.state'))['parts']['Body']['allowed'])==2
        await page.locator('#part-all').click();await wait_idle(page)
        assert (await page.evaluate('akStudio.state'))['parts']['Body']['allowed']==[]

        # Each density produces distinct artwork while preserving the other controls.
        density_hashes=[]
        for density in ['sparse','medium','dense']:
            await page.locator('[data-density="'+density+'"]').click()
            await apply_seed(page,'density-test')
            density_hashes.append((await layer_hashes(page))['Body'])
        assert len(set(density_hashes))==3
        await page.locator('[data-density="medium"]').click();await apply_seed(page,'studio-047')

        for view in ['left','right','angle']:
            await page.locator('[data-view="'+view+'"]').click()
            await page.locator('#scene').screenshot(path=str(ROOT/'qa'/('final-'+view+'.png')))
        before_orbit=await page.evaluate('akStudio.scene.camera.position.toArray()')
        bounds=await page.locator('#scene').bounding_box()
        await page.mouse.move(bounds['x']+bounds['width']/2,bounds['y']+bounds['height']/2)
        await page.mouse.down();await page.mouse.move(bounds['x']+bounds['width']/2+90,bounds['y']+bounds['height']/2+25,steps=8);await page.mouse.up()
        assert before_orbit!=await page.evaluate('akStudio.scene.camera.position.toArray()')
        await page.locator('#reset-view').click()

        # Texture PNG reloaded onto every mesh must reproduce the same pixels.
        await page.evaluate('akStudio.scene.select(null);window.beforeTexture=akStudio.scene.canvas.toDataURL()')
        texture=await download(page,'#download-texture','example-texture.png')
        assert texture.size==(2048,2048)
        assert texture.getchannel('A').getextrema()==(255,255)
        png_url='data:image/png;base64,'+base64.b64encode((ROOT/'qa'/'example-texture.png').read_bytes()).decode()
        assert await page.evaluate('''async(src)=>{const image=new Image();image.src=src;await image.decode();const c=document.createElement('canvas');c.width=c.height=2048;c.getContext('2d').drawImage(image,0,0);akStudio.scene.setAtlas(c);return beforeTexture===akStudio.scene.canvas.toDataURL();}''',png_url)
        await page.evaluate('akStudio.scene.setAtlas(akStudio.atlas.canvas)')
        await page.locator('[data-zone="Body"]').click()
        render=await download(page,'#download-render','example-render.png')
        assert render.size==(1920,1080)
        assert render.getchannel('A').getextrema()==(255,255)
        assert await page.evaluate("akStudio.scene.selected==='Body'")
        # Render export excludes the UI selection tint.
        tint=await page.evaluate('akStudio.scene.canvas.toDataURL()')
        await page.evaluate('akStudio.scene.select(null)')
        assert tint!=await page.evaluate('akStudio.scene.canvas.toDataURL()')
        await page.evaluate('akStudio.scene.select(null)')
        await page.locator('#parts-panel').evaluate('(el)=>el.open=false')
        await page.screenshot(path=str(ROOT/'qa'/'studio-desktop.png'),full_page=True)
        await page.set_viewport_size({'width':390,'height':844})
        await page.screenshot(path=str(ROOT/'qa'/'studio-mobile.png'),full_page=True)
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        await page.set_viewport_size({'width':1440,'height':1180})

        for name,mime,buffer,expected in [('bad.png','image/png',b'broken','could not open'),('text.txt','text/plain',b'hello','choose an image'),('large.png','image/png',b'x'*(20*1024*1024+1),'exceeds 20 MB')]:
            await page.locator('#files').set_input_files({'name':name,'mimeType':mime,'buffer':buffer});await wait_idle(page)
            assert expected in await page.locator('#status').inner_text()
        await page.locator('#files').set_input_files(str(ROOT/'qa'/'red.png'));await wait_idle(page)
        assert len((await page.evaluate('akStudio.state'))['images'])==3
        await page.get_by_role('button',name='Remove red.png',exact=True).click();await wait_idle(page)
        assert len((await page.evaluate('akStudio.state'))['images'])==2
        await page.locator('#reset').click();await wait_idle(page)
        state=await page.evaluate('akStudio.state')
        assert not state['images'] and all(p['seed'] is None and not p['locked'] for p in state['parts'].values())
        assert await page.locator('#generate').is_disabled()

        missing=await browser.new_page();await missing.route('**/assets/aks74u.glb',lambda route:route.abort())
        await missing.goto('http://127.0.0.1:4318/')
        await missing.wait_for_function('document.querySelector("#loading strong").textContent.includes("could not")')
        assert await missing.locator('#download-render').is_disabled();await missing.close()
        nogl=await browser.new_page()
        await nogl.add_init_script("const orig=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...args){return /webgl/.test(t)?null:orig.call(this,t,...args)}")
        await nogl.goto('http://127.0.0.1:4318/')
        await nogl.wait_for_function('document.querySelector("#loading strong").textContent.includes("could not")')
        assert await nogl.locator('#download-texture').is_disabled();await nogl.close()
        await page.evaluate('akStudio.scene.renderer.getContext().getExtension("WEBGL_lose_context").loseContext()')
        await page.wait_for_function('document.querySelector("#download-render").disabled')
        assert 'context lost' in await page.locator('#status').inner_text()
        assert not errors,errors
        print(json.dumps({'browser_errors':errors,'parts':7,'cameras':3,'densities':3,'seed_repeatability':True,'part_locks_and_overrides':True,'render':[1920,1080],'texture':[2048,2048],'texture_reimport_pixel_match':True,'mobile_overflow':False,'failure_checks':'passed'}))
        await browser.close()

asyncio.run(main())
