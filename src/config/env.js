import 'dotenv/config';
import { z } from 'zod';

const booleanEnvironmentValue = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url(),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(32),
  AUTH_COOKIE_NAME: z.string().min(1).default('elora_auth'),
  AUTH_COOKIE_SECURE: booleanEnvironmentValue.optional(),
  AUTH_SESSION_DAYS: z.coerce.number().int().positive().default(1),
  AUTH_REMEMBER_DAYS: z.coerce.number().int().positive().default(30),
});

export function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return {
    ...result.data,
    AUTH_COOKIE_SECURE: resolveAuthCookieSecure(
      result.data.NODE_ENV,
      result.data.AUTH_COOKIE_SECURE,
    ),
  };
}

export function resolveAuthCookieSecure(nodeEnv, configuredValue) {
  if (nodeEnv === 'production') return true;
  return configuredValue ?? false;
}
