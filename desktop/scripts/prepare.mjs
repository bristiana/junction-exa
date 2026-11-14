// Source stays owned by the extension. Refresh these copies on install/start/package.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
for (const dir of ['lib', 'panel', 'mascot']) {
  await mkdir(new URL(`vendor/${dir}/`, root), { recursive: true });
  await cp(new URL(`../../extension/${dir}/`, import.meta.url), new URL(`vendor/${dir}/`, root), { recursive: true });
}
const path = new URL('vendor/panel/panel.html', root);
const original = await readFile(path, 'utf8');
await writeFile(path, original.replace('<head>', `<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; connect-src 'none'">
  <link rel="stylesheet" href="../../renderer/panel.css">
  <script src="../../renderer/shim.js"></script>
  <script defer src="../../renderer/panel-adapter.js"></script>`));
console.log('Refreshed extension UI and libraries in', fileURLToPath(new URL('vendor/', root)));
