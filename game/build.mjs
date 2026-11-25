// Baut das Spiel: bündelt game/src/main.js nach game/dist/game.js und kopiert index.html.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
await build({
  entryPoints: [join(here, 'src', 'main.js')],
  outfile: join(dist, 'game.js'),
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: false,
  target: ['es2020', 'safari15'],
  legalComments: 'none',
  logLevel: 'warning',
});
copyFileSync(join(here, 'index.html'), join(dist, 'index.html'));
console.log('game/dist/game.js', Math.round(statSync(join(dist, 'game.js')).size / 1024), 'KB');
