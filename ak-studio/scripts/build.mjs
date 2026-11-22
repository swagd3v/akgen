// Checks every source file's syntax and every model's header, then copies
// the self-contained static app into dist/.
import {cp, mkdir, readFile, readdir, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

async function filesUnder(directory, extension) {
  const entries = await readdir(join(root, directory), {withFileTypes: true, recursive: true});
  return entries.filter(entry => entry.isFile() && entry.name.endsWith(extension)).map(entry => join(entry.parentPath ?? entry.path, entry.name));
}

for (const file of [...await filesUnder('src', '.js'), ...await filesUnder('scripts', '.mjs')]) {
  const result = spawnSync(process.execPath, ['--check', file], {stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const file of await filesUnder('assets', '.glb')) {
  if ((await readFile(file)).readUInt32LE(0) !== 0x46546c67) throw Error(`${file} is not a valid GLB.`);
}

JSON.parse(await readFile(join(root, 'assets', 'ak47-rig.json'), 'utf8'));

await rm(join(root, 'dist'), {recursive: true, force: true});
await mkdir(join(root, 'dist'), {recursive: true});
for (const path of ['index.html', 'styles.css', 'src', 'vendor', 'assets']) {
  await cp(join(root, path), join(root, 'dist', path), {recursive: true});
}
console.log('Built the self-contained AK Studio in dist/.');
