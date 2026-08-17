import { describe, expect, it, vi } from 'vitest';
import {
  assertDevelopmentEnvironment,
  DEVELOPMENT_USERS,
  seedDevelopmentUsers,
} from '../scripts/seed-dev-users.js';

function makeUser(expected, overrides = {}) {
  return {
    userId: `USR-${expected.roleCode}`,
    passwordHash: 'hash:Elora123!',
    deletedFlag: false,
    ...expected,
    ...overrides,
  };
}

function setup(seed = []) {
  const users = new Map(seed.map((user) => [user.email, { ...user }]));
  const userRepository = {
    findByEmail: vi.fn(async (email) => users.get(email) ?? null),
    createDevelopmentUser: vi.fn(async (input) => {
      const user = makeUser(input, {
        userId: `USR-${users.size + 1}`,
        passwordHash: input.passwordHash,
      });
      users.set(user.email, user);
      return user;
    }),
    updateDevelopmentUser: vi.fn(async (userId, changes) => {
      const user = [...users.values()].find((candidate) => candidate.userId === userId);
      Object.assign(user, changes);
      return user;
    }),
  };
  const passwordHasher = {
    hash: vi.fn(async (password) => `hash:${password}`),
    verify: vi.fn(async (hash, password) => hash === `hash:${password}`),
  };
  return { passwordHasher, userRepository };
}

describe('development user seed', () => {
  it('refuses production execution', () => {
    expect(() => assertDevelopmentEnvironment('production')).toThrow(/disabled/);
    expect(() => assertDevelopmentEnvironment('development')).not.toThrow();
  });

  it('creates the CLIENT and ADMIN through the repository with hashed passwords', async () => {
    const dependencies = setup();
    const results = await seedDevelopmentUsers(dependencies);

    expect(results.map(({ action }) => action)).toEqual(['inserted', 'inserted']);
    expect(dependencies.userRepository.createDevelopmentUser).toHaveBeenCalledTimes(2);
    expect(dependencies.passwordHasher.hash).toHaveBeenCalledTimes(2);
    expect(dependencies.userRepository.createDevelopmentUser.mock.calls[0][0]).toMatchObject({
      email: 'client@elorawish.local',
      roleCode: 'CLIENT',
      statusCode: 'ACTIVE',
      passwordHash: 'hash:Elora123!',
    });
    expect(dependencies.userRepository.createDevelopmentUser.mock.calls[0][0]).not.toHaveProperty('password');
  });

  it('is idempotent when both users already match, including their passwords', async () => {
    const dependencies = setup(DEVELOPMENT_USERS.map((user) => makeUser(user)));
    const results = await seedDevelopmentUsers(dependencies);

    expect(results.map(({ action }) => action)).toEqual(['unchanged', 'unchanged']);
    expect(dependencies.passwordHasher.hash).not.toHaveBeenCalled();
    expect(dependencies.userRepository.createDevelopmentUser).not.toHaveBeenCalled();
    expect(dependencies.userRepository.updateDevelopmentUser).not.toHaveBeenCalled();
  });

  it('corrects only mismatched fields and reactivates a soft-deleted user', async () => {
    const [client, admin] = DEVELOPMENT_USERS;
    const dependencies = setup([
      makeUser(client),
      makeUser(admin, {
        passwordHash: 'hash:old-password',
        roleCode: 'CLIENT',
        statusCode: 'SUSPENDED',
        deletedFlag: true,
      }),
    ]);
    const results = await seedDevelopmentUsers(dependencies);

    expect(results.map(({ action }) => action)).toEqual(['unchanged', 'updated']);
    expect(dependencies.userRepository.updateDevelopmentUser).toHaveBeenCalledWith(
      'USR-ADMIN',
      {
        roleCode: 'ADMIN',
        statusCode: 'ACTIVE',
        deletedFlag: false,
        deletedBy: null,
        deletedAt: null,
        passwordHash: 'hash:Elora123!',
      },
      expect.any(Date),
    );
  });
});
