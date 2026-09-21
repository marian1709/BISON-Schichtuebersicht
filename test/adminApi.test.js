import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApplication } from '../src/app.js';

test('protects admin configuration and saves authenticated changes', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bison-api-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const legacyFile = path.join(directory, 'schedule.json');
  await fs.writeFile(
    legacyFile,
    JSON.stringify({
      departmentIds: [1],
      teams: [{ name: 'Team A', color: '#112233', leaders: [10], substitutes: [11] }]
    })
  );

  const plandayClient = {
    config: { refreshToken: null },
    setDepartmentIds(ids) {
      this.departmentIds = ids;
    },
    async listDepartments() {
      return [{ id: 1, name: 'Produktion' }];
    },
    async listEmployees() {
      return [
        { id: 10, firstName: 'Fiona', lastName: 'Führung' },
        { id: 11, firstName: 'Stella', lastName: 'Vertretung' }
      ];
    },
    getAuthorizationUrl() {
      return 'https://id.planday.test/authorize';
    }
  };
  const shiftCache = {
    teamRules: [],
    setTeamRules(rules) {
      this.teamRules = rules;
    },
    async refreshIfNeeded() {},
    getState() {
      return {
        hasData: false,
        isStale: true,
        lastSuccessfulUpdate: null,
        lastAttempt: null,
        lastError: null
      };
    },
    getPublicData() {
      return { days: [] };
    }
  };
  const tokenStore = {
    async hasRefreshToken() {
      return false;
    }
  };
  const config = {
    adminPassword: 'sehr-geheim',
    appConfigFile: path.join(directory, 'data', 'app-config.json'),
    legacyScheduleFile: legacyFile,
    plandayTokenFile: path.join(directory, 'token.json'),
    cacheTtlMs: 1000,
    dayCount: 7,
    frontendPollMs: 1000,
    planday: {}
  };
  const { app } = await createApplication(config, { plandayClient, shiftCache, tokenStore });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const unauthorized = await fetch(`${baseUrl}/api/admin/config`);
  assert.equal(unauthorized.status, 401);

  const login = await fetch(`${baseUrl}/api/admin/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ password: 'sehr-geheim' })
  });
  assert.equal(login.status, 204);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const current = await fetch(`${baseUrl}/api/admin/config`, {
    headers: { Cookie: cookie }
  });
  assert.equal(current.status, 200);
  const payload = await current.json();

  payload.teams[0].name = 'Team Produktion';
  const saved = await fetch(`${baseUrl}/api/admin/config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: baseUrl
    },
    body: JSON.stringify(payload)
  });

  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).teams[0].name, 'Team Produktion');
  assert.equal(shiftCache.teamRules[0].team, 'Team Produktion');
});
