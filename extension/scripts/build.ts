import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const watch = process.argv.includes('--watch') || Bun.argv.includes('build:watch');
const outdir = 'dist';

mkdirSync(outdir, { recursive: true });

// Copy static files
copyFileSync('manifest.json', join(outdir, 'manifest.json'));
copyFileSync('src/popup/popup.html', join(outdir, 'popup.html'));

// Copy or create placeholder icons
const iconSizes = [16, 48, 128];
for (const size of iconSizes) {
  const src = `icons/icon${size}.png`;
  const dst = join(outdir, `icon${size}.png`);
  if (existsSync(src)) {
    copyFileSync(src, dst);
  }
}

const buildOptions: esbuild.BuildOptions = {
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
};

const ctx = await esbuild.context({
  ...buildOptions,
  entryPoints: [
    { in: 'src/background/service-worker.ts', out: 'background' },
    { in: 'src/content/index.ts', out: 'content' },
    { in: 'src/popup/popup.ts', out: 'popup' },
  ],
  outdir,
});

if (watch) {
  await ctx.watch();
  console.log('[Moonlit Extension] watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('[Moonlit Extension] built to dist/');
}
