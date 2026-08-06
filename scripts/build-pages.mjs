// Finishes staging the GitHub Pages site in _site/.
//
// Vite has already built site/index.html and its demo bundle into _site/ by the
// time this runs (see the build:pages script); this step adds the files Vite
// never sees: the gallery screenshots and the social preview image.
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const out = path.join(root, '_site');

if (!existsSync(path.join(out, 'index.html'))) {
  console.error('_site/index.html is missing — run the Vite build first (npm run build:pages).');
  process.exit(1);
}

cpSync(path.join(root, 'docs/shots'), path.join(out, 'shots'), { recursive: true });

// og:image only — the page itself uses the WebP gallery.
const preview = path.join(root, 'docs/preview.png');
if (existsSync(preview)) cpSync(preview, path.join(out, 'preview.png'));

console.log(`Pages site staged in ${out}`);
