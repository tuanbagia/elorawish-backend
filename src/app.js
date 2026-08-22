import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient } from '@prisma/client';
import { resolveAuthCookieSecure } from './config/env.js';
import { AppError } from './shared/errors.js';
import { PrismaUserRepository } from './modules/user/user.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { argonPasswordHasher } from './modules/auth/password.js';
import { createRequireAuth, createRequireRole } from './modules/auth/auth.guard.js';
import authRoutes from './modules/auth/auth.routes.js';
import invitationRoutes from './modules/invitation/invitation.routes.js';
import { InvitationService } from './modules/invitation/invitation.service.js';
import { PrismaInvitationRepository } from './modules/invitation/invitation.repository.js';

const loggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.confirmPassword',
      'res.headers.set-cookie',
      'body.password',
      'body.confirmPassword',
      'password',
      'confirmPassword',
      'JWT_SECRET',
    ],
    censor: '[REDACTED]',
  },
};

export async function buildApp({
  config,
  userRepository,
  invitationRepository,
  passwordHasher = argonPasswordHasher,
  logger = loggerOptions,
} = {}) {
  if (!config) throw new Error('Application config is required');

  const app = Fastify({ logger });
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH'],
  });
  await app.register(cookie);
  await app.register(jwt, { secret: config.JWT_SECRET });
  await app.register(rateLimit, { global: false });

  app.decorate('authConfig', {
    cookieName: config.AUTH_COOKIE_NAME,
    cookieSecure: resolveAuthCookieSecure(config.NODE_ENV, config.AUTH_COOKIE_SECURE),
    sessionDays: config.AUTH_SESSION_DAYS,
    rememberDays: config.AUTH_REMEMBER_DAYS,
  });
  app.decorateRequest('auth', null);
  app.decorateRequest('currentUser', null);
  app.decorate('requireAuth', createRequireAuth(app));
  app.decorate('requireRole', createRequireRole(app));

  // Install root handlers before encapsulated route plugins so every module
  // inherits the same public error contract.
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      const payload = { code: error.code, message: error.message };
      if (error.details) payload.details = error.details;
      return reply.code(error.statusCode).send({ error: payload });
    }

    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });
    }

    request.log.error(
      { errorName: error.name, errorCode: error.code },
      'Unhandled request error',
    );
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  let prisma;
  let users = userRepository;
  if (!users) {
    prisma = new PrismaClient();
    await prisma.$connect();
    app.decorate('prisma', prisma);
    app.addHook('onClose', () => prisma.$disconnect());
    users = new PrismaUserRepository(prisma);
  }

  const authService = new AuthService({ userRepository: users, passwordHasher });
  app.decorate('authService', authService);
  await app.register(authRoutes, {
    prefix: '/api/v1/auth',
    authService,
  });

  const invitations = invitationRepository ?? (
    prisma ? new PrismaInvitationRepository(prisma) : null
  );
  if (invitations) {
    const invitationService = new InvitationService({ invitationRepository: invitations });
    await app.register(invitationRoutes, {
      prefix: '/api/v1/invitations',
      invitationService,
    });
  }

  app.get('/api/v1/health', async () => ({
    data: { status: 'ok', timestamp: new Date().toISOString() },
  }));

  return app;
}
