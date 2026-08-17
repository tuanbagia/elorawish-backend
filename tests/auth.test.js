import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

const config = {
  NODE_ENV: 'test',
  PORT: 4000,
  DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
  WEB_ORIGIN: 'http://localhost:3001',
  JWT_SECRET: 'test-secret-that-is-at-least-thirty-two-characters',
  AUTH_COOKIE_NAME: 'elora_auth',
  AUTH_COOKIE_SECURE: false,
  AUTH_SESSION_DAYS: 1,
  AUTH_REMEMBER_DAYS: 30,
};

const passwordHasher = {
  async hash(password) {
    return `hash:${password}`;
  },
  async verify(hash, password) {
    return hash === `hash:${password}`;
  },
};

function makeUser(overrides = {}) {
  return {
    userId: 'USR-001',
    email: 'nadia@example.com',
    passwordHash: 'hash:password123',
    fullName: 'Nadia Putri',
    phoneNumber: '081234567890',
    roleCode: 'CLIENT',
    statusCode: 'ACTIVE',
    lastLoginAt: null,
    deletedFlag: 'N',
    ...overrides,
  };
}

class FakeUserRepository {
  constructor(seed = []) {
    this.users = new Map(seed.map((user) => [user.email, { ...user }]));
    this.lastCreateInput = null;
  }

  async findByEmail(email) {
    return this.users.get(email) ?? null;
  }

  async findById(userId) {
    return [...this.users.values()].find((user) => String(user.userId) === String(userId)) ?? null;
  }

  async createPublicUser(input) {
    this.lastCreateInput = input;
    if (this.users.has(input.email)) {
      const error = new Error('unique');
      error.code = 'P2002';
      throw error;
    }
    const user = makeUser({
      userId: `USR-${this.users.size + 1}`,
      email: input.email,
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      roleCode: 'CLIENT',
      statusCode: 'ACTIVE',
    });
    this.users.set(user.email, user);
    return user;
  }

  async updateLastLogin(userId, now) {
    const user = await this.findById(userId);
    user.lastLoginAt = now;
    return user;
  }
}

const apps = [];

async function setup(seed = [], configOverrides = {}) {
  const repository = new FakeUserRepository(seed);
  const app = await buildApp({
    config: { ...config, ...configOverrides },
    userRepository: repository,
    passwordHasher,
    logger: false,
  });
  apps.push(app);
  return { app, repository };
}

function validRegistration(overrides = {}) {
  return {
    fullName: 'Nadia Putri',
    email: 'NADIA@EXAMPLE.COM ',
    phoneNumber: '081234567890',
    password: 'password123',
    confirmPassword: 'password123',
    ...overrides,
  };
}

function boundaryEmail(finalLabelLength) {
  return `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(finalLabelLength)}`;
}

function spyOnRegistrationRepository(repository) {
  return [
    vi.spyOn(repository, 'findByEmail'),
    vi.spyOn(repository, 'createPublicUser'),
  ];
}

function authCookie(response) {
  return response.cookies.find((cookie) => cookie.name === config.AUTH_COOKIE_NAME);
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('POST /api/v1/auth/register', () => {
  it('registers a CLIENT/ACTIVE user, normalizes email, returns no secret, and creates a session', async () => {
    const { app, repository } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validRegistration(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.user).toMatchObject({
      email: 'nadia@example.com',
      role: 'CLIENT',
      status: 'ACTIVE',
    });
    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain('password123');
    expect(repository.lastCreateInput.email).toBe('nadia@example.com');
    expect(authCookie(response).httpOnly).toBe(true);
    expect(Boolean(authCookie(response).secure)).toBe(false);
  });

  it('accepts a full name at the 150-character database boundary', async () => {
    const { app, repository } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validRegistration({ fullName: 'N'.repeat(150) }),
    });

    expect(response.statusCode).toBe(201);
    expect(repository.lastCreateInput.fullName).toHaveLength(150);
  });

  it('rejects a 151-character full name before calling the repository', async () => {
    const { app, repository } = await setup();
    const repositoryMethods = spyOnRegistrationRepository(repository);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validRegistration({ fullName: 'N'.repeat(151) }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(response.statusCode).not.toBe(500);
    for (const method of repositoryMethods) expect(method).not.toHaveBeenCalled();
  });

  it('accepts a syntactically valid email at the 255-character database boundary', async () => {
    const { app, repository } = await setup();
    const email = boundaryEmail(62);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validRegistration({ email }),
    });

    expect(email).toHaveLength(255);
    expect(response.statusCode).toBe(201);
    expect(repository.lastCreateInput.email).toBe(email);
  });

  it('rejects an email over 255 characters before calling the repository', async () => {
    const { app, repository } = await setup();
    const repositoryMethods = spyOnRegistrationRepository(repository);
    const email = boundaryEmail(63);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validRegistration({ email }),
    });

    expect(email).toHaveLength(256);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(response.statusCode).not.toBe(500);
    for (const method of repositoryMethods) expect(method).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email', async () => {
    const { app } = await setup([makeUser()]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validRegistration(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });

  it('rejects invalid registration data', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validRegistration({ password: 'short', confirmPassword: 'different' }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects role/status injection and cannot create an ADMIN', async () => {
    const { app, repository } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validRegistration({ role: 'ADMIN', status: 'SUSPENDED' }),
    });
    expect(response.statusCode).toBe(400);
    expect(repository.lastCreateInput).toBeNull();
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in, updates last login, sets a cookie, and never returns the JWT', async () => {
    const { app } = await setup([makeUser()]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'NADIA@example.com', password: 'password123', rememberMe: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.user.lastLoginAt).toBeTruthy();
    expect(response.json().data).not.toHaveProperty('token');
    expect(authCookie(response)).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 86400,
    });
    expect(Boolean(authCookie(response).secure)).toBe(false);
  });

  it('rejects an email over 255 characters before lookup', async () => {
    const { app, repository } = await setup([makeUser()]);
    const findByEmail = vi.spyOn(repository, 'findByEmail');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: boundaryEmail(63), password: 'password123' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(response.statusCode).not.toBe(500);
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['development default', 'development', undefined, false],
    ['test configured secure', 'test', true, true],
    ['test configured insecure', 'test', false, false],
    ['production forced secure', 'production', false, true],
  ])('uses environment-aware cookie security in %s', async (_label, nodeEnv, configured, secure) => {
    const { app } = await setup(
      [makeUser()],
      { NODE_ENV: nodeEnv, AUTH_COOKIE_SECURE: configured },
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nadia@example.com', password: 'password123' },
    });
    const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });

    expect(Boolean(authCookie(login).secure)).toBe(secure);
    expect(Boolean(authCookie(logout).secure)).toBe(secure);
    expect(authCookie(login)).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(authCookie(logout)).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  });

  it('uses the remember-me expiry', async () => {
    const { app } = await setup([makeUser()]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nadia@example.com', password: 'password123', rememberMe: true },
    });
    expect(authCookie(response).maxAge).toBe(30 * 86400);
  });

  it('returns a generic response for an unknown email or wrong password', async () => {
    const { app } = await setup([makeUser()]);
    for (const payload of [
      { email: 'missing@example.com', password: 'password123' },
      { email: 'nadia@example.com', password: 'wrong' },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.message).toBe('Invalid email or password');
    }
  });

  it.each([
    ['inactive', { statusCode: 'INACTIVE' }],
    ['suspended', { statusCode: 'SUSPENDED' }],
    ['deleted', { deletedFlag: 'Y' }],
  ])('rejects an %s user with the generic response', async (_label, override) => {
    const { app } = await setup([makeUser(override)]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nadia@example.com', password: 'password123' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe('Invalid email or password');
  });
});

describe('authenticated endpoints and authorization', () => {
  it('loads /me from persistence using the authenticated identity', async () => {
    const user = makeUser();
    const { app, repository } = await setup([user]);
    const token = app.jwt.sign({ role: 'CLIENT' }, { sub: user.userId });
    repository.users.get(user.email).fullName = 'Fresh Database Name';
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [config.AUTH_COOKIE_NAME]: token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.user.fullName).toBe('Fresh Database Name');
  });

  it('rejects an unauthorized /me request', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(response.statusCode).toBe(401);
  });

  it('clears the cookie on logout', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(response.statusCode).toBe(200);
    expect(authCookie(response).value).toBe('');
    expect(authCookie(response).maxAge).toBe(0);
  });

  it('enforces CLIENT versus ADMIN authorization', async () => {
    const client = makeUser();
    const admin = makeUser({
      userId: 'USR-ADMIN',
      email: 'admin@example.com',
      roleCode: 'ADMIN',
    });
    const { app } = await setup([client, admin]);
    app.get('/test/client', { preHandler: app.requireRole('CLIENT') }, async () => ({ ok: true }));
    app.get('/test/admin', { preHandler: app.requireRole('ADMIN') }, async () => ({ ok: true }));
    const clientToken = app.jwt.sign({ role: 'ADMIN' }, { sub: client.userId });
    const adminToken = app.jwt.sign({ role: 'CLIENT' }, { sub: admin.userId });
    const clientCookie = { [config.AUTH_COOKIE_NAME]: clientToken };
    const adminCookie = { [config.AUTH_COOKIE_NAME]: adminToken };

    const clientResponse = await app.inject({ method: 'GET', url: '/test/client', cookies: clientCookie });
    const deniedAdmin = await app.inject({ method: 'GET', url: '/test/admin', cookies: clientCookie });
    const adminResponse = await app.inject({ method: 'GET', url: '/test/admin', cookies: adminCookie });
    expect(clientResponse.statusCode).toBe(200);
    expect(deniedAdmin.statusCode).toBe(403);
    expect(adminResponse.statusCode).toBe(200);
  });
});

describe('GET /api/v1/health', () => {
  it('reports service health', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('ok');
  });
});
