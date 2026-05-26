// V1 default strategy — error pattern analysis + new version generation
// See docs/specs/25-optimizations.md §3
//
// Key system prompt templates live in ./prompts/*.md, loaded synchronously by ./prompts/loader.ts.
// To modify a prompt → edit the .md file → restart the process for it to take effect.
export * from './config.schema';
export * from './parse';
export * from './prompts';
export * from './confusion-pairs';
export * from './analyze';
export * from './generate';
export * from './generate-initial';
