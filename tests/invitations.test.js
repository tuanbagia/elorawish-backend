import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { normalizeSlug } from '../src/modules/invitation/invitation.schemas.js';
import {
  EditConflictError,
  InvitationNotEditableError,
  NotFoundError,
  ValidationError,
} from '../src/shared/errors.js';

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
    this.updateAtomic = vi.fn(async (input) => {
      const found = this.invitations.find(
        (item) => item.id === input.invitationId &&
          item.ownerId === input.userId &&
          !item.deletedFlag,
      );
      if (!found) throw new NotFoundError('Invitation not found');
      if (found.status !== 'DRAFT') throw new InvitationNotEditableError();
      if (found.updatedAt !== input.expectedUpdatedAt) throw new EditConflictError();
      Object.assign(found, {
        title: input.title,
        slug: input.slug,
        updatedAt: '2026-08-17T10:00:00.000Z',
      });
      return withoutOwner(found);
    });
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

function validUpdatePayload(overrides = {}) {
  return validPayload({
    expectedUpdatedAt: '2026-08-17T09:00:00.000Z',
    ...overrides,
  });
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
    {
      method: 'PATCH',
      url: '/api/v1/invitations/INV-001',
      payload: validUpdatePayload(),
    },
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

describe('invitation CORS', () => {
  it('allows credentialed PATCH preflight from the configured dashboard origin', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/invitations/INV-001',
      headers: {
        origin: config.WEB_ORIGIN,
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(config.WEB_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
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
    expect(response.json().data.invitation.template).toMatchObject({
      id: 'TPL-1',
      versionId: 'TPV-usable',
      version: '1.0.0',
    });
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

describe('PATCH /api/v1/invitations/:invitationId', () => {
  it('updates an owned DRAFT with normalized input and authenticated audit identity', async () => {
    const { app, repository } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/invitations/INV-001',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validUpdatePayload({ title: 'Updated Couple', slug: '  Úpdated Couple  ' }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.invitation).toMatchObject({
      id: 'INV-001',
      title: 'Updated Couple',
      slug: 'updated-couple',
      updatedAt: '2026-08-17T10:00:00.000Z',
    });
    expect(repository.updateAtomic).toHaveBeenCalledWith(expect.objectContaining({
      invitationId: 'INV-001',
      userId: 'USR-CLIENT',
      expectedUpdatedAt: '2026-08-17T09:00:00.000Z',
      slug: 'updated-couple',
      now: expect.any(Date),
    }));
  });

  it.each(['INV-OTHER', 'INV-MISSING'])('returns the same 404 for %s', async (id) => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/invitations/${id}`,
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validUpdatePayload(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toEqual({
      code: 'NOT_FOUND',
      message: 'Invitation not found',
    });
  });

  it('treats a deleted owned invitation as not found', async () => {
    const { app, repository } = await setup();
    repository.invitations[0].deletedFlag = true;
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/invitations/INV-001',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validUpdatePayload(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('returns a stable conflict for an owned non-DRAFT invitation', async () => {
    const { app, repository } = await setup();
    repository.invitations[0].status = 'ACTIVE';
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/invitations/INV-001',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validUpdatePayload(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: 'INVITATION_NOT_EDITABLE',
      message: 'Only draft invitations can be edited',
    });
  });

  it('rejects stale edits without calling a second write', async () => {
    const { app, repository } = await setup();
    repository.invitations[0].updatedAt = '2026-08-17T10:00:00.000Z';
    const before = structuredClone(repository.invitations[0]);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/invitations/INV-001',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validUpdatePayload({ title: 'Stale overwrite' }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EDIT_CONFLICT');
    expect(repository.invitations[0]).toEqual(before);
  });

  it.each([
    ['unknown field', { status: 'ACTIVE' }],
    ['person ID', { people: validPayload().people.map((person) => ({ ...person, id: 'PRS-browser' })) }],
    ['event ID', { event: { ...validPayload().event, id: 'EVT-browser' } }],
    ['invalid timestamp', { expectedUpdatedAt: 'yesterday' }],
    ['invalid date', { event: { ...validPayload().event, date: '2026-02-30' } }],
    ['duplicate role', { people: validPayload().people.map((person) => ({ ...person, role: 'BRIDE' })) }],
  ])('rejects %s before the repository update', async (_label, overrides) => {
    const { app, repository } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/invitations/INV-001',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validUpdatePayload(overrides),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(repository.updateAtomic).not.toHaveBeenCalled();
  });

  it('returns safe distinct template and slug conflicts', async () => {
    const { app, repository } = await setup();
    repository.updateAtomic.mockRejectedValueOnce(new ValidationError(
      'Selected invitation template is unavailable',
      [{ field: 'templateVersionId', message: 'Select an active current template' }],
    ));
    const templateResponse = await app.inject({
      method: 'PATCH',
      url: '/api/v1/invitations/INV-001',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validUpdatePayload(),
    });
    expect(templateResponse.statusCode).toBe(400);
    expect(templateResponse.json().error.code).toBe('VALIDATION_ERROR');

    repository.updateAtomic.mockRejectedValueOnce(Object.assign(new Error('raw database'), {
      code: 'P2002',
      meta: { target: ['slug'] },
    }));
    const slugResponse = await app.inject({
      method: 'PATCH',
      url: '/api/v1/invitations/INV-001',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validUpdatePayload(),
    });
    expect(slugResponse.statusCode).toBe(409);
    expect(slugResponse.json().error).toEqual({
      code: 'CONFLICT',
      message: 'This invitation URL is already in use',
    });
    expect(slugResponse.body).not.toContain('raw database');
  });

  it('does not expose an unexpected persistence error', async () => {
    const { app, repository } = await setup();
    repository.updateAtomic.mockRejectedValue(new Error('raw Prisma connection detail'));
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/invitations/INV-001',
      headers: { cookie: cookie(app, 'USR-CLIENT', 'CLIENT') },
      payload: validUpdatePayload(),
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('INTERNAL_ERROR');
    expect(response.body).not.toContain('raw Prisma connection detail');
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
      id: 'TPL-1',
      key: 'SUNDAY_BLOOM',
      name: 'Sunday Bloom',
      thumbnailUrl: '/template-thumbnails/sunday-bloom.svg',
      versionId: 'TPV-usable',
      version: '1.0.0',
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
