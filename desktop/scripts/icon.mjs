// Builds build/icon.icns (the app and dmg icon) from the extension's mascot icon. Needs rsvg-convert (brew install
// librsvg) and macOS iconutil; without them the committed build/icon.icns is kept as it is.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url), at = p => fileURLToPath(new URL(p, root));
const has = cmd => spawnSync('/usr/bin/which', [cmd]).status === 0;
if (!has('rsvg-convert') || !has('iconutil')) { console.log('icon: rsvg-convert or iconutil missing, keeping build/icon.icns'); process.exit(0); }
// The macOS grid: the tile fills about 80% of the canvas, centered.
const svg = (await readFile(at('../extension/icons/icon-mascot.svg'), 'utf8')).replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*<svg([^>]*?)\s(width|height)="[^"]*"([^>]*?)\s(width|height)="[^"]*"/, '<svg$1$3').replace(/^\s*<svg /, '<svg x="13" y="13" width="102" height="102" ');
await mkdir(at('build/icon.iconset'), { recursive: true });
await writeFile(at('build/icon-src.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${svg}</svg>`);
for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
  const px = size * scale, name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
  const r = spawnSync('rsvg-convert', ['-w', String(px), '-h', String(px), at('build/icon-src.svg'), '-o', at(`build/icon.iconset/${name}`)]);
  if (r.status) throw new Error(`rsvg-convert failed for ${name}: ${r.stderr}`);
}
spawnSync('rsvg-convert', ['-w', '1024', '-h', '1024', at('build/icon-src.svg'), '-o', at('build/icon.png')]);
const r = spawnSync('iconutil', ['-c', 'icns', at('build/icon.iconset'), '-o', at('build/icon.icns')]);
if (r.status) throw new Error(`iconutil failed: ${r.stderr}`);
await rm(at('build/icon.iconset'), { recursive: true }); await rm(at('build/icon-src.svg'));
console.log('icon: wrote build/icon.icns and build/icon.png');
