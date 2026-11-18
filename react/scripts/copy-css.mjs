// Copies the stylesheet into dist/ next to the compiled JS.
//
// tsc emits only what it compiles, so a CSS file in src/ never reaches a
// consumer: the export map would point at a path that does not exist, and the
// import would fail at build time in someone else's project.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

mkdirSync(join(root, 'dist'), { recursive: true });
copyFileSync(join(root, 'src', 'styles.css'), join(root, 'dist', 'styles.css'));
console.log('copied styles.css -> dist/');
