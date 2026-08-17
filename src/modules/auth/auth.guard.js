import { ForbiddenError, UnauthorizedError } from '../../shared/errors.js';

export function createRequireAuth(fastify) {
  return async function requireAuth(request) {
    const token = request.cookies[fastify.authConfig.cookieName];
    if (!token) throw new UnauthorizedError();
    try {
      request.auth = fastify.jwt.verify(token);
    } catch {
      throw new UnauthorizedError();
    }
  };
}

export function createRequireRole(fastify) {
  return function requireRole(role) {
    return async function roleGuard(request, reply) {
      await fastify.requireAuth(request, reply);
      const user = await fastify.authService.getCurrentUser(request.auth.sub);
      request.currentUser = user;
      if (user.role !== role) throw new ForbiddenError();
    };
  };
}
