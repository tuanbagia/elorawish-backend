import { parseBody } from '../../shared/validation.js';
import { loginSchema, registerSchema } from './auth.schemas.js';

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

function setSession(fastify, reply, user, rememberMe) {
  const days = rememberMe
    ? fastify.authConfig.rememberDays
    : fastify.authConfig.sessionDays;
  const maxAge = days * 24 * 60 * 60;
  const token = fastify.jwt.sign(
    { role: user.role },
    { sub: user.id, expiresIn: maxAge },
  );
  reply.setCookie(fastify.authConfig.cookieName, token, cookieOptions(maxAge));
}

export default async function authRoutes(fastify, { authService }) {
  const rateLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  fastify.post('/register', rateLimit, async (request, reply) => {
    const input = parseBody(registerSchema, request.body);
    const user = await authService.register(input);
    setSession(fastify, reply, user, false);
    return reply.code(201).send({ data: { user } });
  });

  fastify.post('/login', rateLimit, async (request, reply) => {
    const input = parseBody(loginSchema, request.body);
    const user = await authService.login(input);
    setSession(fastify, reply, user, input.rememberMe);
    return { data: { user } };
  });

  fastify.get('/me', { preHandler: fastify.requireAuth }, async (request) => {
    const user = await authService.getCurrentUser(request.auth.sub);
    return { data: { user } };
  });

  fastify.post('/logout', async (_request, reply) => {
    reply.clearCookie(fastify.authConfig.cookieName, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    return { data: { message: 'Logged out' } };
  });
}
