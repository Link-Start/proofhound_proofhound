import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

// DBOS workflow 集成测试配置 ——
//   - DBOS.launch() 是全局单例 + setup.ts beforeAll 扫悬空 dbos_test_* schema,
//     多 worker 并行会互相误伤;singleFork + fileParallelism:false 串行化,
//     与旧 jest.integration.config.js 的 maxWorkers:1 等价。
//   - hookTimeout:300s 给 DBOS.launch + NestJS module init 充足时间(远程 PostgreSQL
//     首次握手 + DBOS 跑 sysdb migration + 注册 LISTEN/NOTIFY,瞬时网络抖动也可能拖延)。
//   - teardownTimeout:60s 给 afterAll 的 module.close + DBOS.shutdown + DROP SCHEMA + pool.end()。

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/dbos/**/*.spec.ts'],
    exclude: ['test/e2e/**', 'node_modules/**', 'dist/**'],
    pool: 'forks',
    forks: { singleFork: true },
    fileParallelism: false,
    sequence: { concurrent: false },
    setupFiles: ['reflect-metadata'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    teardownTimeout: 60_000,
    passWithNoTests: true,
  },
});
