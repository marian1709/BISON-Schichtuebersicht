import assert from 'node:assert/strict';
import test from 'node:test';
import { PlandayClient } from '../src/services/plandayClient.js';

test('loads paginated employees and filters them by department', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const requestedUrls = [];
  const firstPage = Array.from({ length: 50 }, (_, index) => ({
    id: index + 1,
    firstName: `Account ${index + 1}`,
    departments: [index === 0 ? 2 : 1]
  }));
  const pages = [firstPage, [{ id: 51, firstName: 'Account 51', departments: [1] }]];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify({ data: pages.shift() ?? [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const client = new PlandayClient(
    {
      apiBaseUrl: 'https://api.example.test',
      employeesPath: '/hr/v1/Employees',
      clientId: 'client'
    },
    {}
  );
  client.accessToken = 'access-token';
  client.accessTokenExpiresAt = Date.now() + 60 * 60 * 1000;

  const employees = await client.listEmployees({ departmentId: '1' });

  assert.equal(employees.length, 50);
  assert.equal(employees.some((employee) => employee.id === 1), false);
  assert.match(requestedUrls[0], /offset=0/);
  assert.match(requestedUrls[1], /offset=50/);
});
