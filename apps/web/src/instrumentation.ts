export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { createLogger } = await import('@proofhound/logger');
  const logger = createLogger('web.instrumentation', { service: 'web' });

  logger.info({ port: process.env.PORT ?? 3000 }, 'web_started');
}
