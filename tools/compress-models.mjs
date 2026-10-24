// Compresses the raw Blender exports (blender/out/*.glb) into assets/models/ with meshopt.
// Run after `python blender/build_all.py` (it calls this automatically when node is installed).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'blender', 'out');
const dst = join(root, 'assets', 'models');
mkdirSync(dst, { recursive: true });
const cli = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'gltf-transform.cmd' : 'gltf-transform');

for (const f of readdirSync(src).filter((f) => f.endsWith('.glb'))) {
  const out = join(dst, f);
  if (existsSync(cli)) {
    execFileSync(cli, ['meshopt', join(src, f), out], { stdio: 'inherit' });
  } else {
    console.warn('gltf-transform not installed (npm install); copying uncompressed', f);
    copyFileSync(join(src, f), out);
  }
  console.log(`${f}: ${(statSync(join(src, f)).size / 1e6).toFixed(2)} MB -> ${(statSync(out).size / 1e6).toFixed(2)} MB`);
}
