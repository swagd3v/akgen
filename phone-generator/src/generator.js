export const backgrounds = [
 {id:'ink',label:'Midnight ink',top:'#151d25',bottom:'#303d49',accent:'#596e79'},
 {id:'clay',label:'Warm clay',top:'#b5a594',bottom:'#e4d5c4',accent:'#f1e4d5'},
 {id:'sage',label:'Quiet sage',top:'#687b70',bottom:'#b7c5b6',accent:'#d5dfcb'},
 {id:'blue',label:'Studio blue',top:'#364f7c',bottom:'#91aaca',accent:'#bdcfe4'},
];
export const lights = [{id:'soft',label:'Softbox'},{id:'warm',label:'Golden hour'},{id:'cool',label:'Cool rim'}];
export const cameras = [{id:'front',label:'Straight on',position:[0,.15,11.5],target:[0,.2,0]},{id:'left',label:'Slight left',position:[-1.3,.5,11.5],target:[0,.2,0]},{id:'high',label:'Slight above',position:[.65,1.5,11.6],target:[0,.2,0]}];
export function seededRandom(seed){let h=2166136261;for(const c of String(seed)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return()=>{h+=0x6d2b79f5;let t=h;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
export function chooseScene(seed,imageIds=[],fit='cover'){const random=seededRandom(seed);const pick=a=>a[Math.floor(random()*a.length)];return {seed,imageId:imageIds.length?pick(imageIds):'placeholder',background:pick(backgrounds).id,lighting:pick(lights).id,camera:pick(cameras).id,fit};}
export function imageRect(iw,ih,w,h,fit){const scale=fit==='contain'?Math.min(w/iw,h/ih):Math.max(w/iw,h/ih);return [(w-iw*scale)/2,(h-ih*scale)/2,iw*scale,ih*scale];}
export const DEFAULT_SEED='pocket-001';
