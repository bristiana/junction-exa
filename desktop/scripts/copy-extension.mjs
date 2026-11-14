import { cp, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('vendor/', root), { recursive: true });
// Copy at install/start/package time: extension remains the single source of truth.
for (const directory of ['lib', 'panel', 'mascot']) {
  await cp(new URL(`../extension/${directory}`, root), new URL(`vendor/${directory}`, root), { recursive: true });
}
