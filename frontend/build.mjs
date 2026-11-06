// Bundles the renderer (xterm, fonts, UI) into dist/. Run with --watch while developing.
import { context, build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

mkdirSync('dist', { recursive: true });
copyFileSync('src/renderer/index.html', 'dist/index.html');

const options = {
  entryPoints: ['src/renderer/app.js'],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome130',
  sourcemap: true,
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  assetNames: 'assets/[name]-[hash]',
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
