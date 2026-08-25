export type RuntimeRole = 'api' | 'relay' | 'worker';

export interface RedisConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  db: number;
}

export function readRuntimeRole(env: NodeJS.ProcessEnv = process.env): RuntimeRole {
  const role = env.RUNTIME_ROLE ?? 'api';
  if (role === 'api' || role === 'relay' || role === 'worker') return role;
  throw new Error('RUNTIME_ROLE must be one of api, relay, or worker.');
}

export function readRedisConfig(env: NodeJS.ProcessEnv = process.env): RedisConfig {
  const port = Number(env.REDIS_PORT ?? 6379);
  const db = Number(env.REDIS_DB ?? 0);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('REDIS_PORT must be a valid TCP port.');
  if (!Number.isInteger(db) || db < 0) throw new Error('REDIS_DB must be a non-negative integer.');
  const allowUnauthenticatedTestConnection =
    env.NODE_ENV === 'test' && env.REDIS_TEST_ALLOW_UNAUTHENTICATED === 'true';
  const username = requiredCredential(
    env.REDIS_USERNAME,
    'REDIS_USERNAME',
    allowUnauthenticatedTestConnection,
  );
  const password = requiredCredential(
    env.REDIS_PASSWORD,
    'REDIS_PASSWORD',
    allowUnauthenticatedTestConnection,
  );
  return {
    host: required(env.REDIS_HOST, 'REDIS_HOST'),
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(env.REDIS_TLS === 'true' ? { tls: {} } : {}),
    db,
  };
}

function requiredCredential(value: string | undefined, name: string, allowTestException: boolean) {
  if (value?.trim()) return value;
  if (allowTestException) return undefined;
  throw new Error(
    `${name} is required for relay and worker runtimes; only NODE_ENV=test with REDIS_TEST_ALLOW_UNAUTHENTICATED=true may omit it.`,
  );
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required for relay and worker runtimes.`);
  return value;
}
