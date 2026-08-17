import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const baseEnvironment = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
  WEB_ORIGIN: 'http://localhost:3000',
  JWT_SECRET: 'test-secret-that-is-at-least-thirty-two-characters',
};

describe('authentication cookie environment configuration', () => {
  it('defaults development and test to insecure cookies', () => {
    expect(loadEnv(baseEnvironment).AUTH_COOKIE_SECURE).toBe(false);
    expect(loadEnv({ ...baseEnvironment, NODE_ENV: 'test' }).AUTH_COOKIE_SECURE).toBe(false);
  });

  it('parses explicit true and false strings without truthiness coercion', () => {
    expect(loadEnv({ ...baseEnvironment, AUTH_COOKIE_SECURE: 'true' }).AUTH_COOKIE_SECURE).toBe(true);
    expect(loadEnv({ ...baseEnvironment, AUTH_COOKIE_SECURE: 'false' }).AUTH_COOKIE_SECURE).toBe(false);
  });

  it('rejects unsupported boolean spellings', () => {
    expect(() => loadEnv({ ...baseEnvironment, AUTH_COOKIE_SECURE: 'yes' })).toThrow(
      /AUTH_COOKIE_SECURE/,
    );
  });

  it('forces secure cookies in production even when configured false', () => {
    const environment = loadEnv({
      ...baseEnvironment,
      NODE_ENV: 'production',
      AUTH_COOKIE_SECURE: 'false',
    });
    expect(environment.AUTH_COOKIE_SECURE).toBe(true);
  });
});
