import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
for (const dir of ['', 'scripts/', 'test/']) {
  for (const name of await readdir(new URL(dir, root))) {
    if (!/\.(mjs|cjs)$/.test(name)) continue;
    const check = spawnSync(process.execPath, ['--check', new URL(dir + name, root).pathname], { stdio: 'inherit' });
    if (check.status) process.exit(check.status);
  }
}
