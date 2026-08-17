import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

let app;

async function start() {
  try {
    const config = loadEnv();
    app = await buildApp({ config });
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Failed to start server');
    process.exitCode = 1;
  }
}

async function shutdown(signal) {
  try {
    if (app) await app.close();
  } catch {
    console.error(`Graceful shutdown failed after ${signal}`);
    process.exitCode = 1;
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdown(signal));
}

await start();
