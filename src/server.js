import 'dotenv/config';
import compression from 'compression';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { PlandayClient } from './services/plandayClient.js';
import { ShiftCache } from './services/shiftCache.js';
import { TokenStore } from './services/tokenStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function publicBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function sanitizeSetupList(payload) {
  const items = Array.isArray(payload) ? payload : payload?.data ?? payload?.items ?? payload?.results ?? [];
  return items
    .map((item) => ({
      id: item.id ?? item.departmentId ?? item.employeeGroupId ?? item.groupId,
      name: item.name ?? item.title ?? item.description
    }))
    .filter((item) => item.id !== undefined && item.name)
    .map((item) => ({
      id: String(item.id),
      name: String(item.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

const config = loadConfig();

const app = express();
const oauthStates = new Map();
const tokenStore = new TokenStore(config.plandayTokenFile);
const plandayClient = new PlandayClient(config.planday, tokenStore);
const shiftCache = new ShiftCache({
  client: plandayClient,
  teamRules: config.teamRules,
  cacheTtlMs: config.cacheTtlMs,
  dayCount: config.dayCount
});

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(
  helmet({
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: null
      }
    }
  })
);
app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function requireSetupAuth(req, res, next) {
  if (!config.setupToken) {
    res.status(503).json({
      error: 'SETUP_TOKEN is not configured. Set it in .env before using setup endpoints.'
    });
    return;
  }

  const providedToken = req.get('x-setup-token') ?? req.query.token;
  if (providedToken !== config.setupToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

app.get('/health', async (req, res) => {
  const state = shiftCache.getState();
  res.json({
    status: state.hasData ? 'ok' : 'starting',
    planday: {
      authorized: Boolean(config.planday.refreshToken) || (await tokenStore.hasRefreshToken())
    },
    cache: {
      hasData: state.hasData,
      isStale: state.isStale,
      lastSuccessfulUpdate: state.lastSuccessfulUpdate,
      lastAttempt: state.lastAttempt,
      lastError: state.lastError
    }
  });
});

app.get('/setup/planday/authorize', requireSetupAuth, (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  const redirectUri = config.planday.redirectUri ?? `${publicBaseUrl(req)}/setup/planday/callback`;

  oauthStates.set(state, {
    redirectUri,
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  res.redirect(plandayClient.getAuthorizationUrl({ redirectUri, state }));
});

app.get('/setup/planday/callback', async (req, res) => {
  const code = firstQueryValue(req.query.code);
  const state = firstQueryValue(req.query.state);
  const storedState = oauthStates.get(state);
  oauthStates.delete(state);

  if (!storedState || storedState.expiresAt < Date.now()) {
    res.status(400).send('Planday authorization state is invalid or expired.');
    return;
  }

  try {
    await plandayClient.exchangeAuthorizationCode({
      code,
      redirectUri: storedState.redirectUri
    });
    await shiftCache.refreshIfNeeded({ force: true });
    res.type('html').send(`
      <!doctype html>
      <html lang="de">
        <head><meta charset="utf-8"><title>Planday verbunden</title></head>
        <body style="font-family: Arial, sans-serif; padding: 2rem;">
          <h1>Planday wurde verbunden.</h1>
          <p>Der Refresh Token wurde serverseitig gespeichert. Dieses Fenster kann geschlossen werden.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Planday authorization callback failed:', error.message);
    res.status(502).send('Planday authorization failed. Check the server logs for the technical error.');
  }
});

app.get('/setup/planday/status', requireSetupAuth, async (req, res) => {
  res.json({
    authorized: Boolean(config.planday.refreshToken) || (await tokenStore.hasRefreshToken()),
    tokenFile: config.plandayTokenFile
  });
});

app.get('/setup/planday/departments', requireSetupAuth, async (req, res) => {
  try {
    const departments = sanitizeSetupList(await plandayClient.listDepartments());
    res.json({ departments });
  } catch (error) {
    console.error('Planday department list failed:', error.message);
    res.status(502).json({ error: 'Could not load departments from Planday.' });
  }
});

app.get('/api/shifts', async (req, res) => {
  await shiftCache.refreshIfNeeded();
  res.json({
    ...shiftCache.getPublicData(),
    frontendPollMs: config.frontendPollMs
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(config.port, async () => {
  console.log(`Shift display app listening on port ${config.port}`);
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
