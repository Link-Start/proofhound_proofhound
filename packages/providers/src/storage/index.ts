// StorageProvider 接口；具体对象存储实现由部署侧注入。
// 详见 docs/specs/04-postgresql.md
export type StorageProvider = Record<string, never>;
