const fs = require("node:fs");
const { builtinModules } = require("node:module");
const path = require("node:path");

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

// loader.ts 在 packages/optimization-strategy/src/error-pattern-analysis/prompts/ 用
// readFileSync(__dirname + '/*.md') 加载 prompt 模板；webpack bundle 后 __dirname
// 解析为 apps/server/dist/，需要把 .md 平铺复制过去。
const OPTIMIZATION_PROMPT_DIR = path.resolve(
  __dirname,
  "../../packages/optimization-strategy/src/error-pattern-analysis/prompts",
);

class CopyOptimizationPromptsPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tapAsync("CopyOptimizationPromptsPlugin", (compilation, callback) => {
      const distDir = compiler.options.output.path;
      try {
        for (const file of fs.readdirSync(OPTIMIZATION_PROMPT_DIR)) {
          if (!file.endsWith(".md")) continue;
          fs.copyFileSync(path.join(OPTIMIZATION_PROMPT_DIR, file), path.join(distDir, file));
        }
        callback();
      } catch (err) {
        callback(err);
      }
    });
  }
}

module.exports = (options) => ({
  ...options,
  externals: [
    ({ request }, callback) => {
      if (!request || request.startsWith(".") || path.isAbsolute(request)) {
        callback();
        return;
      }

      if (request.startsWith("@proofhound/")) {
        callback();
        return;
      }

      callback(null, builtins.has(request) ? `node-commonjs ${request}` : `commonjs ${request}`);
    },
  ],
  plugins: [...(options.plugins ?? []), new CopyOptimizationPromptsPlugin()],
  watchOptions: {
    ...options.watchOptions,
    ignored: [
      "**/.git/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
    ],
  },
});
