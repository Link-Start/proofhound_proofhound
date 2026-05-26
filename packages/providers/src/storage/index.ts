// StorageProvider interface; the concrete object storage implementation is injected by the deployment side.
// See docs/specs/04-postgresql.md
export type StorageProvider = Record<string, never>;
