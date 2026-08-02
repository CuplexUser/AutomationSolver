// Stages the GitHub Pages site into _site/: everything in site/, the gallery
// screenshots from docs/shots/, and the social preview image.
// Node builtins only, so CI needs no npm install.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const out = path.join(root, '_site');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'site'), out, { recursive: true });
cpSync(path.join(root, 'docs/shots'), path.join(out, 'shots'), { recursive: true });

// og:image only — the page itself uses the WebP gallery.
const preview = path.join(root, 'docs/preview.png');
if (existsSync(preview)) cpSync(preview, path.join(out, 'preview.png'));

console.log(`Pages site staged in ${out}`);
