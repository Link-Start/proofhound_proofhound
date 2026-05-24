type PublicEnvName = 'NEXT_PUBLIC_SERVER_URL' | 'NEXT_PUBLIC_API_URL';

function readPublicEnv(name: PublicEnvName): string | undefined {
  if (typeof process === 'undefined') return undefined;
  let value: string | undefined;
  switch (name) {
    case 'NEXT_PUBLIC_SERVER_URL':
      value = process.env.NEXT_PUBLIC_SERVER_URL;
      break;
    case 'NEXT_PUBLIC_API_URL':
      value = process.env.NEXT_PUBLIC_API_URL;
      break;
  }
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isProductionRuntime() {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
}

function requirePublicEnv(name: PublicEnvName, fallback?: string): string {
  const value = readPublicEnv(name);
  if (value) return value;
  if (!isProductionRuntime() && fallback) return fallback;
  throw new Error(`${name} is required for ProofHound web deployment.`);
}

function normalizePublicUrlEnv(name: PublicEnvName, value: string): string {
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
}

function requirePublicUrlEnv(name: PublicEnvName, fallback?: string): string {
  return normalizePublicUrlEnv(name, requirePublicEnv(name, fallback));
}

export function getServerBaseUrl() {
  const serverUrl = readPublicEnv('NEXT_PUBLIC_SERVER_URL');
  if (serverUrl) return normalizePublicUrlEnv('NEXT_PUBLIC_SERVER_URL', serverUrl);

  const legacyApiUrl = readPublicEnv('NEXT_PUBLIC_API_URL');
  if (legacyApiUrl) return normalizePublicUrlEnv('NEXT_PUBLIC_API_URL', legacyApiUrl);

  return requirePublicUrlEnv('NEXT_PUBLIC_SERVER_URL', 'http://localhost:4000');
}
