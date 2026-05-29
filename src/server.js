import 'dotenv/config';
import compression from 'compression';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlandayClient } from './services/plandayClient.js';
import { ShiftCache } from './services/shiftCache.js';
import { TokenStore } from './services/tokenStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

function parseList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter(Number.isFinite);
}

function parseShiftGroups(value) {
  if (!value) return new Map();

  try {
    const parsed = JSON.parse(value);
    return new Map(Object.entries(parsed).map(([id, name]) => [String(id), String(name)]));
  } catch {
    return new Map(
      value
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [id, ...nameParts] = entry.split(':');
          return [String(id).trim(), nameParts.join(':').trim()];
        })
        .filter(([id, name]) => id && name)
    );
  }
}

function parsePeriodRules(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((rule) => ({
        period: rule.period,
        shiftTypeIds: (rule.shiftTypeIds ?? []).map(String),
        categoryIds: (rule.categoryIds ?? []).map(String),
        employeeGroupIds: (rule.employeeGroupIds ?? []).map(String),
        departmentIds: (rule.departmentIds ?? []).map(String)
      }))
      .filter((rule) => ['early', 'late', 'night'].includes(rule.period));
  } catch {
    console.warn('PLANDAY_PERIOD_RULES could not be parsed. Falling back to start-time classification.');
    return [];
  }
}

function parseTeamRules(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((rule) => ({
        team: String(rule.team ?? '').trim(),
        color: String(rule.color ?? '').trim(),
        leaderEmployeeIds: (rule.leaderEmployeeIds ?? []).map(String),
        substituteEmployeeIds: (rule.substituteEmployeeIds ?? []).map(String)
      }))
      .filter((rule) => rule.team && rule.color);
  } catch {
    console.warn('PLANDAY_TEAM_RULES could not be parsed. Falling back to category/employee-group mapping.');
    return [];
  }
}

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

const config = {
  port: toNumber(process.env.PORT, 3000),
  cacheTtlMs: toNumber(process.env.CACHE_TTL_MS, 5 * 60 * 1000),
  refreshIntervalMs: toNumber(process.env.REFRESH_INTERVAL_MS, 5 * 60 * 1000),
  frontendPollMs: toNumber(process.env.FRONTEND_POLL_MS, 60 * 1000),
  dayCount: toNumber(process.env.DAY_COUNT, 7),
  shiftGroups: parseShiftGroups(process.env.PLANDAY_SHIFT_GROUPS),
  periodRules: parsePeriodRules(process.env.PLANDAY_PERIOD_RULES),
  teamRules: parseTeamRules(process.env.PLANDAY_TEAM_RULES),
  setupToken: process.env.SETUP_TOKEN,
  plandayTokenFile: process.env.PLANDAY_TOKEN_FILE ?? path.join(process.cwd(), 'data', 'planday-token.json'),
  planday: {
    apiBaseUrl: process.env.PLANDAY_API_BASE_URL ?? 'https://openapi.planday.com',
    authorizeUrl: process.env.PLANDAY_AUTHORIZE_URL ?? 'https://id.planday.com/connect/authorize',
    tokenUrl: process.env.PLANDAY_TOKEN_URL ?? 'https://id.planday.com/connect/token',
    clientId: process.env.PLANDAY_CLIENT_ID,
    clientSecret: process.env.PLANDAY_CLIENT_SECRET,
    refreshToken: process.env.PLANDAY_REFRESH_TOKEN,
    redirectUri: process.env.PLANDAY_REDIRECT_URI,
    scopes: process.env.PLANDAY_SCOPES ?? 'openid offline_access shift:read',
    shiftsPath: process.env.PLANDAY_SHIFTS_PATH ?? '/scheduling/v1.0/shifts',
    shiftsMethod: process.env.PLANDAY_SHIFTS_METHOD ?? 'GET',
    shiftsLimit: toNumber(process.env.PLANDAY_SHIFTS_LIMIT, 300),
    departmentsPath: process.env.PLANDAY_DEPARTMENTS_PATH ?? '/hr/v1/Departments',
    shiftGroupsPath: process.env.PLANDAY_SHIFT_GROUPS_PATH ?? '/hr/v1/EmployeeGroups',
    departmentIds: parseList(process.env.PLANDAY_DEPARTMENT_IDS),
    shiftStatus: process.env.PLANDAY_SHIFT_STATUS
  }
};

const app = express();
const oauthStates = new Map();
const tokenStore = new TokenStore(config.plandayTokenFile);
const plandayClient = new PlandayClient(config.planday, tokenStore);
const shiftCache = new ShiftCache({
  client: plandayClient,
  shiftGroups: config.shiftGroups,
  periodRules: config.periodRules,
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

app.get('/setup/planday/shift-groups', requireSetupAuth, async (req, res) => {
  try {
    const shiftGroups = sanitizeSetupList(await plandayClient.listShiftGroups());
    res.json({ shiftGroups });
  } catch (error) {
    console.error('Planday shift group list failed:', error.message);
    res.status(502).json({ error: 'Could not load shift groups from Planday.' });
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
  if (config.shiftGroups.size === 0) {
    console.warn('PLANDAY_SHIFT_GROUPS is empty. No shift groups will be shown until it is configured.');
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
