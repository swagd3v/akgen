import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { backgrounds,cameras,imageRect } from './generator.js';

// Calibration uses the real wrist/finger rig, in the palm's coordinate system.
// Units below are native hand units. Phone source units are normalized to this grip.
export const GRIP = {
 palm:'Bone26_15', visibleMeshes:['Object_11','Object_12','Object_13'],
 phoneScale:.25, phoneCenter:[-.2,-1.4,1.32],
 rotation:-Math.PI/2-.32, position:[1.25,-.55,0],
};
const DISPLAY_Z=4.444224;

export class PhoneScene {
 constructor(canvas){
  this.canvas=canvas;this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setSize(540,675,false);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;
  this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(39,4/5,.1,100);
  this.rig=new THREE.Group();this.scene.add(this.rig);this.rig.rotation.z=GRIP.rotation;this.rig.position.fromArray(GRIP.position);
  this.ambient=new THREE.HemisphereLight(0xd8eaff,0x3d3025,2.2);this.scene.add(this.ambient);
  this.key=new THREE.DirectionalLight(0xffffff,3.5);this.key.position.set(-3,5,7);this.scene.add(this.key);
  this.fill=new THREE.DirectionalLight(0xbacfff,1.3);this.fill.position.set(4,1,5);this.scene.add(this.fill);
  this.rim=new THREE.DirectionalLight(0xb6d4ff,2.5);this.rim.position.set(3,4,-3);this.scene.add(this.rim);
  this.screenCanvas=document.createElement('canvas');this.screenCanvas.width=768;this.screenCanvas.height=1576;
  this.screenTexture=new THREE.CanvasTexture(this.screenCanvas);this.screenTexture.colorSpace=THREE.SRGBColorSpace;this.screenTexture.anisotropy=this.renderer.capabilities.getMaxAnisotropy();
  this.bgCanvas=document.createElement('canvas');this.bgCanvas.width=1080;this.bgCanvas.height=1350;this.bgTexture=new THREE.CanvasTexture(this.bgCanvas);this.bgTexture.colorSpace=THREE.SRGBColorSpace;this.scene.background=this.bgTexture;
  this.render=()=>this.renderer.render(this.scene,this.camera);
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas.parentElement);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();canvas.dispatchEvent(new CustomEvent('scene-error',{detail:'The graphics context was lost. Reload to restore the studio.'}));});
 }
 async load(){
  const loader=new GLTFLoader();const [hand,phone]=await Promise.all([loader.loadAsync('./assets/hand.glb'),loader.loadAsync('./assets/phone.glb')]);
  hand.scene.updateMatrixWorld(true);const palm=hand.scene.getObjectByName(GRIP.palm);if(!palm)throw Error('The expected hand rig is missing.');
  const inverse=palm.matrixWorld.clone().invert();
  // All meshes retain their original skin/skeleton and bind matrices.
  hand.scene.traverse(obj=>{if(obj.isMesh){obj.visible=GRIP.visibleMeshes.includes(obj.name);obj.frustumCulled=false;if(obj.material){obj.material.roughness=.83;obj.material.metalness=0;}}});
  const alignment=new THREE.Group();alignment.matrixAutoUpdate=false;alignment.matrix.copy(inverse);alignment.add(hand.scene);this.rig.add(alignment);this.hand=hand.scene;
  // Planar hinge rotations form a hook around the far edge: first joint
  // stays behind the device, middle joint clears the rim, tip returns inward.
  for(const names of [['Bone31_5','Bone32_4','Bone33_3'],['Bone35_8','Bone36_7','Bone37_6'],['Bone39_11','Bone40_10','Bone41_9'],['Bone43_14','Bone44_13','Bone45_12']]){
   names.forEach((name,index)=>hand.scene.getObjectByName(name).quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),THREE.MathUtils.degToRad(names[0]==='Bone43_14'?[-35,-85,-85][index]:(index===0?-60:-50))));
  }
  // Curl the actual thumb bones toward the near edge of the phone.
  this.scene.updateMatrixWorld(true);
  this.solveGrip(['Bone27_2','Bone28_1','Bone29_0'],[.68,0,0],[-1.05,-.25,1.5]);
  this.phone=new THREE.Group();this.rig.add(this.phone);
  // Work directly in the GLB mesh coordinates. The exporter root only changes axes.
  // Only the two coplanar display triangles get a new UV/material; the bezel is kept.
  let screenTriangles=0;
  phone.scene.traverse(obj=>{
   if(!obj.isMesh)return;let geometry=obj.geometry.clone();if(geometry.index)geometry=geometry.toNonIndexed();
   const p=geometry.attributes.position,n=geometry.attributes.normal;const body=[],bodyNormals=[],display=[],displayUV=[];
   for(let i=0;i<p.count;i+=3){const isDisplay=[0,1,2].every(k=>Math.abs(p.getZ(i+k)-DISPLAY_Z)<.0002);
    for(let k=0;k<3;k++){const j=i+k,x=p.getX(j),y=p.getY(j),z=p.getZ(j);const out=[x*GRIP.phoneScale+GRIP.phoneCenter[0],y*GRIP.phoneScale+GRIP.phoneCenter[1],(z-DISPLAY_Z)*GRIP.phoneScale+GRIP.phoneCenter[2]];
     if(isDisplay){display.push(...out);displayUV.push((y+4.374197)/(4.359792+4.374197),(8.963436-x)/(8.963436+8.993731));}else{body.push(...out);bodyNormals.push(n.getX(j),n.getY(j),n.getZ(j));}}
    if(isDisplay)screenTriangles++;
   }
   if(body.length){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(body,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(bodyNormals,3));const mat=new THREE.MeshStandardMaterial({color:obj.name==='Object_2'?0x25282b:0x34383e,roughness:.3,metalness:.65,side:THREE.DoubleSide});this.phone.add(new THREE.Mesh(geo,mat));}
   if(display.length){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(display,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(displayUV,2));geo.computeVertexNormals();this.screen=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:this.screenTexture,side:THREE.DoubleSide,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));this.phone.add(this.screen);}
  });
  if(screenTriangles!==2)throw Error('The phone screen geometry does not match its calibration.');
  this.scene.updateMatrixWorld(true);this.ready=true;this.resize();
 }
 solveGrip(names,tipOffset,targetInPalm){
  const chain=names.map(name=>this.hand.getObjectByName(name));
  const tip=new THREE.Object3D();tip.position.fromArray(tipOffset);chain.at(-1).add(tip);
  const target=new THREE.Vector3().fromArray(targetInPalm);this.rig.localToWorld(target);
  const world=new THREE.Quaternion(),parent=new THREE.Quaternion(),delta=new THREE.Quaternion();
  for(let iteration=0;iteration<24;iteration++)for(const bone of [...chain].reverse()){
   this.scene.updateMatrixWorld(true);
   const origin=bone.getWorldPosition(new THREE.Vector3());
   const current=tip.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
   const desired=target.clone().sub(origin).normalize();delta.setFromUnitVectors(current,desired);
   const angle=2*Math.acos(Math.min(1,Math.abs(delta.w)));if(angle>.2)delta.slerp(new THREE.Quaternion(),1-.2/angle);
   bone.parent.getWorldQuaternion(parent);world.copy(parent).invert().multiply(delta).multiply(parent);
   bone.quaternion.premultiply(world).normalize();
  }
  this.scene.updateMatrixWorld(true);
 }
 setBackground(id){const preset=backgrounds.find(b=>b.id===id)||backgrounds[0];const c=this.bgCanvas.getContext('2d');const g=c.createLinearGradient(0,0,1080,1350);g.addColorStop(0,preset.top);g.addColorStop(1,preset.bottom);c.fillStyle=g;c.fillRect(0,0,1080,1350);const glow=c.createRadialGradient(460,470,0,460,470,700);glow.addColorStop(0,preset.accent+'88');glow.addColorStop(1,preset.accent+'00');c.fillStyle=glow;c.fillRect(0,0,1080,1350);this.bgTexture.needsUpdate=true;}
 setLighting(id){if(id==='warm'){this.key.color.set(0xffd4a1);this.fill.color.set(0xb7d4ef);this.rim.color.set(0xffe0ac);this.key.intensity=4;this.ambient.intensity=1.9;}else if(id==='cool'){this.key.color.set(0xe1edff);this.fill.color.set(0x92aeff);this.rim.color.set(0x62cfff);this.key.intensity=3.1;this.ambient.intensity=1.7;}else{this.key.color.set(0xfff6ed);this.fill.color.set(0xc8dcf3);this.rim.color.set(0xb6d4ff);this.key.intensity=3.5;this.ambient.intensity=2.2;}}
 setScreen(image,fit){const c=this.screenCanvas.getContext('2d'),w=c.canvas.width,h=c.canvas.height;c.fillStyle='#0c1115';c.fillRect(0,0,w,h);if(image)c.drawImage(image,...imageRect(image.width,image.height,w,h,fit));else this.placeholder(c,w,h);this.screenTexture.needsUpdate=true;}
 placeholder(c,w,h){const g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,'#162938');g.addColorStop(.5,'#253443');g.addColorStop(1,'#565241');c.fillStyle=g;c.fillRect(0,0,w,h);c.strokeStyle='#bde78c';c.lineWidth=4;c.beginPath();for(let i=0;i<46;i++){const x=54+i*15,y=1080-i*6-Math.sin(i*.53)*60;i?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();c.fillStyle='#bde78c';c.font='22px monospace';c.fillText('POCKET / STUDIO',55,170);c.fillStyle='#f6f5ed';c.font='70px sans-serif';c.fillText('A world',55,560);c.fillText('in your',55,645);c.fillText('hands.',55,730);c.fillStyle='#bec8ce';c.font='23px sans-serif';c.fillText('Your image goes here.',55,1250);}
 apply(config,image){this.config=config;const p=cameras.find(c=>c.id===config.camera)||cameras[0];this.camera.position.fromArray(p.position);this.camera.lookAt(new THREE.Vector3().fromArray(p.target));this.setBackground(config.background);this.setLighting(config.lighting);this.setScreen(image,config.fit);this.render();}
 resize(){const width=Math.min(this.canvas.parentElement.clientWidth,700);if(!width)return;this.renderer.setSize(width,width*1.25,false);this.camera.aspect=.8;this.camera.updateProjectionMatrix();if(this.config)this.render();}
 async exportPNG(){if(!this.ready)throw Error('The models are still loading.');const size=this.renderer.getSize(new THREE.Vector2()),ratio=this.renderer.getPixelRatio();try{this.renderer.setPixelRatio(1);this.renderer.setSize(1080,1350,false);this.render();return await new Promise((resolve,reject)=>this.canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG export failed.')),'image/png'));}finally{this.renderer.setPixelRatio(ratio);this.renderer.setSize(size.x,size.y,false);this.render();}}
 dispose(){this.observer.disconnect();this.scene.traverse(obj=>{obj.geometry?.dispose();for(const m of Array.isArray(obj.material)?obj.material:[obj.material])m?.dispose();});this.screenTexture.dispose();this.bgTexture.dispose();this.renderer.dispose();}
}
