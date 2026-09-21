import express from 'express';
import { ConfigValidationError, validateAppConfig } from '../services/configStore.js';

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.data ?? payload?.items ?? payload?.results ?? [];
}

function sanitizeDepartments(payload) {
  return listFromPayload(payload)
    .map((item) => ({
      id: item.id ?? item.departmentId,
      name: item.name ?? item.title ?? item.description
    }))
    .filter((item) => item.id !== undefined && item.name)
    .map((item) => ({ id: String(item.id), name: String(item.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function sanitizeEmployees(payload) {
  return listFromPayload(payload)
    .map((item) => {
      const id = item.id ?? item.employeeId;
      const fullName =
        item.name ??
        item.displayName ??
        [item.firstName, item.lastName].filter(Boolean).join(' ').trim();
      return {
        id,
        name: fullName || (id === undefined ? '' : `Account ${id}`)
      };
    })
    .filter((item) => item.id !== undefined && item.name)
    .map((item) => ({ id: String(item.id), name: String(item.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function createAdminRouter({
  adminAuth,
  configStore,
  plandayClient,
  tokenStore,
  onConfigSaved,
  createAuthorizationUrl
}) {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  router.get('/session', (req, res) => {
    res.json({
      configured: adminAuth.isConfigured(),
      authenticated: adminAuth.isAuthenticated(req)
    });
  });

  router.post('/session', adminAuth.requireSameOrigin, (req, res) => {
    const attemptKey = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (!adminAuth.isConfigured()) {
      res.status(503).json({ error: 'ADMIN_PASSWORD ist nicht konfiguriert.' });
      return;
    }
    if (!adminAuth.canAttemptLogin(attemptKey)) {
      res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' });
      return;
    }
    if (!adminAuth.isPasswordValid(req.body?.password)) {
      adminAuth.recordFailedLogin(attemptKey);
      res.status(401).json({ error: 'Zugangsdaten ungültig.' });
      return;
    }

    adminAuth.clearFailedLogins(attemptKey);
    adminAuth.createSession(req, res);
    res.status(204).end();
  });

  router.delete('/session', adminAuth.requireSameOrigin, (req, res) => {
    adminAuth.destroySession(req, res);
    res.status(204).end();
  });

  router.use(adminAuth.requireSession);

  router.get('/config', (req, res) => {
    res.json(configStore.get());
  });

  router.put('/config', adminAuth.requireSameOrigin, async (req, res, next) => {
    try {
      const candidate = validateAppConfig(req.body);
      const availableEmployees = sanitizeEmployees(
        await plandayClient.listEmployees({ departmentId: candidate.departmentId })
      );
      const availableIds = new Set(availableEmployees.map((employee) => employee.id));
      const unavailableErrors = candidate.teams.flatMap((team, index) =>
        [
          ['leaderEmployeeId', team.leaderEmployeeId],
          ['substituteEmployeeId', team.substituteEmployeeId]
        ]
          .filter(([, employeeId]) => !availableIds.has(employeeId))
          .map(([role]) => ({
            field: `teams.${index}.${role}`,
            message: 'Der ausgewählte Account ist in diesem Department nicht aktiv.'
          }))
      );
      if (unavailableErrors.length > 0) throw new ConfigValidationError(unavailableErrors);

      const saved = await configStore.save(candidate);
      await onConfigSaved(saved);
      res.json(saved);
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        res.status(400).json({ error: error.message, errors: error.errors });
        return;
      }
      next(error);
    }
  });

  router.get('/departments', async (req, res) => {
    try {
      res.json({ departments: sanitizeDepartments(await plandayClient.listDepartments()) });
    } catch (error) {
      console.error('Planday department list failed:', error.message);
      res.status(502).json({ error: 'Departments konnten nicht aus Planday geladen werden.' });
    }
  });

  router.get('/employees', async (req, res) => {
    const departmentId = String(req.query.departmentId ?? configStore.get().departmentId ?? '');
    if (!departmentId) {
      res.status(400).json({ error: 'Bitte zuerst ein Department auswählen.' });
      return;
    }

    try {
      const employees = await plandayClient.listEmployees({
        departmentId,
        searchQuery: req.query.q
      });
      res.json({ employees: sanitizeEmployees(employees) });
    } catch (error) {
      console.error('Planday employee list failed:', error.message);
      res.status(502).json({ error: 'Accounts konnten nicht aus Planday geladen werden.' });
    }
  });

  router.get('/planday/status', async (req, res) => {
    res.json({
      authorized: Boolean(plandayClient.config.refreshToken) || (await tokenStore.hasRefreshToken())
    });
  });

  router.get('/planday/authorize', (req, res) => {
    res.redirect(createAuthorizationUrl(req));
  });

  router.use((req, res) => {
    res.status(404).json({ error: 'Admin-Endpunkt nicht gefunden.' });
  });

  return router;
}
