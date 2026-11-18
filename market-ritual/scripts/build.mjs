import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await mkdir(resolve(dist, 'assets'), { recursive: true });

const compiler = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(process.execPath, [compiler, '-p', resolve(root, 'tsconfig.build.json')], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

await cp(resolve(root, 'public'), dist, { recursive: true });
await cp(resolve(root, 'vendor'), resolve(dist, 'vendor'), { recursive: true });
await cp(resolve(root, '.openai'), resolve(dist, '.openai'), { recursive: true });
await cp(resolve(root, 'src', 'styles.css'), resolve(dist, 'assets', 'styles.css'));
await cp(resolve(root, 'index.html'), resolve(dist, 'index.html'));

for (const name of await readdir(resolve(dist, 'assets'))) {
  if (!name.endsWith('.js')) continue;
  const path = resolve(dist, 'assets', name);
  const source = await readFile(path, 'utf8');
  const rewritten = source.replaceAll(/from ['"](\.\/[^'"]+?)(?<!\.js)['"]/g, "from '$1.js'");
  await writeFile(path, rewritten);
}

console.log('Built static Site in dist/');
