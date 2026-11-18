import {cp, mkdir, readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const file of ['src/app.js', 'src/scene.js', 'src/collage.js', 'src/generator.js', 'src/hands.js', 'src/animated-model.js', 'src/cs2-hands.js', 'src/cs2-weapon.js', 'scripts/serve.mjs']) {
  const result = spawnSync(process.execPath, ['--check', file], {cwd: root, stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const name of ['ak47', 'aks74u', 'ak47-cs2', 'pov-grip', ...['hardknuckle', 'hardknuckle-black', 'fingerless', 'fullfinger', 'fbi', 'sas', 'balkan'].map(name => `cs2/${name}`)]) {
  const glb = await readFile(new URL(`../assets/${name}.glb`, import.meta.url));
  if (glb.readUInt32LE(0) !== 0x46546c67) throw Error(`The ${name} asset is not a valid GLB.`);
}
await mkdir(new URL('../dist/', import.meta.url), {recursive: true});
for (const path of ['index.html', 'styles.css', 'src', 'vendor', 'assets']) {
  await cp(new URL('../' + path, import.meta.url), new URL('../dist/' + path, import.meta.url), {recursive: true});
}
console.log('Built the self-contained AK Studio in dist/.');
