import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ConfigStore,
  ConfigValidationError,
  validateAppConfig
} from '../src/services/configStore.js';

test('migrates the legacy schedule and persists the normalized configuration', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bison-config-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const legacyFilePath = path.join(directory, 'schedule.json');
  const filePath = path.join(directory, 'data', 'app-config.json');

  await fs.writeFile(
    legacyFilePath,
    JSON.stringify({
      departmentIds: [21985],
      teams: [
        {
          name: 'Team Alex',
          color: '#fa7e01',
          leaders: [168016, 999999],
          substitutes: [183450]
        }
      ]
    })
  );

  const store = new ConfigStore({ filePath, legacyFilePath });
  const config = await store.initialize();

  assert.equal(config.version, 2);
  assert.equal(config.departmentId, '21985');
  assert.equal(config.teams[0].leaderEmployeeId, '168016');
  assert.equal(config.teams[0].substituteEmployeeId, '183450');
  assert.equal(config.teams[0].color, '#FA7E01');
  assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')), config);
});

test('rejects duplicate employee assignments', () => {
  assert.throws(
    () =>
      validateAppConfig({
        departmentId: '1',
        teams: [
          {
            name: 'Team A',
            color: '#112233',
            leaderEmployeeId: '10',
            substituteEmployeeId: '11'
          },
          {
            name: 'Team B',
            color: '#445566',
            leaderEmployeeId: '10',
            substituteEmployeeId: '12'
          }
        ]
      }),
    (error) =>
      error instanceof ConfigValidationError &&
      error.errors.some((item) => item.field === 'teams.1.leaderEmployeeId')
  );
});
