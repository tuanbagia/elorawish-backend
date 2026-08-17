import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { normalizeSlug } from '../src/modules/invitation/invitation.schemas.js';

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

const users = [
  user({ userId: 'USR-CLIENT', email: 'client@example.com', roleCode: 'CLIENT' }),
  user({ userId: 'USR-OTHER', email: 'other@example.com', roleCode: 'CLIENT' }),
  user({ userId: 'USR-ADMIN', email: 'admin@example.com', roleCode: 'ADMIN' }),
];

class FakeUserRepository {
  async findById(userId) {
    return users.find((candidate) => candidate.userId === userId) ?? null;
  }
}

class FakeInvitationRepository {
  constructor() {
    this.catalog = catalog();
    this.selection = {
      invitationTypeId: 'ITY-resolved',
      templateVersionId: 'TPV-usable',
    };
    this.invitations = [invitation()];
    this.getCatalog = vi.fn(async () => this.catalog);
    this.findUsableTemplateVersion = vi.fn(async () => this.selection);
    this.findAllOwnedBy = vi.fn(async (userId) =>
      this.invitations.filter((item) => item.ownerId === userId).map(withoutOwner));
    this.findOwnedById = vi.fn(async (userId, invitationId) => {
      const found = this.invitations.find(
        (item) => item.ownerId === userId && item.id === invitationId,
      );
      return found ? withoutOwner(found) : null;
    });
    this.createAtomic = vi.fn(async (input) => ({
      ...withoutOwner(invitation({
        id: 'INV-generated',
        title: input.title,
        slug: input.slug,
        ownerId: input.userId,
      })),
      people: input.people.map((person, index) => ({
        id: `PRS-generated-${index + 1}`,
        ...person,
      })),
      events: [{ id: 'EVT-generated', type: 'WEDDING', ...input.event, timezone: 'Asia/Jakarta' }],
    }));
  }
}

const apps = [];

async function setup() {
  const repository = new FakeInvitationRepository();
  const app = await buildApp({
    config,
    userRepository: new FakeUserRepository(),
    invitationRepository: repository,
    logger: false,
  });
  apps.push(app);
  return { app, repository };
}

function cookie(app, userId, role) {
  const token = app.jwt.sign({ role }, { sub: userId });
  return `${config.AUTH_COOKIE_NAME}=${token}`;
}

function validPayload(overrides = {}) {
  return {
    invitationTypeKey: 'WEDDING',
    templateVersionId: 'TPV-usable',
    title: 'Raka & Nadia',
    slug: 'raka-nadia',
    openingTitle: 'We are getting married',
    openingMessage: 'Join us as we celebrate our special day.',
    closingMessage: 'We cannot wait to celebrate with you.',
    people: [
      {
        role: 'GROOM',
        displayName: 'Raka',
        fullName: 'Raka Pratama',
        fatherName: '',
        motherName: '',
      },
      {
        role: 'BRIDE',
        displayName: 'Nadia',
        fullName: 'Nadia Putri',
        fatherName: '',
        motherName: '',
      },
    ],
    event: {
      title: 'Wedding Celebration',
      date: '2026-12-12',
      startTime: '10:00',
      endTime: '13:00',
      venueName: 'Ubud Garden',
      venueAddress: 'Bali, Indonesia',
      mapUrl: 'https://maps.example.com/raka-nadia',
    },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('invitation route authorization', () => {
  const routes = [
    { method: 'GET', url: '/api/v1/invitations/catalog' },
    { method: 'GET', url: '/api/v1/invitations' },
    { method: 'GET', url: '/api/v1/invitations/INV-001' },
    { method: 'POST', url: '/api/v1/invitations', payload: validPayload() },
  ];

  for (const route of routes) {
    it(`${route.method} ${route.url} returns 401 without authentication`, async () => {
      const { app } = await setup();
      const response = await app.inject(route);
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    });

    it(`${route.method} ${route.url} returns 403 for ADMIN`, async () => {
      const { app } = await setup();
      const response = await app.inject({
        ...route,
        headers: { cookie: cookie(app, 'USR-ADMIN', 'ADMIN') },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    });
  }
});

describe('GET /api/v1/invitations/catalog', () => {
  it('returns only safe usable catalog fields to a CLIENT', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/invitations/catalog',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.invitationTypes[0].templates).toHaveLength(6);
    expect(response.json().data.invitationTypes[0].templates[0]).toMatchObject({
      key: 'SUNDAY_BLOOM',
      currentVersion: { id: 'TPV-usable', rendererKey: 'sunday-bloom' },
    });
    expect(response.body).not.toContain('deleted_flag');
    expect(response.body).not.toContain('created_by');
  });
});

describe('POST /api/v1/invitations', () => {
  it('creates a DRAFT owned and audited by the authenticated CLIENT', async () => {
    const { app, repository } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validPayload({ slug: '  Ráka & Nadia  ' }),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.invitation).toMatchObject({
      id: 'INV-generated',
      slug: 'raka-nadia',
      status: 'DRAFT',
    });
    expect(repository.createAtomic).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'USR-CLIENT',
      invitationTypeId: 'ITY-resolved',
      slug: 'raka-nadia',
      now: expect.any(Date),
    }));
    expect(repository.createAtomic.mock.calls[0][0].people[0]).toMatchObject({
      fatherName: null,
      motherName: null,
    });
    expect(response.body).not.toContain('userId');
    expect(response.body).not.toContain('createdBy');
    expect(response.body).not.toContain('password');
  });

  it('rejects attempted ownership and audit fields before repository access', async () => {
    const { app, repository } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: { ...validPayload(), userId: 'USR-OTHER', status: 'ACTIVE' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(repository.findUsableTemplateVersion).not.toHaveBeenCalled();
    expect(repository.createAtomic).not.toHaveBeenCalled();
  });

  it('rejects an unavailable or mismatched template version safely', async () => {
    const { app, repository } = await setup();
    repository.selection = null;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validPayload({ templateVersionId: 'TPV-fake' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Selected invitation template is unavailable',
    });
    expect(repository.createAtomic).not.toHaveBeenCalled();
  });

  it('returns a safe 409 for a duplicate slug', async () => {
    const { app, repository } = await setup();
    repository.createAtomic.mockRejectedValue(Object.assign(new Error('database detail'), {
      code: 'P2002',
      meta: { target: ['slug'] },
    }));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: 'CONFLICT',
      message: 'This invitation URL is already in use',
    });
    expect(response.body).not.toContain('database detail');
  });

  it.each([
    ['invalid calendar date', { event: { ...validPayload().event, date: '2026-02-30' } }],
    ['malformed time', { event: { ...validPayload().event, startTime: '25:00' } }],
    ['end time before start time', {
      event: { ...validPayload().event, startTime: '13:00', endTime: '10:00' },
    }],
    ['duplicate person role', {
      people: validPayload().people.map((person) => ({ ...person, role: 'GROOM' })),
    }],
  ])('rejects %s before creating rows', async (_label, overrides) => {
    const { app, repository } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validPayload(overrides),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(repository.createAtomic).not.toHaveBeenCalled();
  });
});

describe('owned invitation reads', () => {
  it('lists only invitations for the authenticated CLIENT', async () => {
    const { app, repository } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/invitations',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.findAllOwnedBy).toHaveBeenCalledWith('USR-CLIENT');
    expect(response.json().data.invitations).toHaveLength(1);
  });

  it('returns an owned invitation detail', async () => {
    const { app, repository } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/invitations/INV-001',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.findOwnedById).toHaveBeenCalledWith('USR-CLIENT', 'INV-001');
    expect(response.json().data.invitation.id).toBe('INV-001');
  });

  it('returns the same 404 for another CLIENT invitation and a missing invitation', async () => {
    const { app } = await setup();
    for (const invitationId of ['INV-OTHER', 'INV-MISSING']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/invitations/${invitationId}`,
        headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toEqual({
        code: 'NOT_FOUND',
        message: 'Invitation not found',
      });
    }
  });
});

describe('slug normalization', () => {
  it.each([
    ['Raka & Nadia', 'raka-nadia'],
    ['  Our Wedding 2026  ', 'our-wedding-2026'],
    ['Ráká dan Nadiá', 'raka-dan-nadia'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeSlug(input)).toBe(expected);
  });
});

function user(overrides) {
  return {
    passwordHash: 'unused',
    fullName: 'Test User',
    phoneNumber: null,
    statusCode: 'ACTIVE',
    lastLoginAt: null,
    deletedFlag: false,
    ...overrides,
  };
}

function catalog() {
  return [{
    id: 'ITY-resolved',
    key: 'WEDDING',
    name: 'Wedding',
    description: 'Undangan pernikahan',
    templates: ['SUNDAY_BLOOM', 'AFTERGLOW', 'PAPER_HEARTS', 'MIDNIGHT_KISS', 'CHERRY_LOVE', 'SOFT_PROMISE']
      .map((key, index) => ({
        id: `TPL-${index + 1}`,
        key,
        name: key.split('_').map(capitalize).join(' '),
        description: 'Wedding template',
        thumbnailUrl: `/template-thumbnails/${key.toLowerCase().replaceAll('_', '-')}.svg`,
        premium: false,
        category: { id: 'TPC-resolved', key: 'FLORAL', name: 'Floral' },
        currentVersion: {
          id: index === 0 ? 'TPV-usable' : `TPV-${index + 1}`,
          version: '1.0.0',
          rendererKey: key.toLowerCase().replaceAll('_', '-'),
          defaultConfig: { theme: key.toLowerCase().replaceAll('_', '-') },
        },
      })),
  }];
}

function invitation(overrides = {}) {
  return {
    id: 'INV-001',
    ownerId: 'USR-CLIENT',
    title: 'Raka & Nadia',
    slug: 'raka-nadia',
    status: 'DRAFT',
    openingTitle: null,
    openingMessage: null,
    closingMessage: null,
    createdAt: '2026-08-17T09:00:00.000Z',
    updatedAt: '2026-08-17T09:00:00.000Z',
    invitationType: { key: 'WEDDING', name: 'Wedding' },
    template: {
      key: 'SUNDAY_BLOOM',
      name: 'Sunday Bloom',
      thumbnailUrl: '/template-thumbnails/sunday-bloom.svg',
      rendererKey: 'sunday-bloom',
    },
    people: [],
    events: [],
    ...overrides,
  };
}

function withoutOwner(item) {
  const safe = { ...item };
  delete safe.ownerId;
  return safe;
}

function capitalize(value) {
  return value[0] + value.slice(1).toLowerCase();
}
