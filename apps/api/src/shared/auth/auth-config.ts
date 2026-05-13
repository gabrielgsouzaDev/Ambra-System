export interface AuthEnvironment {
  JWT_SECRET?: string;
  JWT_REFRESH_SECRET?: string;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtRefreshSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

const MIN_SECRET_LENGTH = 32;

export function loadAuthConfig(env: AuthEnvironment): AuthConfig {
  return {
    jwtSecret: readRequiredSecret(env.JWT_SECRET, 'JWT_SECRET'),
    jwtRefreshSecret: readRequiredSecret(env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET'),
    accessTokenTtlSeconds: 15 * 60,
    refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
  };
}

function readRequiredSecret(value: string | undefined, name: string): string {
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be set and at least 32 characters`);
  }

  return value;
}
