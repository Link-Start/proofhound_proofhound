const { builtinModules } = require('node:module');
const path = require('node:path');

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

module.exports = (options) => ({
  ...options,
  externals: [
    ({ request }, callback) => {
      if (!request || request.startsWith('.') || path.isAbsolute(request)) {
        callback();
        return;
      }

      if (request.startsWith('@proofhound/')) {
        callback();
        return;
      }

      callback(null, builtins.has(request) ? `node-commonjs ${request}` : `commonjs ${request}`);
    },
  ],
  watchOptions: {
    ...options.watchOptions,
    ignored: ['**/.git/**', '**/.next/**', '**/.turbo/**', '**/coverage/**', '**/dist/**', '**/node_modules/**'],
  },
});
