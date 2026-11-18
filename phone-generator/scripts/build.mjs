import {cp,mkdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));for(const f of ['src/app.js','src/scene.js','src/generator.js']){const r=spawnSync(process.execPath,['--check',f],{cwd:root,stdio:'inherit'});if(r.status!==0)process.exit(1);}
for(const f of ['assets/phone.glb','assets/hand.glb']){const bytes=await readFile(new URL('../'+f,import.meta.url));if(bytes.readUInt32LE(0)!==0x46546c67)throw Error('Invalid GLB: '+f);}
const dist=new URL('../dist/',import.meta.url);await mkdir(dist,{recursive:true});for(const name of ['index.html','styles.css','src','vendor','assets'])await cp(new URL('../'+name,import.meta.url),new URL(name,dist),{recursive:true});console.log('Built standalone app in dist/ (no external dependencies).');
