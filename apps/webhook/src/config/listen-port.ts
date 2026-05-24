import type { Env } from './env.schema';

type ListenPortSource = 'PORT' | 'default';

const DEFAULT_LISTEN_PORT = 4001;

export function resolveListenPort(env: Pick<Env, 'PORT'>): {
  port: number;
  source: ListenPortSource;
} {
  if (env.PORT !== undefined) {
    return { port: env.PORT, source: 'PORT' };
  }

  return { port: DEFAULT_LISTEN_PORT, source: 'default' };
}
