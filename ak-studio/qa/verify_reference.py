import asyncio,json,struct,hashlib
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 source=Path('ak-studio/csgo_ak-47_pov_with_arms.glb').read_bytes();copy=Path('ak-studio/assets/pov-grip.glb').read_bytes();assert hashlib.sha256(source).digest()==hashlib.sha256(copy).digest()
 length=struct.unpack_from('<I',source,12)[0];g=json.loads(source[20:20+length]);expected=[{'name':n['name'],'rotation':n.get('rotation',[0,0,0,1])} for n in g['nodes'] if 'Finger' in n.get('name','')]
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']);page=await b.new_page();await page.goto('http://127.0.0.1:4318/?debug=1');await page.wait_for_function('window.akStudio?.ready');await page.locator('[data-view="hands"]').click();await page.wait_for_function('!document.querySelector("#download-render").disabled');result=await page.evaluate('''async expected=>{const T=await import('./vendor/three.module.js');let max=0;for(const n of expected){const bone=akStudio.scene.hands.getObjectByName(T.PropertyBinding.sanitizeNodeName(n.name));if(!bone)throw Error('Missing '+n.name);bone.quaternion.toArray().forEach((v,i)=>max=Math.max(max,Math.abs(v-n.rotation[i])));}return {fingerBones:expected.length,maxRotationDifference:max};}''',expected);assert result['maxRotationDifference']<1e-6;print(json.dumps(result));await b.close()
asyncio.run(main())
