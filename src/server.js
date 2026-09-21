import 'dotenv/config';
import { createApplication } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app, shiftCache } = await createApplication(config);

const server = app.listen(config.port, async () => {
  console.log(`Shift display app listening on port ${config.port}`);
  if (!config.adminPassword) {
    console.warn('ADMIN_PASSWORD is not configured. The admin area is disabled.');
  }
  await shiftCache.refreshIfNeeded({ force: true });
});

const refreshTimer = setInterval(() => {
  shiftCache.refreshIfNeeded({ force: true }).catch((error) => {
    console.error('Scheduled refresh failed:', error.message);
  });
}, config.refreshIntervalMs);

function shutdown() {
  clearInterval(refreshTimer);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
