import { describe, expect, it, vi } from 'vitest';
import { PrismaUserRepository } from '../src/modules/user/user.repository.js';

function databaseUser(overrides = {}) {
  return {
    user_id: 'USR-260817-000001',
    email: 'nadia@example.com',
    password_hash: 'argon-hash',
    full_name: 'Nadia Putri',
    phone_no: '081234567890',
    role_cd: 'CLIENT',
    status_cd: 'ACTIVE',
    last_login_dt: null,
    deleted_flag: false,
    ...overrides,
  };
}

function setup(returnedUser = databaseUser()) {
  const delegate = {
    findFirst: vi.fn().mockResolvedValue(returnedUser),
    findUnique: vi.fn().mockResolvedValue(returnedUser),
    create: vi.fn().mockResolvedValue(returnedUser),
    update: vi.fn().mockResolvedValue(returnedUser),
  };
  return {
    delegate,
    repository: new PrismaUserRepository({ tb_m_user: delegate }),
  };
}

describe('PrismaUserRepository authoritative mapping', () => {
  it('performs case-insensitive email lookup and maps database fields', async () => {
    const { repository, delegate } = setup();
    const user = await repository.findByEmail('nadia@example.com');
    expect(delegate.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'nadia@example.com', mode: 'insensitive' } },
    });
    expect(user).toMatchObject({
      userId: 'USR-260817-000001',
      passwordHash: 'argon-hash',
      deletedFlag: false,
    });
  });

  it('omits user_id and enforces public-registration database values', async () => {
    const { repository, delegate } = setup();
    const now = new Date('2026-08-17T09:00:00.000Z');
    await repository.createPublicUser({
      email: 'nadia@example.com',
      passwordHash: 'argon-hash',
      fullName: 'Nadia Putri',
      phoneNumber: '081234567890',
      now,
    });

    const data = delegate.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('user_id');
    expect(data).toMatchObject({
      role_cd: 'CLIENT',
      status_cd: 'ACTIVE',
      deleted_flag: false,
      created_by: 'PUBLIC_REGISTER',
    });
  });

  it('uses the shared database-generated ID path for development users', async () => {
    const { repository, delegate } = setup();
    const now = new Date('2026-08-17T09:00:00.000Z');
    await repository.createDevelopmentUser({
      email: 'admin@elorawish.local',
      passwordHash: 'argon-hash',
      fullName: 'Elora Admin',
      phoneNumber: '081234567802',
      roleCode: 'ADMIN',
      statusCode: 'ACTIVE',
      now,
    });

    const data = delegate.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('user_id');
    expect(data).toMatchObject({
      role_cd: 'ADMIN',
      status_cd: 'ACTIVE',
      created_by: 'DEV_SEED',
      changed_by: 'DEV_SEED',
      deleted_flag: false,
    });
  });

  it('maps only requested development corrections and their audit fields', async () => {
    const { repository, delegate } = setup();
    const now = new Date('2026-08-17T09:00:00.000Z');
    await repository.updateDevelopmentUser(
      'USR-260817-000001',
      { roleCode: 'ADMIN', deletedFlag: false, deletedBy: null, deletedAt: null },
      now,
    );

    expect(delegate.update).toHaveBeenCalledWith({
      where: { user_id: 'USR-260817-000001' },
      data: {
        role_cd: 'ADMIN',
        deleted_flag: false,
        deleted_by: null,
        deleted_dt: null,
        changed_by: 'DEV_SEED',
        changed_dt: now,
      },
    });
  });

  it('updates authoritative login audit columns', async () => {
    const { repository, delegate } = setup();
    const now = new Date('2026-08-17T09:00:00.000Z');
    await repository.updateLastLogin('USR-260817-000001', now);
    expect(delegate.update).toHaveBeenCalledWith({
      where: { user_id: 'USR-260817-000001' },
      data: {
        last_login_dt: now,
        changed_dt: now,
        changed_by: 'USR-260817-000001',
      },
    });
  });
});
