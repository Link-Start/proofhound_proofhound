#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const releasePaths = ['package.json', 'CHANGELOG.md'];
const dryRun = process.argv.includes('--dry-run');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitInherit(args) {
  execFileSync('git', args, { stdio: 'inherit' });
}

function changedFiles(args) {
  const output = git(args);
  return output ? output.split('\n').filter(Boolean) : [];
}

function isReleaseFile(file) {
  return file === 'package.json' || file === 'CHANGELOG.md';
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const version = packageJson.version;
if (!version) {
  console.error('release:commit failed: package.json has no version field.');
  process.exit(1);
}

const stagedFiles = changedFiles(['diff', '--cached', '--name-only']);
const unrelatedStaged = stagedFiles.filter((file) => !isReleaseFile(file));
if (unrelatedStaged.length > 0) {
  console.error('release:commit refused: unrelated files are already staged.');
  console.error(unrelatedStaged.map((file) => `  - ${file}`).join('\n'));
  console.error('Commit or unstage them before running pnpm release.');
  process.exit(1);
}

const releaseChanges = new Set([
  ...changedFiles(['diff', '--name-only', '--', ...releasePaths]),
  ...stagedFiles.filter(isReleaseFile),
  ...changedFiles(['ls-files', '--others', '--exclude-standard', '--', ...releasePaths]),
]);

if (releaseChanges.size === 0) {
  console.log('No release artifacts changed; skipping release commit.');
  process.exit(0);
}

const message = `chore(release): v${version}`;

if (dryRun) {
  console.log(`Would commit release artifacts as "${message}":`);
  for (const file of [...releaseChanges].sort()) console.log(`  - ${file}`);
  process.exit(0);
}

gitInherit(['add', '--', ...releasePaths]);

const stagedReleaseFiles = changedFiles(['diff', '--cached', '--name-only', '--', ...releasePaths]);
if (stagedReleaseFiles.length === 0) {
  console.log('No release artifacts staged; skipping release commit.');
  process.exit(0);
}

gitInherit(['commit', '-m', message]);
