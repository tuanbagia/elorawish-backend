import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { PrismaUserRepository } from '../src/modules/user/user.repository.js';

const app = await buildApp({ config: loadEnv(), logger: false });

try {
  const [{ databaseName }] = await app.prisma.$queryRaw`
    SELECT current_database() AS "databaseName"
  `;
  const userCount = await app.prisma.tb_m_user.count();
  const users = new PrismaUserRepository(app.prisma);
  const missingUser = await users.findByEmail('__read_only_check__@example.invalid');
  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });

  if (databaseName !== 'ELORAWISH_DB') throw new Error('Unexpected database');
  if (missingUser !== null) throw new Error('Read-only sentinel email unexpectedly exists');
  if (health.statusCode !== 200) throw new Error('Health route failed');

  process.stdout.write(`Read-only database check passed (${userCount} users)\n`);
} finally {
  await app.close();
}
