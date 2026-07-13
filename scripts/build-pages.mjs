// Stages the GitHub Pages site into _site/: everything in site/ plus the
// README screenshot. Node builtins only, so CI needs no npm install.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const out = path.join(root, '_site');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'site'), out, { recursive: true });
cpSync(path.join(root, 'docs/preview.png'), path.join(out, 'preview.png'));

console.log(`Pages site staged in ${out}`);
