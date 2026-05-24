import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(packageRoot, 'src/error-pattern-analysis/prompts');
const targetDir = join(packageRoot, 'dist/packages/optimization-strategy/src/error-pattern-analysis/prompts');

mkdirSync(targetDir, { recursive: true });

for (const fileName of readdirSync(sourceDir)) {
  if (!fileName.endsWith('.md')) continue;
  copyFileSync(join(sourceDir, fileName), join(targetDir, fileName));
}
