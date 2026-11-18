// Runs vitest from a path whose drive letter is uppercase. A plain
// pass-through everywhere but Windows.
//
// A shell opened in d:\… (VS Code opens a workspace that way) starts vitest
// from the lowercase path, while realpath hands the test files' own
// `import 'vitest'` the D:\… one. Node takes the two spellings for two
// modules and loads vitest twice; the tests then register on the copy the
// runner never reads, and every file fails with "Vitest failed to find the
// current suite".
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..').replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const vitest = join(root, 'node_modules', 'vitest');
const { bin } = JSON.parse(readFileSync(join(vitest, 'package.json'), 'utf8'));

const { status } = spawnSync(process.execPath, [join(vitest, bin.vitest), ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(status ?? 1);
