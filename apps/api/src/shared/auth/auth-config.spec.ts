import assert from 'node:assert/strict';
import test from 'node:test';

import { loadAuthConfig } from './auth-config.ts';

const LONG_SECRET = '0123456789abcdef0123456789abcdef';

test('loadAuthConfig rejects a missing access token secret', () => {
  assert.throws(
    () => loadAuthConfig({ JWT_REFRESH_SECRET: LONG_SECRET }),
    /JWT_SECRET must be set and at least 32 characters/,
  );
});

test('loadAuthConfig rejects a short refresh token secret', () => {
  assert.throws(
    () => loadAuthConfig({ JWT_SECRET: LONG_SECRET, JWT_REFRESH_SECRET: 'short' }),
    /JWT_REFRESH_SECRET must be set and at least 32 characters/,
  );
});

test('loadAuthConfig returns the canonical token lifetimes', () => {
  const config = loadAuthConfig({
    JWT_SECRET: LONG_SECRET,
    JWT_REFRESH_SECRET: `${LONG_SECRET}refresh`,
  });

  assert.equal(config.accessTokenTtlSeconds, 15 * 60);
  assert.equal(config.refreshTokenTtlSeconds, 7 * 24 * 60 * 60);
});
