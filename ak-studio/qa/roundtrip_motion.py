import asyncio,json
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page();await page.goto('http://127.0.0.1:4318/?debug=1');await page.wait_for_function('window.akStudio?.ready',timeout=90000)
  result=await page.evaluate('''async()=>{
   const T=await import('./vendor/three.module.js');const {GLTFLoader}=await import('./vendor/loaders/GLTFLoader.js');
   const copy=await new GLTFLoader().loadAsync('./qa/customized-aks74u.glb');
   const mixer=new T.AnimationMixer(copy.scene);let maximum=0,count=0;
   for(let c=0;c<7;c++){
    akStudio.scene.setClip(c);akStudio.scene.scrub(akStudio.scene.active.clips[c].duration*.5);
    mixer.stopAllAction();mixer.clipAction(copy.animations[c]).play();mixer.setTime(copy.animations[c].duration*.5);copy.scene.updateMatrixWorld(true);
    for(const source of akStudio.scene.meshes){
     const target=copy.scene.getObjectByName(source.name);source.skeleton.update();target.skeleton.update();
     for(const i of [0,Math.floor(source.geometry.attributes.position.count/2),source.geometry.attributes.position.count-1]){
      const a=source.getVertexPosition(i,new T.Vector3()).applyMatrix4(source.matrixWorld);
      const b=target.getVertexPosition(i,new T.Vector3()).applyMatrix4(target.matrixWorld);
      maximum=Math.max(maximum,a.distanceTo(b));count++;
     }
    }
   }
   return {clips:7,sampledAnimatedVertices:count,maximumPositionError:maximum};
  }''')
  assert result['maximumPositionError']<.0001,result
  print(json.dumps(result));await browser.close()
asyncio.run(main())
