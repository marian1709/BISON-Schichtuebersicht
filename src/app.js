import compression from 'compression';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminRouter } from './routes/adminRoutes.js';
import { createPublicRouter } from './routes/publicRoutes.js';
import { AdminAuth } from './services/adminAuth.js';
import { ConfigStore, toTeamRules } from './services/configStore.js';
import { PlandayClient } from './services/plandayClient.js';
import { ShiftCache } from './services/shiftCache.js';
import { TokenStore } from './services/tokenStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDirectory = path.join(__dirname, 'public');

function publicBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export async function createApplication(config, overrides = {}) {
  const configStore =
    overrides.configStore ??
    new ConfigStore({
      filePath: config.appConfigFile,
      legacyFilePath: config.legacyScheduleFile
    });
  const appConfig = await configStore.initialize();

  const tokenStore = overrides.tokenStore ?? new TokenStore(config.plandayTokenFile);
  const plandayClient = overrides.plandayClient ?? new PlandayClient(config.planday, tokenStore);
  plandayClient.setDepartmentIds(appConfig.departmentId ? [appConfig.departmentId] : []);

  const shiftCache =
    overrides.shiftCache ??
    new ShiftCache({
      client: plandayClient,
      teamRules: toTeamRules(appConfig),
      cacheTtlMs: config.cacheTtlMs,
      dayCount: config.dayCount
    });
  const adminAuth = overrides.adminAuth ?? new AdminAuth(config.adminPassword);
  const oauthStates = new Map();
  const app = express();

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
          formAction: ["'self'"],
          upgradeInsecureRequests: null
        }
      }
    })
  );
  app.use(compression());

  const createAuthorizationUrl = (req) => {
    const state = crypto.randomBytes(24).toString('hex');
    const redirectUri = config.planday.redirectUri ?? `${publicBaseUrl(req)}/setup/planday/callback`;
    oauthStates.set(state, {
      redirectUri,
      expiresAt: Date.now() + 10 * 60 * 1000
    });
    return plandayClient.getAuthorizationUrl({ redirectUri, state });
  };

  app.get('/setup/planday/callback', async (req, res) => {
    const code = firstQueryValue(req.query.code);
    const state = firstQueryValue(req.query.state);
    const storedState = oauthStates.get(state);
    oauthStates.delete(state);

    if (!storedState || storedState.expiresAt < Date.now()) {
      res.redirect('/admin?connection=invalid');
      return;
    }

    try {
      await plandayClient.exchangeAuthorizationCode({
        code,
        redirectUri: storedState.redirectUri
      });
      await shiftCache.refreshIfNeeded({ force: true });
      res.redirect('/admin?connection=success');
    } catch (error) {
      console.error('Planday authorization callback failed:', error.message);
      res.redirect('/admin?connection=failed');
    }
  });

  app.use(
    '/api/admin',
    createAdminRouter({
      adminAuth,
      configStore,
      plandayClient,
      tokenStore,
      createAuthorizationUrl,
      onConfigSaved: async (saved) => {
        plandayClient.setDepartmentIds(saved.departmentId ? [saved.departmentId] : []);
        shiftCache.setTeamRules(toTeamRules(saved));
        await shiftCache.refreshIfNeeded({ force: true });
      }
    })
  );
  app.use(
    createPublicRouter({
      shiftCache,
      tokenStore,
      plandayClient,
      frontendPollMs: config.frontendPollMs
    })
  );

  app.use(express.static(publicDirectory, { extensions: ['html'] }));
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicDirectory, 'admin.html'));
  });
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDirectory, 'index.html'));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    console.error('Request failed:', error.message);
    res.status(500).json({ error: 'Interner Serverfehler.' });
  });

  return { app, configStore, tokenStore, plandayClient, shiftCache, adminAuth };
}
