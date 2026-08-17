import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../src/config/env.js';
import { argonPasswordHasher } from '../src/modules/auth/password.js';
import { PrismaUserRepository } from '../src/modules/user/user.repository.js';
import { USER_ROLES, USER_STATUSES } from '../src/shared/user.js';

const DEVELOPMENT_PASSWORD = 'Elora123!';

export const DEVELOPMENT_USERS = Object.freeze([
  Object.freeze({
    fullName: 'Elora Client',
    email: 'client@elorawish.local',
    phoneNumber: '081234567801',
    roleCode: USER_ROLES.CLIENT,
    statusCode: USER_STATUSES.ACTIVE,
  }),
  Object.freeze({
    fullName: 'Elora Admin',
    email: 'admin@elorawish.local',
    phoneNumber: '081234567802',
    roleCode: USER_ROLES.ADMIN,
    statusCode: USER_STATUSES.ACTIVE,
  }),
]);

export function assertDevelopmentEnvironment(nodeEnv) {
  if (nodeEnv === 'production') {
    throw new Error('Development user seed is disabled when NODE_ENV=production');
  }
}

export async function seedDevelopmentUsers({
  userRepository,
  passwordHasher = argonPasswordHasher,
  now = () => new Date(),
}) {
  const results = [];

  for (const expected of DEVELOPMENT_USERS) {
    const existing = await userRepository.findByEmail(expected.email);
    if (!existing) {
      const passwordHash = await passwordHasher.hash(DEVELOPMENT_PASSWORD);
      const user = await userRepository.createDevelopmentUser({
        ...expected,
        passwordHash,
        now: now(),
      });
      results.push({ action: 'inserted', user });
      continue;
    }

    const changes = expectedChanges(existing, expected);
    if (!(await passwordMatches(passwordHasher, existing.passwordHash))) {
      changes.passwordHash = await passwordHasher.hash(DEVELOPMENT_PASSWORD);
    }

    if (Object.keys(changes).length === 0) {
      results.push({ action: 'unchanged', user: existing });
      continue;
    }

    const user = await userRepository.updateDevelopmentUser(existing.userId, changes, now());
    results.push({ action: 'updated', user, fields: Object.keys(changes) });
  }

  return results;
}

function expectedChanges(existing, expected) {
  const changes = {};
  for (const field of ['email', 'fullName', 'phoneNumber', 'roleCode', 'statusCode']) {
    if (existing[field] !== expected[field]) changes[field] = expected[field];
  }
  if (existing.deletedFlag === true || existing.deletedFlag === 'Y') {
    changes.deletedFlag = false;
    changes.deletedBy = null;
    changes.deletedAt = null;
  }
  return changes;
}

async function passwordMatches(passwordHasher, passwordHash) {
  try {
    return await passwordHasher.verify(passwordHash, DEVELOPMENT_PASSWORD);
  } catch {
    return false;
  }
}

async function main() {
  const config = loadEnv();
  assertDevelopmentEnvironment(config.NODE_ENV);

  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    const results = await seedDevelopmentUsers({
      userRepository: new PrismaUserRepository(prisma),
    });
    for (const { action, user, fields } of results) {
      const suffix = fields ? ` (${fields.join(', ')})` : '';
      process.stdout.write(`${action}: ${user.email} -> ${user.userId} [${user.roleCode}/${user.statusCode}]${suffix}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
