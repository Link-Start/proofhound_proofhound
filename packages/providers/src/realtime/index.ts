// RealtimeProvider interface; runtime streaming events prefer NestJS SSE.
// See docs/specs/04-postgresql.md §5
export type RealtimeProvider = Record<string, never>;
